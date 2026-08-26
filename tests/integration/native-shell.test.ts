import { describe, expect, it } from 'vitest';

import { app } from '../../worker/app';

const TEST_ENV = {
  TURNSTILE_SITE_KEY: '0x4AAAAAAETU0suRQRlL5nSH',
} as Env;

describe('recursos seguros do cliente nativo', () => {
  it('serve o desafio Turnstile no domínio oficial com CSP restritiva', async () => {
    const response = await app.request(
      'https://connect.k0sec.org/native/turnstile?action=login&parentOrigin=http%3A%2F%2Ftauri.localhost',
      undefined,
      TEST_ENV,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/html');
    expect(response.headers.get('Content-Security-Policy')).toContain(
      'frame-ancestors http://tauri.localhost',
    );
    const html = await response.text();
    expect(html).toContain('Verificação de segurança');
    expect(html).toContain(TEST_ENV.TURNSTILE_SITE_KEY);
    expect(html).not.toContain('TURNSTILE_SECRET_KEY');
  });

  it('recusa ações que não pertencem aos fluxos de autenticação', async () => {
    const response = await app.request(
      'https://connect.k0sec.org/native/turnstile?action=admin',
      undefined,
      TEST_ENV,
    );
    expect(response.status).toBe(404);
  });

  it('mantém o script sem credenciais e valida a origem do aplicativo', async () => {
    const response = await app.request(
      'https://connect.k0sec.org/native/turnstile.js',
      undefined,
      TEST_ENV,
    );
    const script = await response.text();
    expect(response.status).toBe(200);
    expect(script).toContain("'http://tauri.localhost'");
    expect(script).toContain("'tauri://localhost'");
    expect(script).not.toContain(TEST_ENV.TURNSTILE_SITE_KEY);
  });
});
