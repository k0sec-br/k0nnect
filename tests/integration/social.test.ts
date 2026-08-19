import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';

import type { ApiSuccess, BootstrapView, SessionUser } from '../../shared/types/api';
import { resetDatabase, seedInvite } from '../helpers/database';
import { apiRequest, sessionCookie } from '../helpers/http';

interface TestAccount {
  cookie: string;
  csrfToken: string;
  user: SessionUser;
}

async function createAccount(username: string, displayName: string): Promise<TestAccount> {
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
  const payload =
    await response.json<
      ApiSuccess<{ csrfToken: string; user: SessionUser; recoveryCodes: string[] }>
    >();
  return {
    cookie: sessionCookie(response),
    csrfToken: payload.data.csrfToken,
    user: payload.data.user,
  };
}

async function bootstrap(account: TestAccount) {
  const response = await apiRequest('/api/bootstrap', { cookie: account.cookie });
  const payload = await response.json<ApiSuccess<BootstrapView>>();
  if (!payload.data.authenticated) throw new Error('Bootstrap autenticado esperado');
  account.csrfToken = payload.data.csrfToken;
  return payload.data;
}

async function becomeFriends(requester: TestAccount, recipient: TestAccount) {
  const requested = await apiRequest('/api/social/friends', {
    method: 'POST',
    cookie: requester.cookie,
    csrfToken: requester.csrfToken,
    body: JSON.stringify({ username: recipient.user.username }),
  });
  expect(requested.status).toBe(201);
  await bootstrap(recipient);
  const accepted = await apiRequest(`/api/social/friends/${requester.user.id}/accept`, {
    method: 'POST',
    cookie: recipient.cookie,
    csrfToken: recipient.csrfToken,
  });
  expect(accepted.status).toBe(200);
  await bootstrap(requester);
}

