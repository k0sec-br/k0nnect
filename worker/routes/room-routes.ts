import { Hono } from 'hono';

import { requireSession, verifyCsrf } from '../auth/session';
import { requireRoomAccess } from '../auth/authorization';
import type { AppBindings } from '../app-types';
import { AppError } from '../errors/app-error';
import { success } from '../http';
import { listVoiceRooms } from '../repositories/rooms';
import { validateRequestOrigin } from '../security/origin';
import { enforceRateLimit, RATE_LIMIT_POLICIES, requestIp } from '../security/rate-limit';

export const roomRoutes = new Hono<AppBindings>();

roomRoutes.get('/', async (context) => {
  await requireSession(context);
  return success(context, { rooms: await listVoiceRooms(context.env.DB) });
});

roomRoutes.post('/:roomId/join', async (context) => {
  const authenticated = await requireSession(context);
  await verifyCsrf(context, authenticated);
  const roomId = context.req.param('roomId');
  await requireRoomAccess(context.env, roomId);
  return success(context, { roomId });
});

roomRoutes.post('/:roomId/leave', async (context) => {
  const authenticated = await requireSession(context);
  await verifyCsrf(context, authenticated);
  return success(context, { left: true });
});

roomRoutes.get('/:roomId/socket', async (context) => {
  validateRequestOrigin(context.req.raw, context.env);
  if (context.req.header('Upgrade')?.toLowerCase() !== 'websocket') {
    throw new AppError('ROOM_UNAVAILABLE', 426);
  }
  const authenticated = await requireSession(context);
  const roomId = context.req.param('roomId');
  await requireRoomAccess(context.env, roomId);
  await Promise.all([
    enforceRateLimit(
      context.env,
      `ip:${requestIp(context.req.raw)}`,
      RATE_LIMIT_POLICIES.websocket,
    ),
    enforceRateLimit(context.env, authenticated.user.id, RATE_LIMIT_POLICIES.websocket),
  ]);

  const room = context.env.VOICE_ROOMS.getByName(roomId);
  const request = new Request(context.req.url, {
    headers: {
      Upgrade: 'websocket',
      'X-K0nnect-User-Id': authenticated.user.id,
      'X-K0nnect-Display-Name': encodeURIComponent(authenticated.user.displayName),
    },
  });
  return room.fetch(request);
});
