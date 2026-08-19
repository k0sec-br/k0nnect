import { exports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';

import { MAX_JSON_BODY_BYTES } from '../../shared/constants/security';
import type { ApiFailure, ApiSuccess } from '../../shared/types/api';
import { resetDatabase, seedInvite } from '../helpers/database';
import { apiRequest, sessionCookie } from '../helpers/http';

describe('controles HTTP e autorização', () => {
  beforeEach(resetDatabase);

  it('aplica headers de segurança à API', async () => {
    const response = await apiRequest('/api/bootstrap');
    expect(response.headers.get('Content-Security-Policy')).toContain("default-src 'self'");
    expect(response.headers.get('Content-Security-Policy')).not.toContain("'unsafe-eval'");
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('recusa Origin externo antes de processar credenciais', async () => {
    const response = await apiRequest('/api/auth/login', {
      method: 'POST',
      headers: { Origin: 'https://evil.example', Host: 'localhost:5173' },
      body: JSON.stringify({ username: 'alice', password: 'senha-inexistente-longa' }),
    });
    expect(response.status).toBe(403);
  });

  it('não usa X-Forwarded-Host controlado pelo cliente para validar a origem', async () => {
    const response = await exports.default.fetch('http://evil.example/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:5173',
        'X-Forwarded-Host': 'localhost:5173',
      },
      body: JSON.stringify({ username: 'alice', password: 'senha-inexistente-longa' }),
    });
    expect(response.status).toBe(403);
  });

  it('exige JSON explícito e limita o corpo mesmo sem Content-Length', async () => {
    const wrongContentType = await apiRequest('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ username: 'alice', password: 'senha-inexistente-longa' }),
    });
    expect(wrongContentType.status).toBe(415);

    const oversized = await apiRequest('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        username: 'alice',
        password: 'A'.repeat(MAX_JSON_BODY_BYTES),
      }),
    });
    expect(oversized.status).toBe(413);
  });

  it('rejeita fuzzing leve e chaves de prototype sem gerar erro interno', async () => {
    const hostileBodies = [
      'null',
      '[]',
      '{}',
      '{"username":1,"password":{}}',
      '{"username":"alice","password":"senha-inexistente-longa","__proto__":{"role":"owner"}}',
      '{"username":"alice","password":"senha-inexistente-longa","constructor":{"prototype":{"role":"owner"}}}',
    ];
    for (const body of hostileBodies) {
      const response = await apiRequest('/api/auth/login', { method: 'POST', body });
      expect([400, 401]).toContain(response.status);
    }
    expect((Object.prototype as { role?: string }).role).toBeUndefined();
  });

  it('impede member de acessar convites administrativos', async () => {
    const registration = await apiRequest('/api/auth/register-invite', {
      method: 'POST',
      body: JSON.stringify({
        inviteToken: await seedInvite(),
        username: 'member',
        displayName: 'Member',
        password: 'senha-segura-do-member',
      }),
    });
    const response = await apiRequest('/api/admin/invites', {
      cookie: sessionCookie(registration),
    });
    expect(response.status).toBe(403);
    const crossAccountDelete = await apiRequest(`/api/admin/invites/${crypto.randomUUID()}`, {
      method: 'DELETE',
      cookie: sessionCookie(registration),
    });
    expect(crossAccountDelete.status).toBe(403);
  });

  it('permite owner criar admin, mas nunca retorna o token em listagens posteriores', async () => {
    const registration = await apiRequest('/api/auth/register-invite', {
      method: 'POST',
      body: JSON.stringify({
        inviteToken: await seedInvite({ role: 'owner' }),
        username: 'owner.user',
        displayName: 'Owner',
        password: 'senha-segura-do-owner',
      }),
    });
    const cookie = sessionCookie(registration);
    const registered = await registration.json<ApiSuccess<{ csrfToken: string }>>();
    const created = await apiRequest('/api/admin/invites', {
      method: 'POST',
      cookie,
      csrfToken: registered.data.csrfToken,
      body: JSON.stringify({ role: 'admin' }),
    });
    expect(created.status).toBe(201);
    const createdPayload = await created.json<ApiSuccess<{ token: string; url: string }>>();
    const listed = await apiRequest('/api/admin/invites', { cookie });
    const listedText = await listed.text();
    expect(listedText).not.toContain(createdPayload.data.token);
    expect(listedText).not.toContain(createdPayload.data.url);
  });

  it('recusa payload inválido e SQL injection como username', async () => {
    const response = await apiRequest('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: "admin' OR 1=1--", password: 'senha-inexistente-longa' }),
    });
    const payload = await response.json<ApiFailure>();
    expect(response.status).toBe(400);
    expect(payload.error.code).toBe('VALIDATION_ERROR');
    const escalation = await apiRequest('/api/auth/register-invite', {
      method: 'POST',
      body: JSON.stringify({
        inviteToken: 'A'.repeat(43),
        username: 'alice',
        displayName: 'Alice',
        password: 'uma-senha-segura-e-longa',
        role: 'owner',
      }),
    });
    expect(escalation.status).toBe(400);
  });

  it('retorna Retry-After ao bloquear abuso', async () => {
    let blockedResponse: Response | undefined;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      blockedResponse = await apiRequest('/api/auth/login', {
        method: 'POST',
        headers: { 'CF-Connecting-IP': '203.0.113.88' },
        body: JSON.stringify({
          username: `rate.limit.${attempt}`,
          password: 'senha-inexistente-longa',
        }),
      });
    }
    expect(blockedResponse?.status).toBe(429);
    expect(Number(blockedResponse?.headers.get('Retry-After'))).toBeGreaterThan(0);
  });

  it('impede admin de criar outro admin', async () => {
    const registration = await apiRequest('/api/auth/register-invite', {
      method: 'POST',
      body: JSON.stringify({
        inviteToken: await seedInvite({ role: 'admin' }),
        username: 'community.admin',
        displayName: 'Admin',
        password: 'uma-senha-segura-e-longa',
      }),
    });
    const registered = await registration.json<ApiSuccess<{ csrfToken: string }>>();
    const response = await apiRequest('/api/admin/invites', {
      method: 'POST',
      cookie: sessionCookie(registration),
      csrfToken: registered.data.csrfToken,
      body: JSON.stringify({ role: 'admin' }),
    });
    expect(response.status).toBe(403);
  });
});
