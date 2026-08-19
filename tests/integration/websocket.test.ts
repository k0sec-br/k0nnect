import { env, exports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';

import { REALTIME_PROTOCOL_VERSION, type ServerRoomMessage } from '../../shared/protocol/room';
import type { ApiSuccess, BootstrapView } from '../../shared/types/api';
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

async function connect(cookie: string, resume?: { connectionEpoch: number; connectionId: string }) {
  const url = new URL('http://localhost:5173/api/servers/k0sec/socket');
  if (resume) {
    url.searchParams.set('connectionId', resume.connectionId);
    url.searchParams.set('connectionEpoch', String(resume.connectionEpoch));
  }
  const response = await exports.default.fetch(url, {
    headers: {
      Origin: 'http://localhost:5173',
      Cookie: cookie,
      Upgrade: 'websocket',
      'CF-Connecting-IP': `192.0.2.${crypto.getRandomValues(new Uint8Array(1))[0] ?? 1}`,
    },
  });
  expect(response.status).toBe(101);
  const socket = response.webSocket;
  if (!socket) throw new Error('WebSocket ausente no teste');
  const ready = nextMessage(socket);
  socket.accept();
  const message = await ready;
  if (message.type !== 'server.ready') throw new Error('Mensagem server.ready esperada');
  return { socket, ready: message };
}

async function join(socket: WebSocket, channelId = 'room_general') {
  const requestId = crypto.randomUUID();
  const response = nextMessage(socket);
  socket.send(
    JSON.stringify({
      v: REALTIME_PROTOCOL_VERSION,
      type: 'call.join',
      payload: { channelId, requestId },
    }),
  );
  return response;
}

describe('servidor em tempo real', () => {
  beforeEach(resetDatabase);

  it('recusa upgrade sem sessão, Origin externo e servidor inexistente', async () => {
    const withoutSession = await exports.default.fetch(
      'http://localhost:5173/api/servers/k0sec/socket',
      { headers: { Origin: 'http://localhost:5173', Upgrade: 'websocket' } },
    );
    expect(withoutSession.status).toBe(401);
    const cookie = await createAccount('alice', 'Alice');
    const invalidOrigin = await exports.default.fetch(
      'http://localhost:5173/api/servers/k0sec/socket',
      { headers: { Origin: 'https://evil.example', Cookie: cookie, Upgrade: 'websocket' } },
    );
    expect(invalidOrigin.status).toBe(403);
    const missingServer = await exports.default.fetch(
      'http://localhost:5173/api/servers/unknown/socket',
      { headers: { Origin: 'http://localhost:5173', Cookie: cookie, Upgrade: 'websocket' } },
    );
    expect(missingServer.status).toBe(404);
  });

  it('separa presença de call e mantém uma conta online em múltiplas sessões', async () => {
    const cookie = await createAccount('alice', 'Alice');
    const first = await connect(cookie);
    const second = await connect(cookie);
    expect(first.ready.payload.participants).toEqual([]);
    expect(new Set(second.ready.payload.onlineUserIds).size).toBe(1);
    expect((await join(first.socket)).type).toBe('call.joined');
    expect((await join(second.socket)).type).toBe('call.conflict');

    const replaced = nextMessage(first.socket);
    const takeover = nextMessage(second.socket);
    const requestId = crypto.randomUUID();
    second.socket.send(
      JSON.stringify({
        v: REALTIME_PROTOCOL_VERSION,
        type: 'call.takeover',
        payload: { channelId: 'room_general', requestId },
      }),
    );
    expect((await replaced).type).toBe('call.replaced');
    expect((await takeover).type).toBe('call.joined');
    first.socket.close(1000, 'Fim');
    second.socket.close(1000, 'Fim');
  });

  it('sair da call mantém presença e fecha a mídia por um comando', async () => {
    const connection = await connect(await createAccount('alice', 'Alice'));
    await join(connection.socket);
    const requestId = crypto.randomUUID();
    const left = nextMessage(connection.socket);
    connection.socket.send(
      JSON.stringify({
        v: REALTIME_PROTOCOL_VERSION,
        type: 'call.leave',
        payload: { requestId },
      }),
    );
    expect((await left).type).toBe('call.member.left');
    expect(connection.socket.readyState).toBe(WebSocket.OPEN);
    connection.socket.close(1000, 'Fim');
  });

  it('permanece ocioso sem heartbeat ou polling da aplicação', async () => {
    const connection = await connect(await createAccount('alice', 'Alice'));
    let messagesAfterSnapshot = 0;
    connection.socket.addEventListener('message', () => {
      messagesAfterSnapshot += 1;
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(messagesAfterSnapshot).toBe(0);
    connection.socket.close(1000, 'Fim');
  });

  it('retoma conexão lógica e publicações durante o grace period', async () => {
    const cookie = await createAccount('alice', 'Alice');
    const connection = await connect(cookie);
    await join(connection.socket);
    const userId = connection.ready.payload.onlineUserIds[0]!;
    const server = env.SERVER_REALTIME.getByName('k0sec');
    expect(
      await server.registerRealtimeSession(
        userId,
        connection.ready.payload.connectionId,
        'alice_session',
      ),
    ).toBe(true);
    const publicationId = await server.reservePublication(
      userId,
      connection.ready.payload.connectionId,
      'alice_session',
      'camera',
      '1',
    );
    if (!publicationId) throw new Error('Reserva esperada');
    await server.completePublication(
      userId,
      connection.ready.payload.connectionId,
      publicationId,
      'camera_track',
    );
    connection.socket.close(1012, 'Falha transitória');
    const resumed = await connect(cookie, {
      connectionId: connection.ready.payload.connectionId,
      connectionEpoch: connection.ready.payload.connectionEpoch + 1,
    });
    expect(resumed.ready.payload.resumed).toBe(true);
    expect(resumed.ready.payload.publications).toEqual([
      expect.objectContaining({ publicationId, source: 'camera' }),
    ]);
    resumed.socket.close(1000, 'Fim');
  });

  it('rejeita impersonation, payload grande e flooding sem heartbeat', async () => {
    const connection = await connect(await createAccount('alice', 'Alice'));
    const invalidClose = nextClose(connection.socket);
    connection.socket.send('{');
    connection.socket.send(
      JSON.stringify({
        v: REALTIME_PROTOCOL_VERSION,
        type: 'member.updated',
        payload: { muted: false, deafened: false, userId: crypto.randomUUID() },
      }),
    );
    connection.socket.send('[]');
    expect((await invalidClose).code).toBe(1008);

    const oversized = await connect(await createAccount('bob', 'Bob'));
    const oversizedClose = nextClose(oversized.socket);
    oversized.socket.send('A'.repeat(4_097));
    expect((await oversizedClose).code).toBe(1009);

    const flooded = await connect(await createAccount('charlie', 'Charlie'));
    const floodedClose = nextClose(flooded.socket);
    const resync = JSON.stringify({
      v: REALTIME_PROTOCOL_VERSION,
      type: 'state.resync',
      payload: {},
    });
    for (let index = 0; index < 51; index += 1) flooded.socket.send(resync);
    expect((await floodedClose).code).toBe(1009);
  });

  it('fecha sockets por revogação orientada a evento', async () => {
    const connection = await connect(await createAccount('alice', 'Alice'));
    const closed = nextClose(connection.socket);
    const session = await env.DB.prepare('SELECT id FROM sessions LIMIT 1').first<{ id: string }>();
    if (!session) throw new Error('Sessão ausente');
    await env.SERVER_REALTIME.getByName('k0sec').disconnectSession(session.id);
    expect((await closed).code).toBe(4003);
  });

  it('retoma a conexão lógica depois da rotação autenticada da sessão', async () => {
    const cookie = await createAccount('alice', 'Alice');
    const connection = await connect(cookie);
    expect((await join(connection.socket)).type).toBe('call.joined');

    const bootstrapResponse = await apiRequest('/api/bootstrap', { cookie });
    const bootstrap = await bootstrapResponse.json<ApiSuccess<BootstrapView>>();
    if (!bootstrap.data.authenticated) throw new Error('Bootstrap autenticado esperado');

    const closed = nextClose(connection.socket);
    const rotated = await apiRequest('/api/auth/recovery-codes/regenerate', {
      method: 'POST',
      cookie,
      csrfToken: bootstrap.data.csrfToken,
      body: JSON.stringify({ password: 'uma-senha-segura-e-longa' }),
    });
    expect(rotated.status).toBe(200);
    expect((await closed).code).toBe(4004);

    const resumed = await connect(sessionCookie(rotated), {
      connectionId: connection.ready.payload.connectionId,
      connectionEpoch: connection.ready.payload.connectionEpoch + 1,
    });
    expect(resumed.ready.payload.resumed).toBe(true);
    expect(resumed.ready.payload.participants).toEqual([
      expect.objectContaining({ userId: connection.ready.payload.onlineUserIds[0] }),
    ]);
    resumed.socket.close(1000, 'Fim');
  });
});
