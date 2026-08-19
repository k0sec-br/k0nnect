import { Hono } from 'hono';

import {
  loginSchema,
  recoverAccountSchema,
  regenerateRecoveryCodesSchema,
  registerInviteSchema,
} from '../../shared/schemas/auth';
import {
  clearSessionCookie,
  loadSession,
  readSessionToken,
  requireSession,
  rotateCsrfToken,
  verifyCsrf,
  writeSessionCookie,
} from '../auth/session';
import type { AppBindings } from '../app-types';
import { parseJson, success } from '../http';
import { findUserByUsername } from '../repositories/users';
import { enforceRateLimit, RATE_LIMIT_POLICIES, requestIp } from '../security/rate-limit';
import { verifyTurnstile } from '../security/turnstile';
import {
  listSessions,
  login,
  logoutAllSessions,
  logoutSession,
  recoverAccount,
  regenerateRecoveryCodes,
  registerWithInvite,
} from '../services/auth-service';

export const authRoutes = new Hono<AppBindings>();

authRoutes.post('/register-invite', async (context) => {
  const input = await parseJson(context, registerInviteSchema);
  const limit = await enforceRateLimit(
    context.env,
    `ip:${requestIp(context.req.raw)}`,
    RATE_LIMIT_POLICIES.inviteRedeem,
  );
  if (limit.count >= 3) await verifyTurnstile(context.env, input.turnstileToken, 'register');
  const result = await registerWithInvite(context.env, input);
  context.executionCtx.waitUntil(
    context.env.SERVER_REALTIME.getByName('k0sec').announceMember('member.added', {
      id: result.user.id,
      displayName: result.user.displayName,
      role: result.user.role,
    }),
  );
  writeSessionCookie(context, result.sessionToken);
  return success(
    context,
    { user: result.user, csrfToken: result.csrfToken, recoveryCodes: result.recoveryCodes },
    201,
  );
});

authRoutes.post('/login', async (context) => {
  const input = await parseJson(context, loginSchema);
  const [ipLimit, accountLimit] = await Promise.all([
    enforceRateLimit(context.env, `ip:${requestIp(context.req.raw)}`, RATE_LIMIT_POLICIES.login),
    enforceRateLimit(context.env, `account:${input.username}`, RATE_LIMIT_POLICIES.loginAccount),
  ]);
  const user = await findUserByUsername(context.env.DB, input.username);
  if (Math.max(ipLimit.count, accountLimit.count, user?.failedLoginCount ?? 0) >= 3) {
    await verifyTurnstile(context.env, input.turnstileToken, 'login');
  }
  const result = await login(context.env, input, readSessionToken(context));
  writeSessionCookie(context, result.sessionToken);
  return success(context, { user: result.user, csrfToken: result.csrfToken });
});

authRoutes.post('/recover', async (context) => {
  const input = await parseJson(context, recoverAccountSchema);
  const [ipLimit, accountLimit] = await Promise.all([
    enforceRateLimit(context.env, `ip:${requestIp(context.req.raw)}`, RATE_LIMIT_POLICIES.recovery),
    enforceRateLimit(context.env, `recovery:${input.username}`, RATE_LIMIT_POLICIES.recovery),
  ]);
  if (Math.max(ipLimit.count, accountLimit.count) >= 3) {
    await verifyTurnstile(context.env, input.turnstileToken, 'recover');
  }
  const result = await recoverAccount(context.env, input);
  context.executionCtx.waitUntil(
    context.env.SERVER_REALTIME.getByName('k0sec').disconnectUser(result.userId),
  );
  return success(context, { recoveryCodes: result.recoveryCodes });
});

authRoutes.get('/session', async (context) => {
  const authenticated = await loadSession(context);
  if (!authenticated) return success(context, { authenticated: false as const });
  const csrfToken = await rotateCsrfToken(context.env, authenticated.session.id);
  return success(context, { authenticated: true as const, user: authenticated.user, csrfToken });
});

authRoutes.post('/logout', async (context) => {
  const authenticated = await requireSession(context);
  await verifyCsrf(context, authenticated);
  await logoutSession(context.env, authenticated.session.id);
  context.executionCtx.waitUntil(
    context.env.SERVER_REALTIME.getByName('k0sec').disconnectSession(authenticated.session.id),
  );
  clearSessionCookie(context);
  return success(context, { loggedOut: true });
});

authRoutes.post('/logout-all', async (context) => {
  const authenticated = await requireSession(context);
  await verifyCsrf(context, authenticated);
  await logoutAllSessions(context.env, authenticated.user.id);
  context.executionCtx.waitUntil(
    context.env.SERVER_REALTIME.getByName('k0sec').disconnectUser(authenticated.user.id),
  );
  clearSessionCookie(context);
  return success(context, { loggedOut: true });
});

authRoutes.get('/sessions', async (context) => {
  const authenticated = await requireSession(context);
  return success(context, { sessions: await listSessions(context.env, authenticated) });
});

authRoutes.post('/recovery-codes/regenerate', async (context) => {
  const authenticated = await requireSession(context);
  await verifyCsrf(context, authenticated);
  const input = await parseJson(context, regenerateRecoveryCodesSchema);
  const result = await regenerateRecoveryCodes(context.env, authenticated, input.password);
  context.executionCtx.waitUntil(
    context.env.SERVER_REALTIME.getByName('k0sec').disconnectSession(
      authenticated.session.id,
      true,
    ),
  );
  writeSessionCookie(context, result.sessionToken);
  return success(context, { recoveryCodes: result.recoveryCodes, csrfToken: result.csrfToken });
});
