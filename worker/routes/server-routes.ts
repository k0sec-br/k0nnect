import { Hono } from 'hono';

import { SESSION_IDLE_SECONDS } from '../../shared/constants/security';
import { requireSession } from '../auth/session';
import type { AppBindings } from '../app-types';
import { AppError } from '../errors/app-error';
import { validateRequestOrigin } from '../security/origin';
import { enforceRateLimit, RATE_LIMIT_POLICIES, requestIp } from '../security/rate-limit';
import { PRIMARY_SERVER } from './bootstrap-route';

export const serverRoutes = new Hono<AppBindings>();

serverRoutes.get('/:serverId/socket', async (context) => {
  validateRequestOrigin(context.req.raw, context.env);
  if (context.req.header('Upgrade')?.toLowerCase() !== 'websocket') {
    throw new AppError('ROOM_UNAVAILABLE', 426);
  }
  const authenticated = await requireSession(context);
  const serverId = context.req.param('serverId');
  if (serverId !== PRIMARY_SERVER.id) throw new AppError('ROOM_UNAVAILABLE', 404);
  await Promise.all([
    enforceRateLimit(
      context.env,
      `ip:${requestIp(context.req.raw)}`,
      RATE_LIMIT_POLICIES.websocket,
    ),
    enforceRateLimit(context.env, authenticated.user.id, RATE_LIMIT_POLICIES.websocket),
  ]);

  const server = context.env.SERVER_REALTIME.getByName(serverId);
  const sessionCheckAt = Math.min(
    new Date(authenticated.session.expiresAt).getTime(),
    new Date(authenticated.session.lastSeenAt).getTime() + SESSION_IDLE_SECONDS * 1_000,
  );
  const request = new Request(context.req.url, {
    headers: {
      Upgrade: 'websocket',
      'X-K0nnect-User-Id': authenticated.user.id,
      'X-K0nnect-Session-Id': authenticated.session.id,
      'X-K0nnect-Session-Check-At': String(sessionCheckAt),
    },
  });
  return server.fetch(request);
});
