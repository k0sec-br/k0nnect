import { z } from 'zod';

import { AppError } from '../errors/app-error';
import { findAudioTransceiverMid } from './sdp';

const REALTIME_API_ORIGIN = 'https://rtc.live.cloudflare.com/v1';
const MAX_REALTIME_RESPONSE_BYTES = 1_048_576;

const sessionDescriptionSchema = z.object({
  type: z.enum(['offer', 'answer']),
  sdp: z.string().min(1).max(524_288),
});

const newSessionResponseSchema = z.object({
  sessionId: z.string().min(1).max(128),
  sessionDescription: sessionDescriptionSchema.optional(),
});

const tracksResponseSchema = z.object({
  sessionDescription: sessionDescriptionSchema,
  tracks: z
    .array(
      z.object({
        trackName: z.string().min(1).max(128),
        mid: z.string().max(32).optional(),
      }),
    )
    .default([]),
});

const closeTracksResponseSchema = z.object({
  requiresImmediateRenegotiation: z.boolean().optional(),
});

const iceServerSchema = z.object({
  urls: z.union([z.string(), z.array(z.string())]),
  username: z.string().optional(),
  credential: z.string().optional(),
});

const turnResponseSchema = z.object({ iceServers: z.array(iceServerSchema).min(1) });

async function readLimitedJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    totalBytes += chunk.value.byteLength;
    if (totalBytes > MAX_REALTIME_RESPONSE_BYTES) {
      await reader.cancel();
      throw new AppError('MEDIA_UNAVAILABLE', 502);
    }
    chunks.push(chunk.value);
  }
  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(body));
  } catch {
    throw new AppError('MEDIA_UNAVAILABLE', 502);
  }
}

export class CloudflareRealtimeClient {
  constructor(private readonly env: Env) {}

  async createSession() {
    return newSessionResponseSchema.parse(await this.request('/sessions/new', 'POST'));
  }

  async publishAudio(
    sessionId: string,
    sessionDescription: { type: 'offer'; sdp: string },
    mid: string | undefined,
    trackName: string,
  ) {
    const audioMid = mid ?? findAudioTransceiverMid(sessionDescription.sdp);
    if (!audioMid) throw new AppError('MEDIA_UNAVAILABLE', 400);
    const response = await this.request(
      `/sessions/${encodeURIComponent(sessionId)}/tracks/new`,
      'POST',
      {
        sessionDescription,
        tracks: [{ location: 'local', mid: audioMid, trackName }],
      },
    );
    return tracksResponseSchema.parse(response);
  }

  async subscribeAudio(sessionId: string, remoteSessionId: string, remoteTrackName: string) {
    const response = await this.request(
      `/sessions/${encodeURIComponent(sessionId)}/tracks/new`,
      'POST',
      {
        tracks: [{ location: 'remote', sessionId: remoteSessionId, trackName: remoteTrackName }],
      },
    );
    return tracksResponseSchema.parse(response);
  }

  async renegotiate(sessionId: string, sessionDescription: { type: 'answer'; sdp: string }) {
    return this.request(`/sessions/${encodeURIComponent(sessionId)}/renegotiate`, 'PUT', {
      sessionDescription,
    });
  }

  async closeTrack(sessionId: string, trackName: string) {
    const response = await this.request(
      `/sessions/${encodeURIComponent(sessionId)}/tracks/close`,
      'PUT',
      {
        tracks: [{ location: 'local', trackName }],
      },
    );
    return closeTracksResponseSchema.parse(response);
  }

  async generateTurnCredentials() {
    if (!this.env.TURN_KEY_ID || !this.env.TURN_KEY_API_TOKEN) {
      throw new AppError('MEDIA_UNAVAILABLE', 503);
    }
    const response = await fetch(
      `${REALTIME_API_ORIGIN}/turn/keys/${encodeURIComponent(this.env.TURN_KEY_ID)}/credentials/generate-ice-servers`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.env.TURN_KEY_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ttl: 3_600 }),
      },
    );
    if (!response.ok) throw new AppError('MEDIA_UNAVAILABLE', 502);
    return turnResponseSchema.parse(await readLimitedJson(response));
  }

  private async request(path: string, method: 'POST' | 'PUT', body?: unknown): Promise<unknown> {
    if (!this.env.REALTIME_APP_ID || !this.env.REALTIME_APP_SECRET) {
      throw new AppError('MEDIA_UNAVAILABLE', 503);
    }
    const response = await fetch(
      `${REALTIME_API_ORIGIN}/apps/${encodeURIComponent(this.env.REALTIME_APP_ID)}${path}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${this.env.REALTIME_APP_SECRET}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
    );
    if (!response.ok) throw new AppError('MEDIA_UNAVAILABLE', 502);
    return readLimitedJson(response);
  }
}
