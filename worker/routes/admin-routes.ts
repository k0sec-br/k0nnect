import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';

import { createInviteSchema, inviteIdSchema } from '../../shared/schemas/invites';
import { requireRole } from '../auth/authorization';
import { requireSession, verifyCsrf } from '../auth/session';
import type { AppBindings } from '../app-types';
import { AppError } from '../errors/app-error';
import { parseJson, success } from '../http';
import { enforceRateLimit, RATE_LIMIT_POLICIES } from '../security/rate-limit';
import { createInvite, listInvites, revokeInvite } from '../services/invite-service';

export const adminRoutes = new Hono<AppBindings>();

const requireAdministrativeRole = createMiddleware<AppBindings>(async (context, next) => {
  const authenticated = await requireSession(context);
  requireRole(authenticated, ['owner', 'admin']);
  context.set('authenticated', authenticated);
  await next();
});

adminRoutes.use('*', requireAdministrativeRole);

adminRoutes.get('/invites', async (context) =>
  success(context, { invites: await listInvites(context.env) }),
);

adminRoutes.post('/invites', async (context) => {
  const authenticated = context.get('authenticated');
  await verifyCsrf(context, authenticated);
  await enforceRateLimit(context.env, authenticated.user.id, RATE_LIMIT_POLICIES.adminInvite);
  const input = await parseJson(context, createInviteSchema);
  return success(context, await createInvite(context.env, authenticated.user, input.role), 201);
});

adminRoutes.delete('/invites/:inviteId', async (context) => {
  const authenticated = context.get('authenticated');
  await verifyCsrf(context, authenticated);
  const parsedId = inviteIdSchema.safeParse(context.req.param('inviteId'));
  if (!parsedId.success) throw new AppError('INVITE_UNAVAILABLE', 404);
  await revokeInvite(context.env, parsedId.data);
  return success(context, { revoked: true });
});
