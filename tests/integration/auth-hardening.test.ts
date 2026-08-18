import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';

import type { ApiFailure, ApiSuccess } from '../../shared/types/api';
import { resetDatabase, seedInvite } from '../helpers/database';
import { apiRequest, sessionCookie } from '../helpers/http';

const PASSWORD = 'uma-senha-segura-e-longa';

async function createAccount(username = 'alice') {
  const response = await apiRequest('/api/auth/register-invite', {
    method: 'POST',
    body: JSON.stringify({
      inviteToken: await seedInvite(),
      username,
      displayName: 'Alice',
      password: PASSWORD,
    }),
  });
  const body = await response.json<ApiSuccess<{ csrfToken: string; recoveryCodes: string[] }>>();
  return { body, cookie: sessionCookie(response) };
}

describe('endurecimento de autenticação e sessão', () => {
  beforeEach(resetDatabase);

  it('recusa username duplicado e encerra o convite para impedir enumeração repetida', async () => {
    await createAccount();
    const secondToken = await seedInvite();
    const duplicate = await apiRequest('/api/auth/register-invite', {
      method: 'POST',
      body: JSON.stringify({
        inviteToken: secondToken,
        username: 'alice',
        displayName: 'Outra Alice',
        password: PASSWORD,
      }),
    });
    expect(duplicate.status).toBe(400);
    const unusedInvites = await env.DB.prepare(
      'SELECT COUNT(*) AS total FROM invites WHERE used_at IS NULL AND revoked_at IS NULL',
    ).first<{ total: number }>();
    const revokedInvites = await env.DB.prepare(
      'SELECT COUNT(*) AS total FROM invites WHERE revoked_at IS NOT NULL',
    ).first<{ total: number }>();
    expect(unusedInvites?.total).toBe(0);
    expect(revokedInvites?.total).toBe(1);

    const replay = await apiRequest('/api/auth/register-invite', {
      method: 'POST',
      body: JSON.stringify({
        inviteToken: secondToken,
        username: 'available.username',
        displayName: 'Available Username',
        password: PASSWORD,
      }),
    });
    expect(replay.status).toBe(400);
  });

  it('rotaciona a sessão no login e revoga a sessão anterior', async () => {
    const original = await createAccount();
    const login = await apiRequest('/api/auth/login', {
      method: 'POST',
      cookie: original.cookie,
      body: JSON.stringify({ username: 'alice', password: PASSWORD }),
    });
    expect(login.status).toBe(200);
    expect(sessionCookie(login)).not.toBe(original.cookie);
    const oldSession = await apiRequest('/api/auth/session', { cookie: original.cookie });
    expect(
      (await oldSession.json<ApiSuccess<{ authenticated: boolean }>>()).data.authenticated,
    ).toBe(false);
  });

  it('recusa sessão expirada, sessão ociosa e conta desabilitada', async () => {
    const account = await createAccount();
    await env.DB.prepare("UPDATE sessions SET expires_at = '2000-01-01T00:00:00.000Z'").run();
    expect(
      (
        await (
          await apiRequest('/api/auth/session', { cookie: account.cookie })
        ).json<ApiSuccess<{ authenticated: boolean }>>()
      ).data.authenticated,
    ).toBe(false);

    await env.DB.prepare(
      "UPDATE sessions SET expires_at = '2099-01-01T00:00:00.000Z', last_seen_at = '2000-01-01T00:00:00.000Z'",
    ).run();
    expect(
      (
        await (
          await apiRequest('/api/auth/session', { cookie: account.cookie })
        ).json<ApiSuccess<{ authenticated: boolean }>>()
      ).data.authenticated,
    ).toBe(false);

    await env.DB.prepare(
      "UPDATE sessions SET last_seen_at = ?, expires_at = '2099-01-01T00:00:00.000Z'",
    )
      .bind(new Date().toISOString())
      .run();
    await env.DB.prepare("UPDATE users SET status = 'disabled' WHERE username = 'alice'").run();
    expect(
      (
        await (
          await apiRequest('/api/auth/session', { cookie: account.cookie })
        ).json<ApiSuccess<{ authenticated: boolean }>>()
      ).data.authenticated,
    ).toBe(false);
  });

  it('descarta cookie de sessão fora do formato antes de consultar a sessão', async () => {
    const response = await apiRequest('/api/auth/session', {
      cookie: '__Host-k0nnect_session=not-an-opaque-token',
    });
    const payload = await response.json<ApiSuccess<{ authenticated: boolean }>>();
    expect(payload.data.authenticated).toBe(false);
    expect(response.headers.get('Set-Cookie')).toContain('Max-Age=0');
  });

  it('logout all revoga todas as sessões e CSRF inválido é recusado', async () => {
    const first = await createAccount();
    const secondLogin = await apiRequest('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'alice', password: PASSWORD }),
    });
    const secondCookie = sessionCookie(secondLogin);
    const secondBody = await secondLogin.json<ApiSuccess<{ csrfToken: string }>>();
    const invalidCsrf = await apiRequest('/api/auth/logout-all', {
      method: 'POST',
      cookie: secondCookie,
      csrfToken: 'A'.repeat(43),
    });
    expect(invalidCsrf.status).toBe(403);
    const logoutAll = await apiRequest('/api/auth/logout-all', {
      method: 'POST',
      cookie: secondCookie,
      csrfToken: secondBody.data.csrfToken,
    });
    expect(logoutAll.status).toBe(200);
    for (const cookie of [first.cookie, secondCookie]) {
      const session = await apiRequest('/api/auth/session', { cookie });
      expect(
        (await session.json<ApiSuccess<{ authenticated: boolean }>>()).data.authenticated,
      ).toBe(false);
    }
  });

  it('limita abuso por IP sem depender de enumeração de conta', async () => {
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = await apiRequest('/api/auth/login', {
        method: 'POST',
        headers: { 'CF-Connecting-IP': '203.0.113.77' },
        body: JSON.stringify({ username: `missing${attempt}`, password: 'senha-incorreta-longa' }),
      });
      statuses.push(response.status);
    }
    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(statuses[5]).toBe(429);
  });
});

