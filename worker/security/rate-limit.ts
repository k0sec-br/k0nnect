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
  realtimeSession: { name: 'realtime-session', limit: 10, windowSeconds: 60 },
  realtimeTurn: { name: 'realtime-turn', limit: 10, windowSeconds: 60 },
  realtimeMedia: { name: 'realtime-media', limit: 60, windowSeconds: 60 },
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

export async function enforceRateLimits(
  env: Env,
  actor: string,
  policies: RateLimitPolicy[],
): Promise<RateLimitDecision[]> {
  if (!env.PASSWORD_PEPPER || !env.SECURITY_GATES) throw new AppError('INTERNAL_ERROR', 503);
  const actorHash = await keyedIdentifierHash(actor, env.PASSWORD_PEPPER);
  const decisions = await env.SECURITY_GATES.getByName(actorHash).consumeMany(
    policies.map((policy) => ({
      policy: policy.name,
      limit: policy.limit,
      windowSeconds: policy.windowSeconds,
    })),
  );
  const blocked = decisions.find((decision) => !decision.allowed);
  if (blocked) throw new AppError('RATE_LIMITED', 429, blocked.retryAfter);
  return decisions;
}

export function requestIp(request: Request): string {
  return request.headers.get('CF-Connecting-IP') ?? 'local-development';
}
