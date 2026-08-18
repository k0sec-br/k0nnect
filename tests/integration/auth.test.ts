import { beforeEach, describe, expect, it } from 'vitest';

import type { ApiFailure, ApiSuccess, SessionUser } from '../../shared/types/api';
import { resetDatabase, seedInvite } from '../helpers/database';
import { apiRequest, sessionCookie } from '../helpers/http';

const PASSWORD = 'uma-senha-segura-e-longa';

async function register(token: string, username = 'alice') {
  return apiRequest('/api/auth/register-invite', {
    method: 'POST',
    body: JSON.stringify({
      inviteToken: token,
      username,
      displayName: '<Alice & Bob>',
      password: PASSWORD,
    }),
  });
}

describe('autenticação por convite', () => {
  beforeEach(resetDatabase);

  it('cria conta, cookie seguro e recovery codes sem renderizar HTML do display name', async () => {
    const response = await register(await seedInvite());
    expect(response.status).toBe(201);
    expect(response.headers.get('Set-Cookie')).toContain('__Host-k0nnect_session=');
    expect(response.headers.get('Set-Cookie')).toContain('HttpOnly');
    expect(response.headers.get('Set-Cookie')).toContain('Secure');
    expect(response.headers.get('Set-Cookie')).toContain('SameSite=Lax');
    const payload =
      await response.json<
        ApiSuccess<{ user: SessionUser; recoveryCodes: string[]; csrfToken: string }>
      >();
    expect(payload.data.user.displayName).toBe('<Alice & Bob>');
    expect(payload.data.recoveryCodes).toHaveLength(10);
    expect(JSON.stringify(payload)).not.toContain(PASSWORD);
  });

  it.each([
    ['expirado', { expiresAt: new Date(Date.now() - 1_000).toISOString() }],
    ['revogado', { revokedAt: new Date().toISOString() }],
    ['usado', { usedAt: new Date().toISOString() }],
  ])('mantém resposta genérica para convite %s', async (_label, options) => {
    const response = await register(await seedInvite(options));
    const payload = await response.json<ApiFailure>();
    expect(response.status).toBe(400);
    expect(payload.error.message).toBe('Este convite não é válido ou não está mais disponível.');
  });

  it('permite apenas uma redenção quando duas requisições disputam o mesmo convite', async () => {
    const token = await seedInvite();
    const responses = await Promise.all([register(token, 'alice'), register(token, 'bob')]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 400]);
  });

  it('não enumera conta por mensagem de login', async () => {
    await register(await seedInvite());
    const wrongPassword = await apiRequest('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'alice', password: 'senha-errada-mas-longa' }),
    });
    const missingAccount = await apiRequest('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'nobody', password: 'senha-errada-mas-longa' }),
    });
    const wrongBody = await wrongPassword.json<ApiFailure>();
    const missingBody = await missingAccount.json<ApiFailure>();
    expect(wrongBody.error.message).toBe('Usuário ou senha incorretos.');
    expect(missingBody.error.message).toBe(wrongBody.error.message);
  });

  it('exige Origin e CSRF para mutações autenticadas e invalida no logout', async () => {
    const registration = await register(await seedInvite({ role: 'owner' }));
    const cookie = sessionCookie(registration);
    const body = await registration.json<ApiSuccess<{ csrfToken: string }>>();
    const missingCsrf = await apiRequest('/api/auth/logout', { method: 'POST', cookie });
    expect(missingCsrf.status).toBe(403);
    const logout = await apiRequest('/api/auth/logout', {
      method: 'POST',
      cookie,
      csrfToken: body.data.csrfToken,
    });
    expect(logout.status).toBe(200);
    const session = await apiRequest('/api/auth/session', { cookie });
    expect((await session.json<ApiSuccess<{ authenticated: boolean }>>()).data.authenticated).toBe(
      false,
    );
  });

  it('consome recovery code, troca senha, revoga sessões e impede replay', async () => {
    const registration = await register(await seedInvite());
    const cookie = sessionCookie(registration);
    const body = await registration.json<ApiSuccess<{ recoveryCodes: string[] }>>();
    const code = body.data.recoveryCodes[0];
    const recovery = await apiRequest('/api/auth/recover', {
      method: 'POST',
      body: JSON.stringify({
        username: 'alice',
        recoveryCode: code,
        newPassword: 'uma-nova-senha-segura',
      }),
    });
    expect(recovery.status).toBe(200);
    const oldSession = await apiRequest('/api/auth/session', { cookie });
    expect(
      (await oldSession.json<ApiSuccess<{ authenticated: boolean }>>()).data.authenticated,
    ).toBe(false);
    const replay = await apiRequest('/api/auth/recover', {
      method: 'POST',
      body: JSON.stringify({
        username: 'alice',
        recoveryCode: code,
        newPassword: 'outra-senha-segura-nova',
      }),
    });
    expect(replay.status).toBe(400);
    const login = await apiRequest('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'alice', password: 'uma-nova-senha-segura' }),
    });
    expect(login.status).toBe(200);
  });
});
