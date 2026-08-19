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
  if (!(await roomExists(context.env.DB, input.roomId))) {
    throw new AppError('ROOM_UNAVAILABLE', 404);
  }
  await Promise.all([
    enforceRateLimit(context.env, `ip:${requestIp(context.req.raw)}`, RATE_LIMIT_POLICIES.realtime),
    enforceRateLimit(context.env, authenticated.user.id, RATE_LIMIT_POLICIES.realtime),
    enforceRateLimit(
      context.env,
      authenticated.user.id,
      input.action === 'create'
        ? RATE_LIMIT_POLICIES.realtimeSession
        : input.action === 'turn'
          ? RATE_LIMIT_POLICIES.realtimeTurn
          : RATE_LIMIT_POLICIES.realtimeMedia,
    ),
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
    const registered = await room.registerRealtimeSession(
      authenticated.user.id,
      input.connectionId,
      response.sessionId,
    );
    if (!registered) throw new AppError('ROOM_UNAVAILABLE', 409);
    return success(context, response, 201);
  }

  if (input.action === 'turn') {
    return success(context, await realtime.generateTurnCredentials(), 201);
  }

  const ownsSession = await room.ownsRealtimeSession(
    authenticated.user.id,
    input.connectionId,
    input.sessionId,
  );
  if (!ownsSession) throw new AppError('FORBIDDEN', 403);

  if (input.action === 'publish') {
    const publicationId = await room.reservePublication(
      authenticated.user.id,
      input.connectionId,
      input.sessionId,
      input.source,
      input.mid,
    );
    if (!publicationId) throw new AppError('FORBIDDEN', 409);

    try {
      const requestedTrackName = `${input.source.replace('-', '_')}_${crypto.randomUUID().replaceAll('-', '')}`;
      const response = await realtime.publishTrack(
        input.sessionId,
        input.sessionDescription,
        input.mid,
        requestedTrackName,
      );
      const trackName = response.tracks[0]?.trackName;
      if (!trackName) throw new AppError('MEDIA_UNAVAILABLE', 502);
      const publication = await room.completePublication(
        authenticated.user.id,
        input.connectionId,
        publicationId,
        trackName,
      );
      if (!publication) throw new AppError('ROOM_UNAVAILABLE', 409);
      return success(
        context,
        {
          publication,
          sessionDescription: response.sessionDescription,
          requiresImmediateRenegotiation: response.requiresImmediateRenegotiation ?? false,
        },
        201,
      );
    } catch (error) {
      await room.cancelPublication(authenticated.user.id, input.connectionId, publicationId);
      throw error;
    }
  }

  if (input.action === 'subscribe') {
    const resolved = await room.reserveSubscription(
      authenticated.user.id,
      input.connectionId,
      input.sessionId,
      input.publicationId,
    );
    if (!resolved) throw new AppError('FORBIDDEN', 403);
    try {
      const response = await realtime.subscribeTrack(
        input.sessionId,
        resolved.realtimeSessionId,
        resolved.realtimeTrackName,
        resolved.publication.source,
        input.preferredRid,
      );
      const mid = response.tracks[0]?.mid;
      if (!mid || !response.sessionDescription) throw new AppError('MEDIA_UNAVAILABLE', 502);
      const completed = await room.completeSubscription(
        authenticated.user.id,
        input.connectionId,
        input.sessionId,
        input.publicationId,
        mid,
      );
      if (!completed) throw new AppError('ROOM_UNAVAILABLE', 409);
      return success(
        context,
        {
          publication: resolved.publication,
          mid,
          sessionDescription: response.sessionDescription,
          requiresImmediateRenegotiation: response.requiresImmediateRenegotiation ?? false,
        },
        201,
      );
    } catch (error) {
      await room.cancelSubscription(authenticated.user.id, input.connectionId, input.publicationId);
      throw error;
    }
  }

  if (input.action === 'renegotiate') {
    await realtime.renegotiate(input.sessionId, input.sessionDescription);
    return success(context, { renegotiated: true });
  }

  if (input.action === 'unsubscribe') {
    const mid = await room.takeSubscription(
      authenticated.user.id,
      input.connectionId,
      input.sessionId,
      input.publicationId,
    );
    if (!mid) throw new AppError('FORBIDDEN', 403);
    const response = await realtime.closeTrack(input.sessionId, mid);
    return success(context, {
      closed: true,
      sessionDescription: response.sessionDescription,
      requiresImmediateRenegotiation: response.requiresImmediateRenegotiation ?? false,
    });
  }

  const owned = await room.resolveOwnedPublication(
    authenticated.user.id,
    input.connectionId,
    input.sessionId,
    input.publicationId,
  );
  if (!owned) throw new AppError('FORBIDDEN', 403);
  const screenAudio =
    owned.publication.source === 'screen-video'
      ? await room.resolveOwnedPublicationBySource(
          authenticated.user.id,
          input.connectionId,
          input.sessionId,
          'screen-audio',
        )
      : null;
  const publicationsToClose = [owned, ...(screenAudio ? [screenAudio] : [])];
  for (const publication of publicationsToClose) {
    await room.removePublication(
      authenticated.user.id,
      input.connectionId,
      publication.publication.publicationId,
      input.reason,
    );
  }
  const response = await realtime.closeTracks(
    input.sessionId,
    publicationsToClose.map((publication) => publication.mid),
  );
  await room.completePublicationClosures(
    authenticated.user.id,
    input.connectionId,
    publicationsToClose.map((publication) => publication.publication.publicationId),
  );
  return success(context, {
    closed: true,
    sessionDescription: response.sessionDescription,
    requiresImmediateRenegotiation: response.requiresImmediateRenegotiation ?? false,
  });
});
