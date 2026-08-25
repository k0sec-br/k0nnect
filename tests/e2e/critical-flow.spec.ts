import { expect, test, type Page } from '@playwright/test';

import { REALTIME_PROTOCOL_VERSION } from '../../shared/protocol/room';

const USER = {
  id: '11111111-1111-4111-8111-111111111111',
  username: 'alice',
  displayName: 'Alice',
  role: 'member',
};
const BOB = {
  id: '22222222-2222-4222-8222-222222222222',
  username: 'bob',
  displayName: 'Bob',
  role: 'member',
};
const CAROL = {
  id: '33333333-3333-4333-8333-333333333333',
  username: 'carol',
  displayName: 'Carol',
  role: 'member',
};
const DM_CALL_ROOM_ID = `dmcall_${'a'.repeat(57)}`;
const RECOVERY_CODES = Array.from(
  { length: 10 },
  (_, index) => `AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-${String(index).padStart(4, '2A')}`,
);

async function installBrowserFakes(page: Page): Promise<void> {
  await page.addInitScript((protocolVersion) => {
    const testWindow = window as typeof window & {
      __k0nnectDropSocket(): void;
      __k0nnectFailPeer(): void;
      __k0nnectSocketStats: { closed: number; created: number };
    };
    testWindow.__k0nnectSocketStats = { closed: 0, created: 0 };
    const mediaSources = new WeakMap<HTMLMediaElement, unknown>();
    Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
      configurable: true,
      get() {
        return mediaSources.get(this as HTMLMediaElement) ?? null;
      },
      set(value: unknown) {
        mediaSources.set(this as HTMLMediaElement, value);
      },
    });
    class FakeMediaStream {
      constructor(readonly tracks: { kind: string; [key: string]: unknown }[] = []) {}
      getAudioTracks() {
        return this.tracks.filter((track) => track.kind === 'audio');
      }
      getVideoTracks() {
        return this.tracks.filter((track) => track.kind === 'video');
      }
      getTracks() {
        return this.tracks;
      }
    }

    const localTrack = {
      id: 'local-audio',
      kind: 'audio',
      enabled: true,
      readyState: 'live',
      stop() {},
      addEventListener() {},
      getSettings() {
        return { deviceId: 'default-mic' };
      },
    };
    const cameraTrack = {
      id: 'local-camera',
      kind: 'video',
      enabled: true,
      readyState: 'live',
      stop() {},
      addEventListener() {},
      getSettings() {
        return { deviceId: 'default-camera', facingMode: 'user', width: 640, height: 480 };
      },
    };
    const screenTrack = {
      id: 'local-screen',
      kind: 'video',
      enabled: true,
      readyState: 'live',
      stop() {},
      addEventListener() {},
      getSettings() {
        return {};
      },
    };
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        addEventListener() {},
        removeEventListener() {},
        async enumerateDevices() {
          return [
            { deviceId: 'default-mic', kind: 'audioinput', label: 'Microfone de teste' },
            { deviceId: 'secondary-mic', kind: 'audioinput', label: 'Microfone reserva' },
            { deviceId: 'default-camera', kind: 'videoinput', label: 'Câmera de teste' },
            { deviceId: 'rear-camera', kind: 'videoinput', label: 'Câmera traseira' },
          ];
        },
        async getUserMedia(constraints: MediaStreamConstraints) {
          const mediaConstraints =
            constraints.video !== undefined && constraints.video !== false
              ? constraints.video
              : constraints.audio;
          const deviceConstraint =
            typeof mediaConstraints === 'object' ? mediaConstraints.deviceId : undefined;
          const selectedDeviceId =
            typeof deviceConstraint === 'object' && 'exact' in deviceConstraint
              ? String(deviceConstraint.exact)
              : undefined;
          if (constraints.video) {
            const deviceId = selectedDeviceId ?? 'default-camera';
            return new FakeMediaStream([
              {
                ...cameraTrack,
                id: `local-camera-${deviceId}`,
                getSettings: () => ({
                  deviceId,
                  facingMode: deviceId === 'rear-camera' ? 'environment' : 'user',
                  width: deviceId === 'rear-camera' ? 1920 : 640,
                  height: deviceId === 'rear-camera' ? 1080 : 480,
                }),
              },
            ]);
          }
          const deviceId = selectedDeviceId ?? 'default-mic';
          return new FakeMediaStream([
            {
              ...localTrack,
              id: `local-audio-${deviceId}`,
              getSettings: () => ({ deviceId }),
            },
          ]);
        },
        async getDisplayMedia() {
          return new FakeMediaStream([screenTrack]);
        },
      },
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { async writeText() {} },
    });
    Object.defineProperty(window, 'MediaStream', { configurable: true, value: FakeMediaStream });
    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      value: class {
        createAnalyser() {
          return {
            fftSize: 0,
            smoothingTimeConstant: 0,
            frequencyBinCount: 8,
            getByteFrequencyData() {},
          };
        }
        createMediaStreamSource() {
          return { connect() {}, disconnect() {} };
        }
        async close() {}
      },
    });
    window.requestAnimationFrame = () => 1;
    window.cancelAnimationFrame = () => undefined;

    class FakePeerConnection extends EventTarget {
      static active: FakePeerConnection | null = null;
      connectionState = 'new';
      iceConnectionState = 'connected';
      iceGatheringState = 'complete';
      signalingState = 'stable';
      private transceivers: {
        mid: string;
        sender: { track: unknown; replaceTrack(track: unknown): Promise<void> };
      }[] = [];
      constructor() {
        super();
        FakePeerConnection.active = this;
      }
      addTransceiver(track: unknown, options?: RTCRtpTransceiverInit) {
        for (const encoding of options?.sendEncodings ?? []) {
          if (encoding.rid && !/^[A-Za-z0-9]+$/u.test(encoding.rid)) {
            throw new DOMException('RID inválido', 'InvalidAccessError');
          }
        }
        const sender = {
          track,
          async replaceTrack(nextTrack: unknown) {
            this.track = nextTrack;
          },
        };
        const transceiver = { mid: String(this.transceivers.length), sender };
        this.transceivers.push(transceiver);
        return transceiver;
      }
      getSenders() {
        return this.transceivers.map((transceiver) => transceiver.sender);
      }
      getReceivers() {
        return [];
      }
      getTransceivers() {
        return this.transceivers;
      }
      async createOffer() {
        return { type: 'offer', sdp: 'v=0' };
      }
      async createAnswer() {
        return { type: 'answer', sdp: 'v=0' };
      }
      async setLocalDescription() {}
      async setRemoteDescription() {
        this.connectionState = 'connected';
        this.dispatchEvent(new Event('connectionstatechange'));
      }
      close() {
        this.connectionState = 'closed';
      }
      fail() {
        this.connectionState = 'failed';
        this.iceConnectionState = 'failed';
        this.dispatchEvent(new Event('iceconnectionstatechange'));
        this.dispatchEvent(new Event('connectionstatechange'));
      }
    }
    Object.defineProperty(window, 'RTCPeerConnection', {
      configurable: true,
      value: FakePeerConnection,
    });
    testWindow.__k0nnectFailPeer = () => FakePeerConnection.active?.fail();

    let fullscreenElement: Element | null = null;
    Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true });
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => fullscreenElement,
    });
    Object.defineProperty(Element.prototype, 'requestFullscreen', {
      configurable: true,
      value: async function requestFullscreen() {
        fullscreenElement = this as Element;
        document.dispatchEvent(new Event('fullscreenchange'));
      },
    });
    Object.defineProperty(document, 'exitFullscreen', {
      configurable: true,
      value: async () => {
        fullscreenElement = null;
        document.dispatchEvent(new Event('fullscreenchange'));
      },
    });

    class FakeWebSocket extends EventTarget {
      static active: FakeWebSocket | null = null;
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSED = 3;
      readyState = FakeWebSocket.CONNECTING;
      activeChannelId: string | null = null;
      constructor(url: string) {
        super();
        FakeWebSocket.active = this;
        testWindow.__k0nnectSocketStats.created += 1;
        const socketUrl = new URL(url);
        const requestedEpoch = Number(socketUrl.searchParams.get('connectionEpoch'));
        const resumed = socketUrl.searchParams.has('connectionId');
        window.setTimeout(() => {
          this.readyState = FakeWebSocket.OPEN;
          this.dispatchEvent(new Event('open'));
          this.dispatchEvent(
            new MessageEvent('message', {
              data: JSON.stringify({
                v: protocolVersion,
                type: 'server.ready',
                payload: {
                  connectionId: '22222222-2222-4222-8222-222222222222',
                  connectionEpoch:
                    Number.isSafeInteger(requestedEpoch) && requestedEpoch > 0 ? requestedEpoch : 1,
                  resumed,
                  onlineUserIds: [
                    '11111111-1111-4111-8111-111111111111',
                    '22222222-2222-4222-8222-222222222222',
                  ],
                  participants: [
                    ...(resumed
                      ? [
                          {
                            userId: '11111111-1111-4111-8111-111111111111',
                            channelId: 'room_general',
                            muted: false,
                            deafened: false,
                            speaking: false,
                          },
                        ]
                      : []),
                    {
                      userId: '22222222-2222-4222-8222-222222222222',
                      channelId: 'room_private',
                      muted: false,
                      deafened: false,
                      speaking: true,
                    },
                    {
                      userId: '33333333-3333-4333-8333-333333333333',
                      channelId: `dmcall_${'a'.repeat(57)}`,
                      muted: true,
                      deafened: false,
                      speaking: false,
                    },
                  ],
                  publications: [],
                },
              }),
            }),
          );
        }, 10);
      }
      send(rawMessage: string) {
        const message = JSON.parse(rawMessage) as {
          type: string;
          payload: { channelId?: string; requestId?: string };
        };
        if (message.type === 'call.join' || message.type === 'call.takeover') {
          const channelId = message.payload.channelId ?? 'room_general';
          this.activeChannelId = channelId;
          const remoteParticipants =
            channelId === 'room_private'
              ? [
                  {
                    userId: '22222222-2222-4222-8222-222222222222',
                    channelId,
                    muted: false,
                    deafened: false,
                    speaking: true,
                  },
                ]
              : channelId.startsWith('dmcall_')
                ? [
                    {
                      userId: '33333333-3333-4333-8333-333333333333',
                      channelId,
                      muted: true,
                      deafened: false,
                      speaking: false,
                    },
                  ]
                : [];
          this.dispatchEvent(
            new MessageEvent('message', {
              data: JSON.stringify({
                v: protocolVersion,
                type: 'call.joined',
                payload: {
                  requestId: message.payload.requestId,
                  channelId,
                  participants: [
                    {
                      userId: '11111111-1111-4111-8111-111111111111',
                      channelId,
                      muted: false,
                      deafened: false,
                      speaking: false,
                    },
                    ...remoteParticipants,
                  ],
                  publications: [],
                },
              }),
            }),
          );
        }
        if (message.type === 'call.leave') {
          const channelId = this.activeChannelId ?? 'room_general';
          this.activeChannelId = null;
          this.dispatchEvent(
            new MessageEvent('message', {
              data: JSON.stringify({
                v: protocolVersion,
                type: 'call.member.left',
                payload: {
                  requestId: message.payload.requestId,
                  channelId,
                  userId: '11111111-1111-4111-8111-111111111111',
                },
              }),
            }),
          );
        }
      }
      close(code = 1000, reason = '') {
        testWindow.__k0nnectSocketStats.closed += 1;
        this.readyState = FakeWebSocket.CLOSED;
        this.dispatchEvent(new CloseEvent('close', { code, reason }));
      }
    }
    Object.defineProperty(window, 'WebSocket', { configurable: true, value: FakeWebSocket });
    testWindow.__k0nnectDropSocket = () => FakeWebSocket.active?.close(1012, 'Falha transitória');
  }, REALTIME_PROTOCOL_VERSION);
}

