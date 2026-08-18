import { keyedIdentifierHash } from '../crypto/tokens';
import { AppError } from '../errors/app-error';
import type { RateLimitDecision } from '../durable/security-gate';

export interface RateLimitPolicy {
  name: string;
  limit: number;
  windowSeconds: number;
}

export const RATE_LIMIT_POLICIES = {
  api: { name: 'api', limit: 60, windowSeconds: 60 },
  login: { name: 'login', limit: 5, windowSeconds: 60 },
  loginAccount: { name: 'login-account', limit: 20, windowSeconds: 60 },
  recovery: { name: 'recovery', limit: 5, windowSeconds: 60 },
  inviteRedeem: { name: 'invite-redeem', limit: 5, windowSeconds: 60 },
  realtime: { name: 'realtime', limit: 180, windowSeconds: 60 },
  realtimePublish: { name: 'realtime-publish', limit: 30, windowSeconds: 60 },
  websocket: { name: 'websocket', limit: 20, windowSeconds: 60 },
  adminInvite: { name: 'admin-invite', limit: 10, windowSeconds: 3_600 },
} satisfies Record<string, RateLimitPolicy>;

export async function enforceRateLimit(
  env: Env,
  actor: string,
  policy: RateLimitPolicy,
): Promise<RateLimitDecision> {
  if (!env.PASSWORD_PEPPER || !env.SECURITY_GATES) throw new AppError('INTERNAL_ERROR', 503);
  const actorHash = await keyedIdentifierHash(actor, env.PASSWORD_PEPPER);
  const gate = env.SECURITY_GATES.getByName(actorHash);
  const decision = await gate.consume(policy.name, policy.limit, policy.windowSeconds);
  if (!decision.allowed) throw new AppError('RATE_LIMITED', 429, decision.retryAfter);
  return decision;
}

export function requestIp(request: Request): string {
  return request.headers.get('CF-Connecting-IP') ?? 'local-development';
}
