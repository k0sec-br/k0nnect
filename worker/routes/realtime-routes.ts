import { Hono } from 'hono';

import { realtimeSessionRequestSchema } from '../../shared/schemas/realtime';
import { requireSession, verifyCsrf } from '../auth/session';
import type { AppBindings } from '../app-types';
import { AppError } from '../errors/app-error';
import { parseJson, success } from '../http';
import { developmentRealtimeResponse } from '../realtime/development-realtime';
import { CloudflareRealtimeClient } from '../realtime/cloudflare-realtime';
import {
  enforceRateLimit,
  enforceRateLimits,
  RATE_LIMIT_POLICIES,
  requestIp,
} from '../security/rate-limit';

export const realtimeRoutes = new Hono<AppBindings>();

realtimeRoutes.post('/session', async (context) => {
  const authenticated = await requireSession(context);
  await verifyCsrf(context, authenticated);
  const input = await parseJson(context, realtimeSessionRequestSchema);
  await Promise.all([
    enforceRateLimit(context.env, `ip:${requestIp(context.req.raw)}`, RATE_LIMIT_POLICIES.realtime),
    enforceRateLimits(context.env, authenticated.user.id, [
      RATE_LIMIT_POLICIES.realtime,
      input.action === 'create'
        ? RATE_LIMIT_POLICIES.realtimeSession
        : RATE_LIMIT_POLICIES.realtimeMedia,
    ]),
  ]);

  const server = context.env.SERVER_REALTIME.getByName('k0sec');
  if (!(await server.hasActiveCall(authenticated.user.id, input.connectionId, input.roomId))) {
    throw new AppError('ROOM_UNAVAILABLE', 409);
  }

  if (context.env.REALTIME_ENABLED !== 'true') {
    const response = developmentRealtimeResponse(input);
    if (input.action === 'create') {
      const sessionId = (response as { sessionId: string }).sessionId;
      await server.registerRealtimeSession(authenticated.user.id, input.connectionId, sessionId);
    }
    return success(context, response);
  }

  const realtime = new CloudflareRealtimeClient(context.env);
  if (input.action === 'create') {
    const [response, turn] = await Promise.all([
      realtime.createSession(),
      realtime.generateTurnCredentials(),
    ]);
    const registered = await server.registerRealtimeSession(
      authenticated.user.id,
      input.connectionId,
      response.sessionId,
    );
    if (!registered) throw new AppError('ROOM_UNAVAILABLE', 409);
    return success(context, { ...response, iceServers: turn.iceServers }, 201);
  }

  const ownsSession = await server.ownsRealtimeSession(
    authenticated.user.id,
    input.connectionId,
    input.sessionId,
  );
  if (!ownsSession) throw new AppError('FORBIDDEN', 403);

  if (input.action === 'publish') {
    const reservations = await server.reservePublications(
      authenticated.user.id,
      input.connectionId,
      input.sessionId,
      input.tracks,
    );
    if (!reservations) throw new AppError('FORBIDDEN', 409);

    try {
      const requestedTracks = reservations.map((reservation) => ({
        mid: reservation.mid,
        trackName: `${reservation.source.replace('-', '_')}_${crypto.randomUUID().replaceAll('-', '')}`,
      }));
      const response = await realtime.publishTracks(
        input.sessionId,
        input.sessionDescription,
        requestedTracks,
      );
      if (response.tracks.length !== reservations.length) {
        throw new AppError('MEDIA_UNAVAILABLE', 502);
      }
      const publications = await server.completePublications(
        authenticated.user.id,
        input.connectionId,
        reservations.map((reservation, index) => ({
          publicationId: reservation.publicationId,
          realtimeTrackName: response.tracks[index]!.trackName,
        })),
      );
      if (!publications) throw new AppError('ROOM_UNAVAILABLE', 409);
      return success(
        context,
        {
          publications,
          sessionDescription: response.sessionDescription,
          requiresImmediateRenegotiation: response.requiresImmediateRenegotiation ?? false,
        },
        201,
      );
    } catch (error) {
      await server.cancelPublications(
        authenticated.user.id,
        input.connectionId,
        reservations.map((reservation) => reservation.publicationId),
      );
      throw error;
    }
  }

  if (input.action === 'subscribe') {
    const resolved = await server.reserveSubscriptions(
      authenticated.user.id,
      input.connectionId,
      input.sessionId,
      input.publicationIds,
    );
    if (!resolved) throw new AppError('FORBIDDEN', 403);
    try {
      const response = await realtime.subscribeTracks(
        input.sessionId,
        resolved.map((publication) => ({
          remoteSessionId: publication.realtimeSessionId,
          remoteTrackName: publication.realtimeTrackName,
          source: publication.publication.source,
          ...(publication.publication.source === 'camera' ? { preferredRid: 'b' } : {}),
        })),
      );
      if (response.tracks.length !== resolved.length || !response.sessionDescription) {
        throw new AppError('MEDIA_UNAVAILABLE', 502);
      }
      const subscriptions = resolved.map((publication, index) => ({
        publicationId: publication.publication.publicationId,
        mid: response.tracks[index]!.mid ?? '',
      }));
      if (subscriptions.some((subscription) => !subscription.mid)) {
        throw new AppError('MEDIA_UNAVAILABLE', 502);
      }
      const completed = await server.completeSubscriptions(
        authenticated.user.id,
        input.connectionId,
        input.sessionId,
        subscriptions,
      );
      if (!completed) throw new AppError('ROOM_UNAVAILABLE', 409);
      return success(
        context,
        {
          subscriptions: resolved.map((publication, index) => ({
            publication: publication.publication,
            mid: subscriptions[index]!.mid,
          })),
          sessionDescription: response.sessionDescription,
          requiresImmediateRenegotiation: response.requiresImmediateRenegotiation ?? false,
        },
        201,
      );
    } catch (error) {
      await server.cancelSubscriptions(
        authenticated.user.id,
        input.connectionId,
        input.publicationIds,
      );
      throw error;
    }
  }

  if (input.action === 'renegotiate') {
    await realtime.renegotiate(input.sessionId, input.sessionDescription);
    return success(context, { renegotiated: true });
  }

  if (input.action === 'unsubscribe') {
    const mid = await server.takeSubscription(
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

  const owned = await server.resolveOwnedPublication(
    authenticated.user.id,
    input.connectionId,
    input.sessionId,
    input.publicationId,
  );
  if (!owned) throw new AppError('FORBIDDEN', 403);
  const screenAudio =
    owned.publication.source === 'screen-video'
      ? await server.resolveOwnedPublicationBySource(
          authenticated.user.id,
          input.connectionId,
          input.sessionId,
          'screen-audio',
        )
      : null;
  const publicationsToClose = [owned, ...(screenAudio ? [screenAudio] : [])];
  for (const publication of publicationsToClose) {
    await server.removePublication(
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
  await server.completePublicationClosures(
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