async function mockApi(page: Page): Promise<{ create: number; publish: number }> {
  const realtimeStats = { create: 0, publish: 0 };
  let authenticated = false;
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    let data: unknown;
    if (path === '/api/bootstrap') {
      data = authenticated
        ? {
            authenticated: true,
            user: USER,
            csrfToken: 'csrf',
            config: {
              realtimeEnabled: true,
              turnstileEnabled: false,
              turnstileSiteKey: null,
              registrationMode: 'invite',
            },
            server: { id: 'k0sec', name: 'K0Sec' },
            channels: [
              { id: 'room_general', slug: 'geral', name: 'Geral', kind: 'voice', position: 0 },
            ],
            members: [
              {
                id: USER.id,
                username: USER.username,
                displayName: USER.displayName,
                role: USER.role,
              },
              BOB,
              CAROL,
            ],
            friends: [
              {
                id: BOB.id,
                username: BOB.username,
                displayName: BOB.displayName,
                since: '2026-01-01',
              },
              {
                id: CAROL.id,
                username: CAROL.username,
                displayName: CAROL.displayName,
                since: '2026-01-01',
              },
            ],
            friendRequests: [],
            conversations: [
              {
                id: 'group_k0sec',
                kind: 'group',
                spaceKind: 'community',
                name: 'K0Sec',
                ownerUserId: null,
                callRoomId: 'room_general',
                isDefault: true,
                members: [{ id: USER.id, username: USER.username, displayName: USER.displayName }],
                lastMessage: null,
              },
              {
                id: 'group_private',
                kind: 'group',
                spaceKind: 'group',
                name: 'Cyber Study',
                ownerUserId: USER.id,
                callRoomId: 'room_private',
                isDefault: false,
                members: [USER, BOB],
                lastMessage: null,
              },
              {
                id: 'dm_alice_carol',
                kind: 'dm',
                spaceKind: null,
                name: 'Alice / Carol',
                ownerUserId: null,
                callRoomId: DM_CALL_ROOM_ID,
                isDefault: false,
                members: [USER, CAROL],
                lastMessage: null,
              },
            ],
            capabilities: { manageInvites: false },
          }
        : {
            authenticated: false,
            config: {
              realtimeEnabled: true,
              turnstileEnabled: false,
              turnstileSiteKey: null,
              registrationMode: 'invite',
            },
          };
    } else if (path === '/api/auth/register-invite') {
      authenticated = true;
      data = { user: USER, csrfToken: 'csrf', recoveryCodes: RECOVERY_CODES };
    } else if (path === '/api/auth/login') {
      authenticated = true;
      data = { user: USER, csrfToken: 'csrf' };
    } else if (path === '/api/auth/logout') {
      data = { loggedOut: true };
    } else if (path === '/api/auth/sessions') {
      data = { sessions: [] };
    } else if (path.startsWith('/api/social/conversations/') && path.endsWith('/messages')) {
      data = { messages: [] };
    } else if (path === '/api/realtime/session') {
      const realtimeRequest = request.postDataJSON() as {
        action: string;
        tracks?: { mid: string; source: string }[];
      };
      const { action } = realtimeRequest;
      if (action === 'create') {
        realtimeStats.create += 1;
        data = { sessionId: `session_${realtimeStats.create}`, iceServers: [] };
      } else if (action === 'publish') {
        realtimeStats.publish += 1;
        data = {
          sessionDescription: { type: 'answer', sdp: 'v=0' },
          publications: (realtimeRequest.tracks ?? []).map((track, index) => ({
            publicationId:
              track.source === 'microphone'
                ? '33333333-3333-4333-8333-333333333333'
                : track.source === 'camera'
                  ? '44444444-4444-4444-8444-444444444444'
                  : index === 0
                    ? '55555555-5555-4555-8555-555555555555'
                    : '77777777-7777-4777-8777-777777777777',
            userId: USER.id,
            kind:
              track.source === 'microphone' || track.source === 'screen-audio' ? 'audio' : 'video',
            source: track.source,
            createdAt: Date.now(),
          })),
        };
      } else data = { closed: true, requiresImmediateRenegotiation: false };
    } else {
      data = {};
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, data, requestId: 'e2e-request' }),
    });
  });
  return realtimeStats;
}

