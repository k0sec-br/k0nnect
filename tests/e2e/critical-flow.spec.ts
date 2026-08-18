import { expect, test, type Page } from '@playwright/test';

const USER = {
  id: '11111111-1111-4111-8111-111111111111',
  username: 'alice',
  displayName: 'Alice',
  role: 'member',
};
const RECOVERY_CODES = Array.from(
  { length: 10 },
  (_, index) => `AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-${String(index).padStart(4, '2A')}`,
);

async function installBrowserFakes(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const testWindow = window as typeof window & {
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
      connectionState = 'new';
      private transceivers: {
        mid: string;
        sender: { track: unknown; replaceTrack(track: unknown): Promise<void> };
      }[] = [];
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
    }
    Object.defineProperty(window, 'RTCPeerConnection', {
      configurable: true,
      value: FakePeerConnection,
    });

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
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSED = 3;
      readyState = FakeWebSocket.CONNECTING;
      constructor(_url: string) {
        super();
        testWindow.__k0nnectSocketStats.created += 1;
        window.setTimeout(() => {
          this.readyState = FakeWebSocket.OPEN;
          this.dispatchEvent(
            new MessageEvent('message', {
              data: JSON.stringify({
                v: 2,
                type: 'room.ready',
                payload: {
                  connectionId: '22222222-2222-4222-8222-222222222222',
                  participants: [
                    {
                      userId: '11111111-1111-4111-8111-111111111111',
                      displayName: 'Alice',
                      muted: false,
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
      send() {}
      close(code = 1000, reason = '') {
        testWindow.__k0nnectSocketStats.closed += 1;
        this.readyState = FakeWebSocket.CLOSED;
        this.dispatchEvent(new CloseEvent('close', { code, reason }));
      }
    }
    Object.defineProperty(window, 'WebSocket', { configurable: true, value: FakeWebSocket });
  });
}

async function mockApi(page: Page): Promise<{ create: number; publish: number }> {
  const realtimeStats = { create: 0, publish: 0 };
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    let data: unknown;
    if (path === '/api/config') {
      data = { realtimeEnabled: true, turnstileEnabled: false, registrationMode: 'invite' };
    } else if (path === '/api/auth/session') {
      data = { authenticated: false };
    } else if (path === '/api/auth/register-invite') {
      data = { user: USER, csrfToken: 'csrf', recoveryCodes: RECOVERY_CODES };
    } else if (path === '/api/auth/login') {
      data = { user: USER, csrfToken: 'csrf' };
    } else if (path === '/api/auth/logout') {
      data = { loggedOut: true };
    } else if (path === '/api/auth/sessions') {
      data = { sessions: [] };
    } else if (path === '/api/rooms') {
      data = {
        rooms: [{ id: 'room_general', slug: 'geral', name: 'Geral', kind: 'voice', position: 0 }],
      };
    } else if (path === '/api/realtime/session') {
      const realtimeRequest = request.postDataJSON() as {
        action: string;
        mid?: string;
        source?: string;
      };
      const { action } = realtimeRequest;
      if (action === 'turn') data = { iceServers: [] };
      else if (action === 'create') {
        realtimeStats.create += 1;
        data = { sessionId: 'session_1' };
      } else if (action === 'publish') {
        realtimeStats.publish += 1;
        expect(realtimeRequest.mid).toBeTruthy();
        const kind =
          realtimeRequest.source === 'camera' || realtimeRequest.source === 'screen-video'
            ? 'video'
            : 'audio';
        data = {
          sessionDescription: { type: 'answer', sdp: 'v=0' },
          publication: {
            publicationId:
              realtimeRequest.source === 'microphone'
                ? '33333333-3333-4333-8333-333333333333'
                : realtimeRequest.source === 'camera'
                  ? '44444444-4444-4444-8444-444444444444'
                  : '55555555-5555-4555-8555-555555555555',
            userId: USER.id,
            kind,
            source: realtimeRequest.source,
            createdAt: Date.now(),
          },
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

  await expect(page.getByRole('heading', { name: 'Geral' })).toBeVisible();
  await expect(page.getByRole('main').getByText('Alice (você)')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mostrar participantes' })).toHaveCount(0);
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(page.getByRole('button', { name: 'Mostrar participantes' })).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(page.getByRole('button', { name: 'Mostrar participantes' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Entrar na voz' }).click();
  await expect(page.getByRole('button', { name: 'Desativar microfone' })).toBeVisible();
  await page.getByRole('button', { name: 'Ativar câmera' }).click();
  await expect(page.getByRole('button', { name: 'Desativar câmera' })).toBeVisible();
  await page.getByRole('button', { name: 'Compartilhar tela' }).click();
  await expect(page.getByRole('button', { name: 'Parar compartilhamento' })).toBeVisible();
  expect(realtimeStats.create).toBe(1);
  expect(realtimeStats.publish).toBe(3);
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
  expect(realtimeStats.create).toBe(1);
  expect(realtimeStats.publish).toBe(3);
  await page.getByRole('link', { name: 'Voltar' }).click();
  await expect(page).toHaveURL(/\/app$/u);
  await expect(page.getByRole('button', { name: 'Desativar câmera' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Parar compartilhamento' })).toBeVisible();
  await expect(page.getByLabel('Vídeo de Alice (você)')).not.toHaveClass(/is-mirrored/u);
  expect(realtimeStats.create).toBe(1);
  expect(realtimeStats.publish).toBe(3);
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
  await page.getByRole('button', { name: 'Parar compartilhamento' }).click();
  await page.getByRole('button', { name: 'Desativar câmera' }).click();
  await page.getByRole('button', { name: 'Desativar microfone' }).click();
  await expect(page.getByRole('button', { name: 'Ativar microfone' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Desativar áudio' }).click();
  await expect(page.getByRole('button', { name: 'Ativar áudio', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Ativar microfone ao reativar áudio' }).click();
  await page.getByRole('button', { name: 'Ativar áudio', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Desativar microfone' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await page.getByRole('button', { name: 'Desconectar' }).click();
  await expect(page.getByRole('button', { name: 'Entrar na voz' })).toBeVisible();
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
  await expect(page.getByRole('heading', { name: 'Geral' })).toBeVisible();
});