describe('recovery codes', () => {
  beforeEach(resetDatabase);

  it('recusa código inválido e permite apenas um vencedor em corrida', async () => {
    const account = await createAccount();
    const invalid = await apiRequest('/api/auth/recover', {
      method: 'POST',
      body: JSON.stringify({
        username: 'alice',
        recoveryCode: 'AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA',
        newPassword: 'uma-nova-senha-segura',
      }),
    });
    expect(invalid.status).toBe(400);
    const recoveryCode = account.body.data.recoveryCodes[0];
    expect(recoveryCode).toBeDefined();
    const recover = () =>
      apiRequest('/api/auth/recover', {
        method: 'POST',
        body: JSON.stringify({
          username: 'alice',
          recoveryCode,
          newPassword: 'uma-nova-senha-segura',
        }),
      });
    const responses = await Promise.all([recover(), recover()]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 400]);
  });

  it('regenera códigos, rotaciona a sessão e invalida os códigos anteriores', async () => {
    const account = await createAccount();
    const previousCode = account.body.data.recoveryCodes[0];
    expect(previousCode).toBeDefined();
    const regenerated = await apiRequest('/api/auth/recovery-codes/regenerate', {
      method: 'POST',
      cookie: account.cookie,
      csrfToken: account.body.data.csrfToken,
      body: JSON.stringify({ password: PASSWORD }),
    });
    expect(regenerated.status).toBe(200);
    expect(sessionCookie(regenerated)).not.toBe(account.cookie);
    const regeneratedBody =
      await regenerated.json<ApiSuccess<{ recoveryCodes: string[]; csrfToken: string }>>();
    expect(regeneratedBody.data.recoveryCodes).toHaveLength(10);
    const replay = await apiRequest('/api/auth/recover', {
      method: 'POST',
      body: JSON.stringify({
        username: 'alice',
        recoveryCode: previousCode,
        newPassword: 'outra-senha-segura',
      }),
    });
    expect(replay.status).toBe(400);
  });

  it('retorna erro genérico para recovery de conta inexistente', async () => {
    const response = await apiRequest('/api/auth/recover', {
      method: 'POST',
      body: JSON.stringify({
        username: 'nobody',
        recoveryCode: 'AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA',
        newPassword: 'uma-nova-senha-segura',
      }),
    });
    const body = await response.json<ApiFailure>();
    expect(response.status).toBe(400);
    expect(body.error.message).not.toContain('nobody');
  });
});
