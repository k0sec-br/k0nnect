import { env, exports } from 'cloudflare:workers';
import { runDurableObjectAlarm } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import { ROOM_PROTOCOL_VERSION, type ServerRoomMessage } from '../../shared/protocol/room';
import { resetDatabase, seedInvite } from '../helpers/database';
import { apiRequest, sessionCookie } from '../helpers/http';

async function createAccount(username: string, displayName: string): Promise<string> {
  const response = await apiRequest('/api/auth/register-invite', {
    method: 'POST',
    body: JSON.stringify({
      inviteToken: await seedInvite(),
      username,
      displayName,
      password: 'uma-senha-segura-e-longa',
    }),
  });
  expect(response.status).toBe(201);
  return sessionCookie(response);
}

function nextMessage(socket: WebSocket): Promise<ServerRoomMessage> {
  return new Promise((resolve) => {
    socket.addEventListener(
      'message',
      (event) => resolve(JSON.parse(String(event.data)) as ServerRoomMessage),
      { once: true },
    );
  });
}

function nextClose(socket: WebSocket): Promise<CloseEvent> {
  return new Promise((resolve) => socket.addEventListener('close', resolve, { once: true }));
}

async function connect(cookie: string) {
  const response = await exports.default.fetch(
    'http://localhost:5173/api/rooms/room_general/socket',
    {
      headers: {
        Origin: 'http://localhost:5173',
        Cookie: cookie,
        Upgrade: 'websocket',
        'CF-Connecting-IP': `192.0.2.${crypto.getRandomValues(new Uint8Array(1))[0] ?? 1}`,
      },
    },
  );
  expect(response.status).toBe(101);
  expect(response.webSocket).not.toBeNull();
  const socket = response.webSocket;
  if (!socket) throw new Error('WebSocket ausente no teste');
  const ready = nextMessage(socket);
  socket.accept();
  return { socket, ready: await ready };
}