test('convite, recovery, sala, controles de voz, logout e login', async ({ page }) => {
  test.setTimeout(60_000);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') pageErrors.push(message.text());
  });
  await installBrowserFakes(page);
  const realtimeStats = await mockApi(page);
  await page.goto(`/invite#${'A'.repeat(43)}`);
  await expect(page).toHaveURL(/\/invite$/u);
  await page.getByLabel('Como quer ser chamado').fill('Alice');
  await page.getByLabel('Usuário').fill('alice');
  await page.getByLabel('Senha', { exact: true }).fill('uma-senha-segura-e-longa');
  await expect(page.getByText('Senhas iguais')).toHaveCount(0);
  await page.getByLabel('Repita a senha').fill('uma-senha-segura-e-longa');
  await expect(
    page.getByLabel('Repita a senha').locator('..').getByText('Senhas iguais'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Criar conta' }).click();
  await expect(
    page.getByRole('heading', { name: 'Salve seus códigos de recuperação' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Copiar códigos' }).click();
  await expect(page.getByText('Códigos copiados')).toBeVisible();
  await page.getByRole('button', { name: 'Já guardei em segurança' }).click();

  await expect(page.getByRole('heading', { name: 'Amigos', level: 1 })).toBeVisible();
  const memberSidebar = page.getByRole('complementary', { name: 'Membros' });
  await expect(memberSidebar).not.toBeVisible();
  const carolFriendRow = page.locator('.social-row').filter({ hasText: '@carol' });
  await expect(carolFriendRow.getByText('Offline', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Carol', exact: true }).locator('.avatar-offline'),
  ).toBeVisible();
  const directMessageButton = page.getByRole('button', { name: 'Carol', exact: true });
  await expect(directMessageButton).toHaveClass(/home-navigation-item/u);
  await expect(directMessageButton.locator('span[title="@carol"]')).toBeVisible();
  await directMessageButton.click();
  await expect(directMessageButton).toHaveClass(/is-active/u);
  await expect(directMessageButton).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await page.getByRole('button', { name: 'Amigos', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Amigos', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'K0Sec' }).click();
  await expect(page.getByRole('heading', { name: 'K0Sec', level: 1 })).toBeVisible();
  await expect(page.getByText('Alice (você)').first()).toBeVisible();
  const appMain = page.locator('.app-main');
  const initialContentWidth = (await appMain.boundingBox())?.width ?? 0;
  await expect(page.getByRole('button', { name: 'Ocultar membros' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ocultar membros' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Ocultar membros' }).first().click();
  await expect(memberSidebar).not.toBeVisible();
  expect((await appMain.boundingBox())?.width ?? 0).toBeGreaterThan(initialContentWidth + 200);
  await page.getByRole('button', { name: 'Exibir membros' }).click();
  await expect(memberSidebar).toBeVisible();

  await page.setViewportSize({ width: 1024, height: 768 });
  await page.getByRole('button', { name: 'Ocultar membros' }).click();
  await expect(memberSidebar).not.toBeVisible();
  await page.getByRole('button', { name: 'Exibir membros' }).click();
  await expect(memberSidebar).toBeVisible();
  await page.getByRole('button', { name: 'Ocultar membros' }).click();

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileVoiceBar = page.locator('.mobile-voice-bar');
  await expect(mobileVoiceBar).toBeVisible();
  await expect(
    mobileVoiceBar.getByRole('button', { name: 'Ativar microfone' }),
  ).toBeDisabled();
  await expect(mobileVoiceBar.getByRole('button', { name: 'Ativar câmera' })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight)).toBe(
    true,
  );
  await page.getByRole('button', { name: 'Exibir membros' }).click();
  await expect(memberSidebar).toBeVisible();
  await page.getByRole('button', { name: 'Ocultar membros' }).click();
  await expect(memberSidebar).not.toBeVisible();

  const mobileGroupRail = page.getByRole('complementary', { name: 'Grupos' });
  await expect(mobileGroupRail).toBeVisible();
  await mobileGroupRail.getByRole('button', { name: 'Cyber Study' }).click();
  await expect(page.getByRole('heading', { name: 'Cyber Study', level: 1 })).toBeVisible();
  await mobileGroupRail.getByRole('button', { name: 'K0Sec' }).click();
  await expect(page.getByRole('heading', { name: 'K0Sec', level: 1 })).toBeVisible();

  for (const width of [1366, 1440, 1920, 2560]) {
    await page.setViewportSize({ width, height: 900 });
    const expandedContentWidth = (await appMain.boundingBox())?.width ?? 0;
    await page.getByRole('button', { name: 'Exibir membros' }).click();
    await expect(memberSidebar).toBeVisible();
    expect((await appMain.boundingBox())?.width ?? 0).toBeLessThan(expandedContentWidth - 200);
    await page.getByRole('button', { name: 'Ocultar membros' }).first().click();
    await expect(memberSidebar).not.toBeVisible();
  }

  await page.setViewportSize({ width: 1280, height: 720 });
  await expect.poll(() => pageErrors).toEqual([]);
  await page.getByRole('button', { name: 'Geral' }).click();
  const callStage = page.getByRole('region', { name: 'K0Sec: Geral' });
  await expect(page.getByRole('heading', { name: 'Geral', level: 1 })).toBeVisible();
  await expect(callStage.getByRole('button', { name: 'Desativar microfone' })).toBeVisible();
  await callStage.getByRole('button', { name: 'Ativar câmera' }).click();
  await expect(callStage.getByRole('button', { name: 'Desativar câmera' })).toBeVisible();
  await expect(callStage.getByLabel('Câmera de Alice (você)')).toBeVisible();
  await callStage.getByRole('button', { name: 'Compartilhar tela' }).click();
  await expect(callStage.getByRole('button', { name: 'Parar compartilhamento' })).toBeVisible();
  const screenShareTile = callStage.locator('.screen-share-available').filter({
    hasText: 'Tela de Alice (você)',
  });
  await expect(screenShareTile).toBeVisible();
  const mediaDock = page.getByRole('region', { name: 'Transmissões de K0Sec' });
  await expect(mediaDock).toHaveCount(0);
  await page.getByRole('button', { name: 'chat', exact: true }).click();
  await page.getByRole('button', { name: 'k0nnect' }).click();
  await expect(page.getByRole('heading', { name: 'Amigos', level: 1 })).toBeVisible();
  await expect(mediaDock).toHaveCount(0);
  await page.getByRole('button', { name: 'K0Sec', exact: true }).click();
  await page.getByRole('button', { name: 'Geral' }).click();
  await expect(callStage.getByLabel('Câmera de Alice (você)')).toBeVisible();
  await expect(screenShareTile).toBeVisible();
  await screenShareTile.getByRole('button', { name: 'Assistir' }).click();
  await expect(callStage.getByLabel('Câmera de Alice (você)')).toBeVisible();
  await expect(callStage.getByLabel('Tela de Alice (você)')).toBeVisible();
  await expect(callStage.getByLabel('Tela de Alice (você)')).toHaveCSS('object-fit', 'contain');
  expect(realtimeStats.create).toBe(1);
  expect(realtimeStats.publish).toBe(3);
  const navigationMetricsBefore = await page.evaluate(() => {
    const metrics = (
      window as typeof window & {
        __k0nnectDevelopmentMetrics: {
          snapshot(): { httpRequests: number; wsMessagesSent: number; d1Reads: number };
        };
      }
    ).__k0nnectDevelopmentMetrics.snapshot();
    return {
      httpRequests: metrics.httpRequests,
      wsMessagesSent: metrics.wsMessagesSent,
      d1Reads: metrics.d1Reads,
    };
  });

  await page.getByRole('button', { name: 'Exibir membros' }).click();
  await expect(memberSidebar).toBeVisible();
  await page.getByRole('button', { name: 'Ocultar membros' }).first().click();
  await expect(memberSidebar).not.toBeVisible();
  await page.getByRole('button', { name: 'chat', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'K0Sec', level: 1 })).toBeVisible();
  const composer = page.getByLabel('Mensagem para K0Sec');
  expect(
    (await composer.locator('xpath=..').boundingBox())?.height ?? Number.POSITIVE_INFINITY,
  ).toBeLessThan(80);
  const compactComposerHeight = (await composer.boundingBox())?.height ?? 0;
  await composer.fill(Array.from({ length: 30 }, (_, index) => `linha ${index}`).join('\n'));
  const expandedComposerHeight = (await composer.boundingBox())?.height ?? 0;
  expect(expandedComposerHeight).toBeGreaterThan(compactComposerHeight);
  expect(expandedComposerHeight).toBeLessThanOrEqual(360);
  await composer.fill('');
  await page.getByRole('button', { name: 'k0nnect' }).click();
  await expect(page.getByRole('heading', { name: 'Amigos', level: 1 })).toBeVisible();
  await expect(mediaDock).toBeVisible();
  await expect(mediaDock.getByRole('button', { name: 'Voltar' })).toBeVisible();
  await expect(mediaDock.getByRole('button', { name: 'Ocultar transmissões' })).toBeVisible();
  await expect(mediaDock.getByText('Transmissão em segundo plano')).toHaveCount(0);
  await expect(mediaDock.getByLabel('Câmera de Alice (você)')).toHaveCount(0);
  await expect(mediaDock.getByLabel('Tela de Alice (você)')).toBeVisible();
  await expect(mediaDock.getByRole('button', { name: 'Focar transmissão' })).toHaveCount(0);
  await expect(mediaDock.getByRole('button', { name: 'Exibir em grade' })).toHaveCount(0);
  await expect(mediaDock.getByRole('button', { name: 'Ampliar transmissões' })).toHaveCount(0);
  const dockBeforeDrag = await mediaDock.boundingBox();
  const dockHeader = await mediaDock.locator('.floating-media-header').boundingBox();
  if (!dockBeforeDrag || !dockHeader) throw new Error('Dock de mídia não mensurável.');
  await page.mouse.move(dockHeader.x + 80, dockHeader.y + dockHeader.height / 2);
  await page.mouse.down();
  await page.mouse.move(dockHeader.x - 80, dockHeader.y - 60);
  await page.mouse.up();
  const dockAfterDrag = await mediaDock.boundingBox();
  expect(dockAfterDrag?.x).toBeLessThan(dockBeforeDrag.x - 50);
  await mediaDock.getByRole('button', { name: 'Voltar' }).click();
  await expect(page.getByRole('heading', { name: 'Geral', level: 1 })).toBeVisible();
  await expect(mediaDock).toHaveCount(0);
  await expect(callStage.getByLabel('Tela de Alice (você)')).toBeVisible();
  expect(realtimeStats.create).toBe(1);
  await page.getByRole('button', { name: 'Geral' }).click();
  await expect(callStage).toBeVisible();
  expect(realtimeStats.create).toBe(1);
  expect(
    await page.evaluate(() => {
      const metrics = (
        window as typeof window & {
          __k0nnectDevelopmentMetrics: {
            snapshot(): { httpRequests: number; wsMessagesSent: number; d1Reads: number };
          };
        }
      ).__k0nnectDevelopmentMetrics.snapshot();
      return {
        httpRequests: metrics.httpRequests,
        wsMessagesSent: metrics.wsMessagesSent,
        d1Reads: metrics.d1Reads,
      };
    }),
  ).toEqual(navigationMetricsBefore);
  await page.evaluate(() =>
    (
      window as typeof window & {
        __k0nnectDropSocket(): void;
      }
    ).__k0nnectDropSocket(),
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as typeof window & {
              __k0nnectSocketStats: { created: number };
            }
          ).__k0nnectSocketStats.created,
      ),
    )
    .toBe(2);
  expect(realtimeStats.create).toBe(1);
  expect(realtimeStats.publish).toBe(3);

  await page.evaluate(() =>
    (
      window as typeof window & {
        __k0nnectFailPeer(): void;
      }
    ).__k0nnectFailPeer(),
  );
  await expect.poll(() => realtimeStats.create).toBe(2);
  await expect.poll(() => realtimeStats.publish).toBe(6);
  await expect(callStage.getByRole('button', { name: 'Desativar microfone' })).toBeVisible();
  await expect(callStage.getByRole('button', { name: 'Desativar câmera' })).toBeVisible();
  await expect(callStage.getByRole('button', { name: 'Parar compartilhamento' })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  const cameraSwitchButton = page.getByRole('button', { name: 'Trocar câmera' });
  await expect(cameraSwitchButton).toBeVisible();
  const cameraSwitchBox = await cameraSwitchButton.boundingBox();
  expect(cameraSwitchBox).not.toBeNull();
  expect(Math.abs((cameraSwitchBox?.width ?? 0) - (cameraSwitchBox?.height ?? 0))).toBeLessThan(1);
  expect(cameraSwitchBox?.width).toBeGreaterThanOrEqual(44);
  await page.setViewportSize({ width: 1280, height: 720 });
  const socketStatsBeforeNavigation = await page.evaluate(
    () =>
      (
        window as typeof window & {
          __k0nnectSocketStats: { closed: number; created: number };
        }
      ).__k0nnectSocketStats,
  );

  await page.getByRole('link', { name: 'Abrir configurações' }).click();
  await expect(page).toHaveURL(/\/settings$/u);
  await expect(page.getByLabel('Chamada ativa')).toContainText('Geral');
  await page.getByRole('link', { name: 'Segurança e sessões' }).click();
  await expect(page.getByLabel('Chamada ativa')).toBeVisible();
  await page.getByRole('link', { name: 'Voz e vídeo' }).click();
  const microphoneSelect = page.getByRole('combobox', { name: 'Microfone' });
  await microphoneSelect.click();
  await page.getByRole('option', { name: 'Microfone reserva' }).click();
  await expect(microphoneSelect).toHaveAttribute('title', 'Microfone reserva');
  const cameraSelect = page.getByRole('combobox', { name: 'Câmera' });
  await cameraSelect.click();
  await page.getByRole('option', { name: 'Câmera traseira' }).click();
  await expect(cameraSelect).toHaveAttribute('title', 'Câmera traseira');
  expect(realtimeStats.create).toBe(2);
  expect(realtimeStats.publish).toBe(6);
  await page.getByRole('link', { name: 'Voltar' }).click();
  await expect(page).toHaveURL(/\/app$/u);
  await expect(page.getByLabel('Chamada ativa')).toHaveCount(0);
  await page.getByRole('button', { name: 'K0Sec', exact: true }).click();
  await page.getByRole('button', { name: 'Geral' }).click();
  await screenShareTile.getByRole('button', { name: 'Assistir' }).click();
  await expect(callStage.getByRole('button', { name: 'Desativar câmera' })).toBeVisible();
  await expect(callStage.getByRole('button', { name: 'Parar compartilhamento' })).toBeVisible();
  await expect(page.getByLabel('Tela de Alice (você)')).not.toHaveClass(/is-mirrored/u);
  expect(realtimeStats.create).toBe(2);
  expect(realtimeStats.publish).toBe(6);
  expect(
    await page.evaluate(
      () =>
        (
          window as typeof window & {
            __k0nnectSocketStats: { closed: number; created: number };
          }
        ).__k0nnectSocketStats,
    ),
  ).toEqual(socketStatsBeforeNavigation);

  const fullscreenButton = page.getByRole('button', { name: 'Tela cheia' }).first();
  await fullscreenButton.click();
  await expect(page.getByRole('button', { name: 'Sair da tela cheia' })).toBeVisible();
  await page.getByRole('button', { name: 'Sair da tela cheia' }).click();
  await expect(page.getByRole('button', { name: 'Tela cheia' }).first()).toBeVisible();
  await fullscreenButton.click();
  await page.evaluate(() => void document.exitFullscreen());
  await expect(page.getByRole('button', { name: 'Tela cheia' }).first()).toBeVisible();
  await page.waitForTimeout(100);
  expect(pageErrors).toEqual([]);
  await callStage.getByRole('button', { name: 'Parar de assistir' }).click();
  await expect(callStage.getByLabel('Tela de Alice (você)')).toHaveCount(0);
  await callStage.getByRole('button', { name: 'Parar compartilhamento' }).click();
  await callStage.getByRole('button', { name: 'Desativar câmera' }).click();
  await callStage.getByRole('button', { name: 'Desativar microfone' }).click();
  await expect(callStage.getByRole('button', { name: 'Ativar microfone' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await callStage.getByRole('button', { name: 'Desativar áudio' }).click();
  await expect(
    callStage.getByRole('button', { name: 'Ativar áudio', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page
    .getByRole('complementary', { name: 'Canais' })
    .getByRole('button', {
      name: 'Ativar microfone ao reativar áudio',
    })
    .click();
  await callStage.getByRole('button', { name: 'Ativar áudio', exact: true }).click();
  await expect(callStage.getByRole('button', { name: 'Desativar microfone' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await callStage.getByRole('button', { name: 'Sair da chamada' }).click();
  await expect(page.getByRole('heading', { name: 'K0Sec', level: 1 })).toBeVisible();

  await page.getByRole('button', { name: 'Cyber Study' }).click();
  await expect(page.getByRole('heading', { name: 'Cyber Study', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Configurar grupo' }).click();
  const groupDialog = page.getByRole('dialog', { name: 'Configurar Cyber Study' });
  await expect(groupDialog).toBeVisible();
  expect(await groupDialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
    true,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await groupDialog.evaluate(
      (element) =>
        element.scrollWidth <= element.clientWidth &&
        element.getBoundingClientRect().width <= window.innerWidth - 8,
    ),
  ).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await groupDialog.locator('header').getByRole('button', { name: 'Fechar' }).click();
  await page.setViewportSize({ width: 1280, height: 720 });
  const groupCallStage = page.getByRole('region', { name: 'Cyber Study: Chamada do grupo' });
  await expect(groupCallStage).toBeVisible();
  const ignoreCallButton = page.getByRole('button', { name: 'Ignorar chamada' });
  await expect(ignoreCallButton).toBeVisible();
  const ignoreCallBounds = await ignoreCallButton.boundingBox();
  expect(ignoreCallBounds).not.toBeNull();
  expect(Math.abs((ignoreCallBounds?.width ?? 0) - (ignoreCallBounds?.height ?? 0))).toBeLessThan(
    1,
  );
  await expect(groupCallStage.getByText('Bob')).toBeVisible();
  await expect(groupCallStage.getByLabel('Falando')).toBeVisible();
  expect(
    (await groupCallStage.locator('.call-participant-tile').first().boundingBox())?.width ??
      Number.POSITIVE_INFINITY,
  ).toBeLessThanOrEqual(192);
  const compactStageBounds = await page.locator('.ephemeral-call-stage').boundingBox();
  const compactTileBounds = await groupCallStage
    .locator('.call-participant-tile')
    .first()
    .boundingBox();
  if (!compactStageBounds || !compactTileBounds) {
    throw new Error('Stage compacto não mensurável.');
  }
  expect(compactStageBounds.height).toBeLessThan(240);
  expect(compactTileBounds.y + compactTileBounds.height).toBeLessThanOrEqual(
    compactStageBounds.y + compactStageBounds.height,
  );
  const channelSidebar = page.getByRole('complementary', { name: 'Canais' });
  await expect(channelSidebar.getByText('Voz', { exact: true })).toHaveCount(0);
  await expect(channelSidebar.getByRole('button', { name: 'Geral' })).toHaveCount(0);
  await groupCallStage.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Cyber Study', level: 1 })).toBeVisible();
  await expect(groupCallStage.getByRole('button', { name: 'Conectado' })).toBeDisabled();
  await channelSidebar.getByRole('button', { name: 'Ativar câmera' }).click();
  await channelSidebar.getByRole('button', { name: 'Compartilhar tela' }).click();
  const compactCameraTile = groupCallStage.locator(
    '.call-participant-tile.has-inline-media:not(.is-screen-share)',
  );
  const compactScreenTile = groupCallStage.locator('.screen-share-available');
  await expect(compactCameraTile).toBeVisible();
  await expect(compactScreenTile).toBeVisible();
  const compactCameraBounds = await compactCameraTile.boundingBox();
  const compactScreenBounds = await compactScreenTile.boundingBox();
  if (!compactCameraBounds || !compactScreenBounds) {
    throw new Error('Tiles de mídia compactos não mensuráveis.');
  }
  expect(Math.abs(compactCameraBounds.width - compactScreenBounds.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(compactCameraBounds.height - compactScreenBounds.height)).toBeLessThanOrEqual(1);
  expect(compactCameraBounds.width).toBeLessThanOrEqual(256);
  await channelSidebar.getByRole('button', { name: 'Parar compartilhamento' }).click();
  await channelSidebar.getByRole('button', { name: 'Desativar câmera' }).click();
  await channelSidebar.getByRole('button', { name: 'Desconectar' }).click();

  await page.getByRole('button', { name: 'k0nnect' }).click();
  await page.getByRole('button', { name: 'Carol', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Carol', level: 1 })).toBeVisible();
  const dmCallStage = page.getByRole('region', { name: 'Carol: Chamada com Carol' });
  await expect(dmCallStage).toBeVisible();
  await expect(dmCallStage.getByText('Carol', { exact: true })).toBeVisible();
  await dmCallStage.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Carol', level: 1 })).toBeVisible();
  await expect(dmCallStage.getByRole('button', { name: 'Conectado' })).toBeDisabled();
  await channelSidebar.getByRole('button', { name: 'Desconectar' }).click();
  expect(pageErrors).toEqual([]);

  await page.getByRole('button', { name: 'Sair da conta' }).click();
  await expect(page.getByRole('heading', { name: 'Bem-vindo de volta' })).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { __k0nnectSocketStats: { closed: number } })
          .__k0nnectSocketStats.closed,
    ),
  ).toBeGreaterThan(socketStatsBeforeNavigation.closed);
  await page.getByLabel('Usuário').fill('alice');
  await page.getByLabel('Senha').fill('uma-senha-segura-e-longa');
  await page.getByRole('button', { name: 'Entrar no k0nnect' }).click();
  await expect(page.getByRole('heading', { name: 'Amigos', level: 1 })).toBeVisible();
});
