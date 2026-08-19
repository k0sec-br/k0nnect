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

function nextMessageOfType(
  socket: WebSocket,
  type: ServerRoomMessage['type'],
): Promise<ServerRoomMessage> {
  return new Promise((resolve) => {
    const listener = (event: MessageEvent) => {
      const message = JSON.parse(String(event.data)) as ServerRoomMessage;
      if (message.type !== type) return;
      socket.removeEventListener('message', listener);
      resolve(message);
    };
    socket.addEventListener('message', listener);
  });
}

function nextChatMessageWithContent(
  socket: WebSocket,
  content: string,
): Promise<ServerRoomMessage> {
  return new Promise((resolve) => {
    const listener = (event: MessageEvent) => {
      const message = JSON.parse(String(event.data)) as ServerRoomMessage;
      if (message.type !== 'chat.message' || message.payload.content !== content) return;
      socket.removeEventListener('message', listener);
      resolve(message);
    };
    socket.addEventListener('message', listener);
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

  it('persiste e entrega mensagem canônica uma única vez sob retry idempotente', async () => {
    const alice = await connect(await createAccount('alice', 'Alice'));
    const bob = await connect(await createAccount('bob', 'Bob'));
    const clientMessageId = crypto.randomUUID();
    const aliceMessage = nextMessageOfType(alice.socket, 'chat.message');
    const bobMessage = nextMessageOfType(bob.socket, 'chat.message');
    const command = JSON.stringify({
      v: REALTIME_PROTOCOL_VERSION,
      type: 'chat.send',
      payload: {
        conversationId: 'group_k0sec',
        clientMessageId,
        content: 'Olá pelo realtime',
      },
    });
    alice.socket.send(command);
    const [canonicalForAlice, canonicalForBob] = await Promise.all([aliceMessage, bobMessage]);
    expect(canonicalForAlice.type).toBe('chat.message');
    expect(canonicalForBob).toEqual(canonicalForAlice);

    const retry = nextMessageOfType(alice.socket, 'chat.message');
    alice.socket.send(command);
    expect(await retry).toEqual(canonicalForAlice);
    expect(
      await env.DB.prepare(
        'SELECT COUNT(*) AS total FROM messages WHERE sender_id = ? AND client_message_id = ?',
      )
        .bind(alice.ready.payload.onlineUserIds[0], clientMessageId)
        .first<{ total: number }>(),
    ).toEqual({ total: 1 });
    alice.socket.close(1000, 'Fim');
    bob.socket.close(1000, 'Fim');
  });

  it('recusa DM de não amigo sem criar conversation', async () => {
    const alice = await connect(await createAccount('alice', 'Alice'));
    await createAccount('bob', 'Bob');
    const bob = await env.DB.prepare("SELECT id FROM users WHERE username = 'bob'").first<{
      id: string;
    }>();
    if (!bob) throw new Error('Bob ausente');
    const error = nextMessageOfType(alice.socket, 'error');
    alice.socket.send(
      JSON.stringify({
        v: REALTIME_PROTOCOL_VERSION,
        type: 'chat.send',
        payload: {
          recipientUserId: bob.id,
          clientMessageId: crypto.randomUUID(),
          content: 'mensagem indevida',
        },
      }),
    );
    expect((await error).type).toBe('error');
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS total FROM conversations WHERE kind = 'dm'").first<{
        total: number;
      }>(),
    ).toEqual({ total: 0 });
    alice.socket.close(1000, 'Fim');
  });

  it('cria uma única DM quando os dois amigos enviam a primeira mensagem', async () => {
    const aliceCookie = await createAccount('alice', 'Alice');
    const bobCookie = await createAccount('bob', 'Bob');
    const users = await env.DB.prepare(
      "SELECT id, username FROM users WHERE username IN ('alice', 'bob')",
    ).all<{ id: string; username: string }>();
    const userId = new Map(users.results.map((user) => [user.username, user.id]));
    const aliceId = userId.get('alice');
    const bobId = userId.get('bob');
    if (!aliceId || !bobId) throw new Error('Usuários da DM ausentes');
    const [lowId, highId] = [aliceId, bobId].sort();
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO friendships (
         user_low_id, user_high_id, requested_by, status, created_at, responded_at
       ) VALUES (?, ?, ?, 'accepted', ?, ?)`,
    )
      .bind(lowId, highId, aliceId, now, now)
      .run();
    const alice = await connect(aliceCookie);
    const bob = await connect(bobCookie);
    const aliceCanonical = nextChatMessageWithContent(alice.socket, 'Bob iniciou');
    const bobCanonical = nextChatMessageWithContent(bob.socket, 'Alice iniciou');
    alice.socket.send(
      JSON.stringify({
        v: REALTIME_PROTOCOL_VERSION,
        type: 'chat.send',
        payload: {
          recipientUserId: bobId,
          clientMessageId: crypto.randomUUID(),
          content: 'Alice iniciou',
        },
      }),
    );
    bob.socket.send(
      JSON.stringify({
        v: REALTIME_PROTOCOL_VERSION,
        type: 'chat.send',
        payload: {
          recipientUserId: aliceId,
          clientMessageId: crypto.randomUUID(),
          content: 'Bob iniciou',
        },
      }),
    );
    expect((await aliceCanonical).type).toBe('chat.message');
    expect((await bobCanonical).type).toBe('chat.message');
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS total FROM conversations WHERE kind = 'dm'").first<{
        total: number;
      }>(),
    ).toEqual({ total: 1 });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS total FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.kind = 'dm'",
      ).first<{ total: number }>(),
    ).toEqual({ total: 2 });
    alice.socket.close(1000, 'Fim');
    bob.socket.close(1000, 'Fim');
  });

  it('recusa DM quando a amizade termina antes da atualização da capacidade do socket', async () => {
    const aliceCookie = await createAccount('alice', 'Alice');
    await createAccount('bob', 'Bob');
    const users = await env.DB.prepare(
      "SELECT id, username FROM users WHERE username IN ('alice', 'bob')",
    ).all<{ id: string; username: string }>();
    const userId = new Map(users.results.map((user) => [user.username, user.id]));
    const aliceId = userId.get('alice');
    const bobId = userId.get('bob');
    if (!aliceId || !bobId) throw new Error('Usuários da DM ausentes');
    const [lowId, highId] = [aliceId, bobId].sort();
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO friendships (
           user_low_id, user_high_id, requested_by, status, created_at, responded_at
         ) VALUES (?, ?, ?, 'accepted', ?, ?)`,
      ).bind(lowId, highId, aliceId, now, now),
      env.DB.prepare(
        `INSERT INTO conversations (
           id, kind, name, owner_user_id, dm_pair_key, call_room_id,
           is_default, created_at, updated_at
         ) VALUES ('dm_race', 'dm', NULL, NULL, ?, NULL, 0, ?, ?)`,
      ).bind(`${lowId}:${highId}`, now, now),
      env.DB.prepare(
        "INSERT INTO conversation_members (conversation_id, user_id, member_role, joined_at) VALUES ('dm_race', ?, 'member', ?)",
      ).bind(aliceId, now),
      env.DB.prepare(
        "INSERT INTO conversation_members (conversation_id, user_id, member_role, joined_at) VALUES ('dm_race', ?, 'member', ?)",
      ).bind(bobId, now),
    ]);
    const alice = await connect(aliceCookie);
    await env.DB.prepare('DELETE FROM friendships WHERE user_low_id = ? AND user_high_id = ?')
      .bind(lowId, highId)
      .run();

    const error = nextMessageOfType(alice.socket, 'error');
    alice.socket.send(
      JSON.stringify({
        v: REALTIME_PROTOCOL_VERSION,
        type: 'chat.send',
        payload: {
          conversationId: 'dm_race',
          clientMessageId: crypto.randomUUID(),
          content: 'mensagem em corrida',
        },
      }),
    );
    expect((await error).type).toBe('error');
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS total FROM messages WHERE conversation_id = 'dm_race'",
      ).first<{ total: number }>(),
    ).toEqual({ total: 0 });
    alice.socket.close(1000, 'Fim');
  });

  it('entrega chat privado somente a membros ativos', async () => {
    const aliceCookie = await createAccount('alice', 'Alice');
    const bobCookie = await createAccount('bob', 'Bob');
    const charlieCookie = await createAccount('charlie', 'Charlie');
    const users = await env.DB.prepare(
      "SELECT id, username FROM users WHERE username IN ('alice', 'bob', 'charlie')",
    ).all<{ id: string; username: string }>();
    const userId = new Map(users.results.map((user) => [user.username, user.id]));
    const aliceId = userId.get('alice');
    const bobId = userId.get('bob');
    if (!aliceId || !bobId) throw new Error('Usuários do grupo ausentes');
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO rooms (id, slug, name, kind, position, created_at) VALUES ('call_private', 'private', 'Private', 'voice', 0, ?)",
      ).bind(now),
      env.DB.prepare(
        `INSERT INTO conversations (
           id, kind, name, owner_user_id, call_room_id, is_default, created_at, updated_at
         ) VALUES ('group_private', 'group', 'Private', ?, 'call_private', 0, ?, ?)`,
      ).bind(aliceId, now, now),
      env.DB.prepare(
        "INSERT INTO conversation_members (conversation_id, user_id, member_role, joined_at) VALUES ('group_private', ?, 'owner', ?)",
      ).bind(aliceId, now),
      env.DB.prepare(
        "INSERT INTO conversation_members (conversation_id, user_id, member_role, joined_at) VALUES ('group_private', ?, 'member', ?)",
      ).bind(bobId, now),
    ]);
    const alice = await connect(aliceCookie);
    const bob = await connect(bobCookie);
    const charlie = await connect(charlieCookie);
    let charlieChatEvents = 0;
    charlie.socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as ServerRoomMessage;
      if (message.type === 'chat.message') charlieChatEvents += 1;
    });
    const receivedByBob = nextMessageOfType(bob.socket, 'chat.message');
    alice.socket.send(
      JSON.stringify({
        v: REALTIME_PROTOCOL_VERSION,
        type: 'chat.send',
        payload: {
          conversationId: 'group_private',
          clientMessageId: crypto.randomUUID(),
          content: 'somente membros',
        },
      }),
    );
    expect((await receivedByBob).type).toBe('chat.message');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(charlieChatEvents).toBe(0);
    const denied = nextMessageOfType(charlie.socket, 'error');
    charlie.socket.send(
      JSON.stringify({
        v: REALTIME_PROTOCOL_VERSION,
        type: 'chat.send',
        payload: {
          conversationId: 'group_private',
          clientMessageId: crypto.randomUUID(),
          content: 'tentativa externa',
        },
      }),
    );
    expect((await denied).type).toBe('error');
    alice.socket.close(1000, 'Fim');
    bob.socket.close(1000, 'Fim');
    charlie.socket.close(1000, 'Fim');
  });

  it('revoga chat, fanout e call imediatamente após remover um membro', async () => {
    const aliceCookie = await createAccount('alice', 'Alice');
    const bobCookie = await createAccount('bob', 'Bob');
    const users = await env.DB.prepare(
      "SELECT id, username FROM users WHERE username IN ('alice', 'bob')",
    ).all<{ id: string; username: string }>();
    const userId = new Map(users.results.map((user) => [user.username, user.id]));
    const aliceId = userId.get('alice');
    const bobId = userId.get('bob');
    if (!aliceId || !bobId) throw new Error('Usuários do grupo ausentes');
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO rooms (id, slug, name, kind, position, created_at) VALUES ('call_removed', 'removed', 'Removed', 'voice', 0, ?)",
      ).bind(now),
      env.DB.prepare(
        `INSERT INTO conversations (
           id, kind, name, owner_user_id, call_room_id, is_default, created_at, updated_at
         ) VALUES ('group_removed', 'group', 'Removed', ?, 'call_removed', 0, ?, ?)`,
      ).bind(aliceId, now, now),
      env.DB.prepare(
        "INSERT INTO conversation_members (conversation_id, user_id, member_role, joined_at) VALUES ('group_removed', ?, 'owner', ?)",
      ).bind(aliceId, now),
      env.DB.prepare(
        "INSERT INTO conversation_members (conversation_id, user_id, member_role, joined_at) VALUES ('group_removed', ?, 'member', ?)",
      ).bind(bobId, now),
    ]);
    const alice = await connect(aliceCookie);
    const bob = await connect(bobCookie);
    await env.DB.prepare(
      "UPDATE conversation_members SET removed_at = ? WHERE conversation_id = 'group_removed' AND user_id = ?",
    )
      .bind(new Date().toISOString(), bobId)
      .run();
    const socialChanged = nextMessageOfType(bob.socket, 'social.changed');
    await env.SERVER_REALTIME.getByName('k0sec').refreshSocialState([bobId], 'groups');
    expect((await socialChanged).type).toBe('social.changed');

    let removedMemberMessages = 0;
    bob.socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as ServerRoomMessage;
      if (message.type === 'chat.message') removedMemberMessages += 1;
    });
    const deliveredToAlice = nextMessageOfType(alice.socket, 'chat.message');
    alice.socket.send(
      JSON.stringify({
        v: REALTIME_PROTOCOL_VERSION,
        type: 'chat.send',
        payload: {
          conversationId: 'group_removed',
          clientMessageId: crypto.randomUUID(),
          content: 'somente Alice',
        },
      }),
    );
    expect((await deliveredToAlice).type).toBe('chat.message');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(removedMemberMessages).toBe(0);

    const sendError = nextMessageOfType(bob.socket, 'error');
    bob.socket.send(
      JSON.stringify({
        v: REALTIME_PROTOCOL_VERSION,
        type: 'chat.send',
        payload: {
          conversationId: 'group_removed',
          clientMessageId: crypto.randomUUID(),
          content: 'bloqueada',
        },
      }),
    );
    expect((await sendError).type).toBe('error');
    expect((await join(bob.socket, 'call_removed')).type).toBe('error');
    alice.socket.close(1000, 'Fim');
    bob.socket.close(1000, 'Fim');
  });

  it('entrega atualização social a todas as conexões ativas da conta', async () => {
    const cookie = await createAccount('alice', 'Alice');
    const first = await connect(cookie);
    const second = await connect(cookie);
    const userId = first.ready.payload.onlineUserIds[0];
    if (!userId) throw new Error('Usuário conectado ausente');
    const firstUpdate = nextMessageOfType(first.socket, 'social.changed');
    const secondUpdate = nextMessageOfType(second.socket, 'social.changed');
    await env.SERVER_REALTIME.getByName('k0sec').refreshSocialState([userId], 'friends');
    expect((await firstUpdate).type).toBe('social.changed');
    expect((await secondUpdate).type).toBe('social.changed');
    first.socket.close(1000, 'Fim');
    second.socket.close(1000, 'Fim');
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
