import { AppError } from '../errors/app-error';

interface TurnstileResponse {
  success: boolean;
  hostname?: string;
  action?: string;
}

export async function verifyTurnstile(
  env: Env,
  token: string | undefined,
  expectedAction: string,
): Promise<void> {
  if (env.TURNSTILE_ENABLED !== 'true') return;
  if (!token || !env.TURNSTILE_SECRET) throw new AppError('VALIDATION_ERROR', 400);

  const body = new FormData();
  body.set('secret', env.TURNSTILE_SECRET);
  body.set('response', token);
  body.set('idempotency_key', crypto.randomUUID());

  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body,
  });
  if (!response.ok) throw new AppError('INTERNAL_ERROR', 503);
  const result: TurnstileResponse = await response.json();
  const expectedHostname = new URL(env.APP_ORIGIN).hostname;
  if (!result.success || result.hostname !== expectedHostname || result.action !== expectedAction) {
    throw new AppError('VALIDATION_ERROR', 400);
  }
}
