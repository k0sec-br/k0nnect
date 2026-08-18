import { Hono } from 'hono';

import { realtimeSessionRequestSchema } from '../../shared/schemas/realtime';
import { requireSession, verifyCsrf } from '../auth/session';
import type { AppBindings } from '../app-types';
import { AppError } from '../errors/app-error';
import { parseJson, success } from '../http';
import { developmentRealtimeResponse } from '../realtime/development-realtime';
import { CloudflareRealtimeClient } from '../realtime/cloudflare-realtime';
import { roomExists } from '../repositories/rooms';
import { enforceRateLimit, RATE_LIMIT_POLICIES, requestIp } from '../security/rate-limit';

export const realtimeRoutes = new Hono<AppBindings>();

realtimeRoutes.post('/session', async (context) => {
  const authenticated = await requireSession(context);
  await verifyCsrf(context, authenticated);
  const input = await parseJson(context, realtimeSessionRequestSchema);
  if (!(await roomExists(context.env.DB, input.roomId)))
    throw new AppError('ROOM_UNAVAILABLE', 404);
  await Promise.all([
    enforceRateLimit(context.env, `ip:${requestIp(context.req.raw)}`, RATE_LIMIT_POLICIES.realtime),
    enforceRateLimit(context.env, authenticated.user.id, RATE_LIMIT_POLICIES.realtime),
  ]);

  const room = context.env.VOICE_ROOMS.getByName(input.roomId);
  if (!(await room.hasConnection(authenticated.user.id, input.connectionId))) {
    throw new AppError('ROOM_UNAVAILABLE', 409);
  }

  if (context.env.REALTIME_ENABLED !== 'true') {
    const response = developmentRealtimeResponse(input);
    if (input.action === 'create') {
      const sessionId = (response as { sessionId: string }).sessionId;
      await room.registerRealtimeSession(authenticated.user.id, input.connectionId, sessionId);
    }
    return success(context, response);
  }

  const realtime = new CloudflareRealtimeClient(context.env);
  if (input.action === 'create') {
    const response = await realtime.createSession();
    if (
      !(await room.registerRealtimeSession(
        authenticated.user.id,
        input.connectionId,
        response.sessionId,
      ))
    ) {
      throw new AppError('ROOM_UNAVAILABLE', 409);
    }
    return success(context, response, 201);
  }

  if (input.action === 'turn')
    return success(context, await realtime.generateTurnCredentials(), 201);

  if (
    !(await room.ownsRealtimeSession(authenticated.user.id, input.connectionId, input.sessionId))
  ) {
    throw new AppError('FORBIDDEN', 403);
  }

  if (input.action === 'publish') {
    const requestedTrackName = `audio_${input.connectionId.replaceAll('-', '')}`;
    const response = await realtime.publishAudio(
      input.sessionId,
      input.sessionDescription,
      input.mid,
      requestedTrackName,
    );
    const trackName = response.tracks[0]?.trackName;
    if (!trackName) throw new AppError('MEDIA_UNAVAILABLE', 502);
    if (
      !(await room.publishAudioTrack(
        authenticated.user.id,
        input.connectionId,
        input.sessionId,
        trackName,
      ))
    ) {
      throw new AppError('ROOM_UNAVAILABLE', 409);
    }
    return success(context, response, 201);
  }

  if (input.action === 'subscribe') {
    if (
      !(await room.canSubscribe(
        authenticated.user.id,
        input.connectionId,
        input.remoteSessionId,
        input.remoteTrackName,
      ))
    ) {
      throw new AppError('FORBIDDEN', 403);
    }
    return success(
      context,
      await realtime.subscribeAudio(input.sessionId, input.remoteSessionId, input.remoteTrackName),
      201,
    );
  }

  if (input.action === 'renegotiate') {
    await realtime.renegotiate(input.sessionId, input.sessionDescription);
    return success(context, { renegotiated: true });
  }

  if (
    !(await room.ownsTrack(
      authenticated.user.id,
      input.connectionId,
      input.sessionId,
      input.trackName,
    ))
  ) {
    throw new AppError('FORBIDDEN', 403);
  }
  const response = await realtime.closeTrack(input.sessionId, input.trackName);
  await room.clearTrack(authenticated.user.id, input.connectionId, input.trackName);
  return success(context, response);
});
