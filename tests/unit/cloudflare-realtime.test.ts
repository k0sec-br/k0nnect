import { afterEach, describe, expect, it, vi } from 'vitest';

import { CloudflareRealtimeClient } from '../../worker/realtime/cloudflare-realtime';

const TEST_ENV = {
  REALTIME_APP_ID: 'test-app',
  REALTIME_APP_SECRET: 'test-secret',
} as Env;

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function parsedRequestBody(body: unknown): unknown {
  if (typeof body !== 'string') throw new Error('Body JSON esperado');
  return JSON.parse(body) as unknown;
}

describe('CloudflareRealtimeClient', () => {
  afterEach(() => vi.restoreAllMocks());

  it('aceita resposta de fechamento que contém somente mid', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        jsonResponse({ tracks: [{ mid: '2' }], requiresImmediateRenegotiation: false }),
      );
    const response = await new CloudflareRealtimeClient(TEST_ENV).closeTrack('session_1', '2');

    expect(response.tracks).toEqual([{ mid: '2' }]);
    const request = fetchMock.mock.calls[0];
    expect(request?.[0]).toContain('/sessions/session_1/tracks/close');
    expect(parsedRequestBody(request?.[1]?.body)).toEqual({ tracks: [{ mid: '2' }] });
  });

  it('fecha áudio e vídeo da tela em uma única operação', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ tracks: [{ mid: '2' }, { mid: '3' }] }));
    await new CloudflareRealtimeClient(TEST_ENV).closeTracks('session_1', ['2', '3']);

    expect(parsedRequestBody(fetchMock.mock.calls[0]?.[1]?.body)).toEqual({
      tracks: [{ mid: '2' }, { mid: '3' }],
    });
  });

  it('configura fallback simulcast somente para câmera', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(
        jsonResponse({
          sessionDescription: { type: 'offer', sdp: 'v=0' },
          tracks: [{ mid: '3', sessionId: 'remote', trackName: 'track' }],
        }),
      ),
    );
    const client = new CloudflareRealtimeClient(TEST_ENV);
    await client.subscribeTrack('local', 'remote', 'track', 'camera', 'b');
    await client.subscribeTrack('local', 'remote', 'screen', 'screen-video');

    const cameraBody = parsedRequestBody(fetchMock.mock.calls[0]?.[1]?.body) as {
      tracks: { simulcast?: unknown }[];
    };
    const screenBody = parsedRequestBody(fetchMock.mock.calls[1]?.[1]?.body) as {
      tracks: { simulcast?: unknown }[];
    };
    expect(cameraBody.tracks[0]?.simulcast).toEqual({
      preferredRid: 'b',
      priorityOrdering: 'asciibetical',
      ridNotAvailable: 'asciibetical',
    });
    expect(screenBody.tracks[0]?.simulcast).toBeUndefined();
  });
});