describe('social, grupos e chat persistente', () => {
  beforeEach(resetDatabase);

  it('inclui toda conta ativa no grupo padrão sem incluir mensagens no bootstrap', async () => {
    const alice = await createAccount('alice', 'Alice');
    const data = await bootstrap(alice);
    expect(data.conversations).toEqual([
      expect.objectContaining({
        id: 'group_k0sec',
        spaceKind: 'community',
        isDefault: true,
        callRoomId: 'room_general',
      }),
    ]);
    expect(data.conversations[0]?.members).toContainEqual(
      expect.objectContaining({ id: alice.user.id, username: 'alice' }),
    );
    expect(JSON.stringify(data)).not.toContain('clientMessageId');
  });

  it('procura por username exato e exige aceite para estabelecer amizade', async () => {
    const alice = await createAccount('alice', 'Alice');
    const bob = await createAccount('bob', 'Bob');
    const search = await apiRequest('/api/social/users/bob', { cookie: alice.cookie });
    expect(search.status).toBe(200);
    expect((await apiRequest('/api/social/users/bo', { cookie: alice.cookie })).status).toBe(404);

    await becomeFriends(alice, bob);
    const aliceBootstrap = await bootstrap(alice);
    const bobBootstrap = await bootstrap(bob);
    expect(aliceBootstrap.friends).toContainEqual(expect.objectContaining({ id: bob.user.id }));
    expect(bobBootstrap.friends).toContainEqual(expect.objectContaining({ id: alice.user.id }));
    expect(aliceBootstrap.friendRequests).toEqual([]);
  });

  it('recusa amizade própria, duplicada, inversa e aceite por quem enviou', async () => {
    const alice = await createAccount('alice', 'Alice');
    const bob = await createAccount('bob', 'Bob');
    expect((await apiRequest('/api/social/users/alice', { cookie: alice.cookie })).status).toBe(
      404,
    );

    const request = () =>
      apiRequest('/api/social/friends', {
        method: 'POST',
        cookie: alice.cookie,
        csrfToken: alice.csrfToken,
        body: JSON.stringify({ username: 'bob' }),
      });
    expect((await request()).status).toBe(201);
    expect((await request()).status).toBe(409);
    const inverse = await apiRequest('/api/social/friends', {
      method: 'POST',
      cookie: bob.cookie,
      csrfToken: bob.csrfToken,
      body: JSON.stringify({ username: 'alice' }),
    });
    expect(inverse.status).toBe(409);
    const invalidAccept = await apiRequest(`/api/social/friends/${bob.user.id}/accept`, {
      method: 'POST',
      cookie: alice.cookie,
      csrfToken: alice.csrfToken,
    });
    expect(invalidAccept.status).toBe(404);
    const declined = await apiRequest(`/api/social/friends/${alice.user.id}`, {
      method: 'DELETE',
      cookie: bob.cookie,
      csrfToken: bob.csrfToken,
    });
    expect(declined.status).toBe(200);
  });

  it('limita grupos a amigos e protege grupo padrão e ações de owner', async () => {
    const alice = await createAccount('alice', 'Alice');
    const bob = await createAccount('bob', 'Bob');
    const charlie = await createAccount('charlie', 'Charlie');
    await becomeFriends(alice, bob);

    const forbiddenMember = await apiRequest('/api/social/groups', {
      method: 'POST',
      cookie: alice.cookie,
      csrfToken: alice.csrfToken,
      body: JSON.stringify({ name: 'Privado', memberIds: [charlie.user.id] }),
    });
    expect(forbiddenMember.status).toBe(403);

    const created = await apiRequest('/api/social/groups', {
      method: 'POST',
      cookie: alice.cookie,
      csrfToken: alice.csrfToken,
      body: JSON.stringify({ name: 'Privado', memberIds: [bob.user.id] }),
    });
    expect(created.status).toBe(201);
    const createdPayload = await created.json<ApiSuccess<{ id: string }>>();
    const bobBootstrap = await bootstrap(bob);
    expect(bobBootstrap.conversations).toContainEqual(
      expect.objectContaining({ id: createdPayload.data.id, spaceKind: 'group' }),
    );
    const unrelatedHistory = await apiRequest(
      `/api/social/conversations/${createdPayload.data.id}/messages`,
      { cookie: charlie.cookie },
    );
    expect(unrelatedHistory.status).toBe(403);
    const renameByMember = await apiRequest(`/api/social/groups/${createdPayload.data.id}/rename`, {
      method: 'POST',
      cookie: bob.cookie,
      csrfToken: bob.csrfToken,
      body: JSON.stringify({ name: 'Inválido' }),
    });
    expect(renameByMember.status).toBe(403);
    const deleteDefault = await apiRequest('/api/social/groups/group_k0sec', {
      method: 'DELETE',
      cookie: alice.cookie,
      csrfToken: alice.csrfToken,
    });
    expect(deleteDefault.status).toBe(403);
  });

  it('executa rename, add, transferência, leave e delete preservando um owner', async () => {
    const alice = await createAccount('alice', 'Alice');
    const bob = await createAccount('bob', 'Bob');
    const charlie = await createAccount('charlie', 'Charlie');
    await becomeFriends(alice, bob);
    await becomeFriends(alice, charlie);

    const created = await apiRequest('/api/social/groups', {
      method: 'POST',
      cookie: alice.cookie,
      csrfToken: alice.csrfToken,
      body: JSON.stringify({ name: 'Equipe', memberIds: [bob.user.id] }),
    });
    const groupId = (await created.json<ApiSuccess<{ id: string }>>()).data.id;
    const ownerLeave = await apiRequest(`/api/social/groups/${groupId}/leave`, {
      method: 'POST',
      cookie: alice.cookie,
      csrfToken: alice.csrfToken,
    });
    expect(ownerLeave.status).toBe(403);

    const renamed = await apiRequest(`/api/social/groups/${groupId}/rename`, {
      method: 'POST',
      cookie: alice.cookie,
      csrfToken: alice.csrfToken,
      body: JSON.stringify({ name: 'Equipe segura' }),
    });
    expect(renamed.status).toBe(200);
    const added = await apiRequest(`/api/social/groups/${groupId}/members`, {
      method: 'POST',
      cookie: alice.cookie,
      csrfToken: alice.csrfToken,
      body: JSON.stringify({ userId: charlie.user.id }),
    });
    expect(added.status).toBe(201);
    const transferred = await apiRequest(`/api/social/groups/${groupId}/transfer`, {
      method: 'POST',
      cookie: alice.cookie,
      csrfToken: alice.csrfToken,
      body: JSON.stringify({ newOwnerId: bob.user.id }),
    });
    expect(transferred.status).toBe(200);
    const left = await apiRequest(`/api/social/groups/${groupId}/leave`, {
      method: 'POST',
      cookie: alice.cookie,
      csrfToken: alice.csrfToken,
    });
    expect(left.status).toBe(200);
    const removed = await apiRequest(`/api/social/groups/${groupId}/members/${charlie.user.id}`, {
      method: 'DELETE',
      cookie: bob.cookie,
      csrfToken: bob.csrfToken,
    });
    expect(removed.status).toBe(200);
    const deleted = await apiRequest(`/api/social/groups/${groupId}`, {
      method: 'DELETE',
      cookie: bob.cookie,
      csrfToken: bob.csrfToken,
    });
    expect(deleted.status).toBe(200);
    expect(
      await env.DB.prepare('SELECT COUNT(*) AS total FROM conversations WHERE id = ?')
        .bind(groupId)
        .first<{ total: number }>(),
    ).toEqual({ total: 0 });
  });

  it('revoga histórico e chamada ao remover membro sem apagar mensagens persistidas', async () => {
    const alice = await createAccount('alice', 'Alice');
    const bob = await createAccount('bob', 'Bob');
    await becomeFriends(alice, bob);
    const created = await apiRequest('/api/social/groups', {
      method: 'POST',
      cookie: alice.cookie,
      csrfToken: alice.csrfToken,
      body: JSON.stringify({ name: 'Equipe', memberIds: [bob.user.id] }),
    });
    const groupId = (await created.json<ApiSuccess<{ id: string }>>()).data.id;
    await env.DB.prepare(
      `INSERT INTO messages (
         conversation_id, sender_id, client_message_id, content, created_at
       ) VALUES (?, ?, ?, 'mensagem preservada', ?)`,
    )
      .bind(groupId, bob.user.id, crypto.randomUUID(), new Date().toISOString())
      .run();

    const removed = await apiRequest(`/api/social/groups/${groupId}/members/${bob.user.id}`, {
      method: 'DELETE',
      cookie: alice.cookie,
      csrfToken: alice.csrfToken,
    });
    expect(removed.status).toBe(200);
    const removedBootstrap = await bootstrap(bob);
    expect(removedBootstrap.conversations.some((conversation) => conversation.id === groupId)).toBe(
      false,
    );
    expect(removedBootstrap.channels.some((channel) => channel.slug === groupId)).toBe(false);
    const history = await apiRequest(`/api/social/conversations/${groupId}/messages`, {
      cookie: bob.cookie,
    });
    expect(history.status).toBe(403);
    expect(
      await env.DB.prepare('SELECT COUNT(*) AS total FROM messages WHERE conversation_id = ?')
        .bind(groupId)
        .first<{ total: number }>(),
    ).toEqual({ total: 1 });
  });

  it('edita e apaga somente mensagens do próprio remetente com soft delete', async () => {
    const alice = await createAccount('alice', 'Alice');
    const bob = await createAccount('bob', 'Bob');
    const inserted = await env.DB.prepare(
      `INSERT INTO messages (
         conversation_id, sender_id, client_message_id, content, created_at
       ) VALUES ('group_k0sec', ?, ?, 'original', ?) RETURNING id`,
    )
      .bind(alice.user.id, crypto.randomUUID(), new Date().toISOString())
      .first<{ id: number }>();
    if (!inserted) throw new Error('Mensagem de teste ausente');

    const forbidden = await apiRequest(`/api/social/messages/${inserted.id}`, {
      method: 'POST',
      cookie: bob.cookie,
      csrfToken: bob.csrfToken,
      body: JSON.stringify({ content: 'interferência' }),
    });
    expect(forbidden.status).toBe(404);
    const edited = await apiRequest(`/api/social/messages/${inserted.id}`, {
      method: 'POST',
      cookie: alice.cookie,
      csrfToken: alice.csrfToken,
      body: JSON.stringify({ content: 'editada' }),
    });
    expect(edited.status).toBe(200);
    const deleted = await apiRequest(`/api/social/messages/${inserted.id}`, {
      method: 'DELETE',
      cookie: alice.cookie,
      csrfToken: alice.csrfToken,
    });
    expect(deleted.status).toBe(200);
    const deletedRow = await env.DB.prepare('SELECT content, deleted_at FROM messages WHERE id = ?')
      .bind(inserted.id)
      .first<{ content: string | null; deleted_at: string | null }>();
    expect(deletedRow?.content).toBeNull();
    expect(typeof deletedRow?.deleted_at).toBe('string');
  });

  it('pagina histórico por cursor sem duplicar mensagens', async () => {
    const alice = await createAccount('alice', 'Alice');
    const now = new Date().toISOString();
    await env.DB.batch(
      Array.from({ length: 60 }, (_, index) =>
        env.DB.prepare(
          `INSERT INTO messages (
             conversation_id, sender_id, client_message_id, content, created_at
           ) VALUES ('group_k0sec', ?, ?, ?, ?)`,
        ).bind(alice.user.id, crypto.randomUUID(), `mensagem ${index + 1}`, now),
      ),
    );
    const latestResponse = await apiRequest(
      '/api/social/conversations/group_k0sec/messages?limit=50',
      { cookie: alice.cookie },
    );
    const latest =
      await latestResponse.json<
        ApiSuccess<{ messages: { id: number; content: string | null }[] }>
      >();
    expect(latest.data.messages).toHaveLength(50);
    const oldestLoadedId = latest.data.messages[0]!.id;
    const olderResponse = await apiRequest(
      `/api/social/conversations/group_k0sec/messages?before=${oldestLoadedId}&limit=50`,
      { cookie: alice.cookie },
    );
    const older =
      await olderResponse.json<
        ApiSuccess<{ messages: { id: number; content: string | null }[] }>
      >();
    expect(older.data.messages).toHaveLength(10);
    expect(
      new Set([...latest.data.messages, ...older.data.messages].map((message) => message.id)).size,
    ).toBe(60);
  });
});
