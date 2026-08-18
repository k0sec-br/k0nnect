import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { verifyTurnstile } from '../../worker/security/turnstile';

const TURNSTILE_TEST_SECRET = '1x0000000000000000000000000000000AA';

function enabledEnvironment(): Env {
  return {
    ...env,
    TURNSTILE_ENABLED: 'true',
    TURNSTILE_SECRET: TURNSTILE_TEST_SECRET,
  };
}

describe('Turnstile', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('aceita resposta oficial de teste vinculada a hostname e action', async () => {
    const mockedFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ success: true, hostname: 'localhost', action: 'login' }));
    vi.stubGlobal('fetch', mockedFetch);

    await expect(
      verifyTurnstile(enabledEnvironment(), 'test-token', 'login'),
    ).resolves.toBeUndefined();
    expect(mockedFetch).toHaveBeenCalledOnce();
  });

  it('recusa action diferente mesmo quando o provedor indica sucesso', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          Response.json({ success: true, hostname: 'localhost', action: 'register' }),
        ),
    );

    await expect(
      verifyTurnstile(enabledEnvironment(), 'test-token', 'login'),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });
});