describe('sala em tempo real', () => {
  beforeEach(resetDatabase);

  it('recusa upgrade sem sessão, Origin externo e sala inexistente', async () => {
    const withoutSession = await exports.default.fetch(
      'http://localhost:5173/api/rooms/room_general/socket',
      {
        headers: { Origin: 'http://localhost:5173', Upgrade: 'websocket' },
      },
    );
    expect(withoutSession.status).toBe(401);

    const cookie = await createAccount('alice', 'Alice');
    const invalidOrigin = await exports.default.fetch(
      'http://localhost:5173/api/rooms/room_general/socket',
      {
        headers: { Origin: 'https://evil.example', Cookie: cookie, Upgrade: 'websocket' },
      },
    );
    expect(invalidOrigin.status).toBe(403);
    const missingRoom = await exports.default.fetch(
      'http://localhost:5173/api/rooms/unknown/socket',
      {
        headers: { Origin: 'http://localhost:5173', Cookie: cookie, Upgrade: 'websocket' },
      },
    );
    expect(missingRoom.status).toBe(404);

    const directDurableObject = await env.VOICE_ROOMS.getByName('room_general').fetch(
      new Request('http://voice-room.internal', {
        headers: {
          Upgrade: 'websocket',
          'X-K0nnect-User-Id': crypto.randomUUID(),
          'X-K0nnect-Session-Id': crypto.randomUUID(),
          'X-K0nnect-Display-Name': 'Forged',
        },
      }),
    );
    expect(directDurableObject.status).toBe(401);
  });

  it('propaga join, presença autoritativa, leave e reconexão sem duplicar usuário', async () => {
    const aliceCookie = await createAccount('alice', 'Alice <script>');
    const bobCookie = await createAccount('bob', 'Bob');
    const alice = await connect(aliceCookie);
    expect(alice.ready.type).toBe('room.ready');
    const joined = nextMessage(alice.socket);
    const bob = await connect(bobCookie);
    expect((await joined).type).toBe('member.joined');
    if (bob.ready.type !== 'room.ready') throw new Error('Mensagem room.ready esperada');
    expect(bob.ready.payload.participants).toHaveLength(2);
    expect(
      bob.ready.payload.participants.some(
        (participant) => participant.displayName === 'Alice <script>',
      ),
    ).toBe(true);

    const updated = nextMessage(bob.socket);
    alice.socket.send(
      JSON.stringify({
        v: ROOM_PROTOCOL_VERSION,
        type: 'member.updated',
        payload: { muted: false, deafened: true },
      }),
    );
    const updateMessage = await updated;
    expect(updateMessage.type).toBe('member.updated');
    if (updateMessage.type === 'member.updated') {
      expect(updateMessage.payload.muted).toBe(true);
      expect(updateMessage.payload.deafened).toBe(true);
    }

    const aliceClosed = nextClose(alice.socket);
    const replacement = await connect(aliceCookie);
    expect((await aliceClosed).code).toBe(4001);
    if (replacement.ready.type !== 'room.ready') throw new Error('Mensagem room.ready esperada');
    expect(
      replacement.ready.payload.participants.filter(
        (participant) => participant.displayName === 'Alice <script>',
      ),
    ).toHaveLength(1);

    const left = nextMessage(replacement.socket);
    bob.socket.close(1000, 'Saindo');
    expect((await left).type).toBe('member.left');
    replacement.socket.close(1000, 'Fim do teste');
  });

  it('fecha mensagens inválidas, tentativa de impersonation e payload grande', async () => {
    const cookie = await createAccount('alice', 'Alice');
    const connection = await connect(cookie);
    const invalidClose = nextClose(connection.socket);
    const impersonation = JSON.stringify({
      v: ROOM_PROTOCOL_VERSION,
      type: 'member.updated',
      payload: { muted: false, deafened: false, userId: crypto.randomUUID() },
    });
    connection.socket.send('{');
    connection.socket.send(impersonation);
    connection.socket.send('[]');
    expect((await invalidClose).code).toBe(1008);

    const oversized = await connect(cookie);
    const oversizedClose = nextClose(oversized.socket);
    oversized.socket.send('A'.repeat(4_097));
    expect((await oversizedClose).code).toBe(1009);
  });

  it('encerra a conexão sob flooding de mensagens', async () => {
    const connection = await connect(await createAccount('alice', 'Alice'));
    const closed = nextClose(connection.socket);
    const heartbeat = JSON.stringify({ v: ROOM_PROTOCOL_VERSION, type: 'heartbeat', payload: {} });
    for (let message = 0; message < 51; message += 1) connection.socket.send(heartbeat);
    expect((await closed).code).toBe(1009);
  });

  it('encerra WebSocket existente quando a sessão é revogada', async () => {
    const connection = await connect(await createAccount('alice', 'Alice'));
    const closed = nextClose(connection.socket);
    await env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE revoked_at IS NULL')
      .bind(new Date().toISOString())
      .run();

    const alarmRan = await runDurableObjectAlarm(env.VOICE_ROOMS.getByName('room_general'));
    expect(alarmRan).toBe(true);
    expect((await closed).code).toBe(4003);
  });

  it('autoriza publicações por ID opaco e aplica limites por fonte e sala', async () => {
    const alice = await connect(await createAccount('alice', 'Alice'));
    const bob = await connect(await createAccount('bob', 'Bob'));
    if (alice.ready.type !== 'room.ready' || bob.ready.type !== 'room.ready') {
      throw new Error('Mensagem room.ready esperada');
    }
    const aliceUserId = alice.ready.payload.participants.find(
      (participant) => participant.displayName === 'Alice',
    )?.userId;
    const bobUserId = bob.ready.payload.participants.find(
      (participant) => participant.displayName === 'Bob',
    )?.userId;
    if (!aliceUserId || !bobUserId) throw new Error('Participante ausente');

    const room = env.VOICE_ROOMS.getByName('room_general');
    expect(
      await room.registerRealtimeSession(
        aliceUserId,
        alice.ready.payload.connectionId,
        'alice_session',
      ),
    ).toBe(true);
    expect(
      await room.registerRealtimeSession(bobUserId, bob.ready.payload.connectionId, 'bob_session'),
    ).toBe(true);
    const publicationId = await room.reservePublication(
      aliceUserId,
      alice.ready.payload.connectionId,
      'alice_session',
      'camera',
      '1',
    );
    expect(publicationId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(
      await room.reservePublication(
        aliceUserId,
        alice.ready.payload.connectionId,
        'alice_session',
        'camera',
        '2',
      ),
    ).toBeNull();
    if (!publicationId) throw new Error('Reserva esperada');
    const publication = await room.completePublication(
      aliceUserId,
      alice.ready.payload.connectionId,
      publicationId,
      'internal_track_name',
    );
    expect(publication).toMatchObject({ publicationId, source: 'camera', kind: 'video' });

    const resolved = await room.resolvePublication(
      bobUserId,
      bob.ready.payload.connectionId,
      publicationId,
    );
    expect(resolved?.publication.publicationId).toBe(publicationId);
    expect(resolved?.realtimeTrackName).toBe('internal_track_name');
    const subscriptionReservations = await Promise.all([
      room.reserveSubscription(
        bobUserId,
        bob.ready.payload.connectionId,
        'bob_session',
        publicationId,
      ),
      room.reserveSubscription(
        bobUserId,
        bob.ready.payload.connectionId,
        'bob_session',
        publicationId,
      ),
    ]);
    expect(subscriptionReservations.filter(Boolean)).toHaveLength(1);
    expect(
      await room.completeSubscription(
        bobUserId,
        bob.ready.payload.connectionId,
        'bob_session',
        publicationId,
        'remote-mid-1',
      ),
    ).toBe(true);
    expect(
      await room.takeSubscription(
        bobUserId,
        bob.ready.payload.connectionId,
        'bob_session',
        publicationId,
      ),
    ).toBe('remote-mid-1');
    expect(
      await room.resolvePublication(aliceUserId, alice.ready.payload.connectionId, publicationId),
    ).toBeNull();
    expect(
      await env.VOICE_ROOMS.getByName('other_room').resolvePublication(
        bobUserId,
        bob.ready.payload.connectionId,
        publicationId,
      ),
    ).toBeNull();
    expect(
      await env.VOICE_ROOMS.getByName('other_room').reserveSubscription(
        bobUserId,
        bob.ready.payload.connectionId,
        'bob_session',
        publicationId,
      ),
    ).toBeNull();
    expect(
      await room.resolvePublication(bobUserId, bob.ready.payload.connectionId, crypto.randomUUID()),
    ).toBeNull();

    alice.socket.close(1000, 'Fim do teste');
    bob.socket.close(1000, 'Fim do teste');
  });
});
