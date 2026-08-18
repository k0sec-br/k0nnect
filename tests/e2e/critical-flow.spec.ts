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
    class FakeMediaStream {
      constructor(readonly tracks: unknown[] = []) {}
      getAudioTracks() {
        return this.tracks;
      }
    }

    const localTrack = {
      id: 'local-audio',
      enabled: true,
      stop() {},
      addEventListener() {},
    };
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        addEventListener() {},
        removeEventListener() {},
        async enumerateDevices() {
          return [{ deviceId: 'default-mic', kind: 'audioinput', label: 'Microfone de teste' }];
        },
        async getUserMedia() {
          return new FakeMediaStream([localTrack]);
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
      private sender = { track: localTrack, async replaceTrack() {} };
      addTrack() {
        return this.sender;
      }
      getSenders() {
        return [this.sender];
      }
      getReceivers() {
        return [];
      }
      getTransceivers() {
        return [{ mid: '0', sender: this.sender }];
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

    class FakeWebSocket extends EventTarget {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSED = 3;
      readyState = FakeWebSocket.CONNECTING;
      constructor(_url: string) {
        super();
        window.setTimeout(() => {
          this.readyState = FakeWebSocket.OPEN;
          this.dispatchEvent(
            new MessageEvent('message', {
              data: JSON.stringify({
                v: 1,
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
                      realtimeSessionId: null,
                      audioTrackName: null,
                    },
                  ],
                },
              }),
            }),
          );
        }, 10);
      }
      send() {}
      close(code = 1000, reason = '') {
        this.readyState = FakeWebSocket.CLOSED;
        this.dispatchEvent(new CloseEvent('close', { code, reason }));
      }
    }
    Object.defineProperty(window, 'WebSocket', { configurable: true, value: FakeWebSocket });
  });
}

async function mockApi(page: Page): Promise<void> {
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
    } else if (path === '/api/rooms') {
      data = {
        rooms: [{ id: 'room_general', slug: 'geral', name: 'Geral', kind: 'voice', position: 0 }],
      };
    } else if (path === '/api/realtime/session') {
      const realtimeRequest = request.postDataJSON() as { action: string; mid?: string };
      const { action } = realtimeRequest;
      if (action === 'turn') data = { iceServers: [] };
      else if (action === 'create') data = { sessionId: 'session_1' };
      else if (action === 'publish') {
        expect(realtimeRequest.mid).toBe('0');
        data = {
          sessionDescription: { type: 'answer', sdp: 'v=0' },
          tracks: [{ trackName: 'audio_track_1' }],
        };
      } else data = { closed: true };
    } else {
      data = {};
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, data, requestId: 'e2e-request' }),
    });
  });
}

test('convite, recovery, sala, controles de voz, logout e login', async ({ page }) => {
  await installBrowserFakes(page);
  await mockApi(page);
  await page.goto(`/invite#${'A'.repeat(43)}`);
  await expect(page).toHaveURL(/\/invite$/u);
  await page.getByLabel('Como quer ser chamado').fill('Alice');
  await page.getByLabel('Usuário').fill('alice');
  await page.getByLabel('Senha', { exact: true }).fill('uma-senha-segura-e-longa');
  await page.getByLabel('Repita a senha').fill('uma-senha-segura-e-longa');
  await page.getByRole('button', { name: 'Criar conta privada' }).click();
  await expect(
    page.getByRole('heading', { name: 'Salve seus códigos de recuperação' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Copiar códigos' }).click();
  await expect(page.getByText('Códigos copiados')).toBeVisible();
  await page.getByRole('button', { name: 'Já guardei em segurança' }).click();

  await expect(page.getByRole('heading', { name: 'Geral' })).toBeVisible();
  await expect(page.getByText('Alice (você)')).toBeVisible();
  await page.getByRole('button', { name: 'Entrar na voz' }).click();
  await expect(page.getByRole('button', { name: 'Silenciar' })).toBeVisible();
  await page.getByRole('button', { name: 'Silenciar' }).click();
  await expect(page.getByRole('button', { name: 'Ativar microfone' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Desativar áudio' }).click();
  await expect(page.getByRole('button', { name: 'Ativar áudio' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Desconectar' }).click();
  await expect(page.getByRole('button', { name: 'Entrar na voz' })).toBeVisible();
  await page.getByRole('button', { name: 'Sair da conta' }).click();
  await expect(page.getByRole('heading', { name: 'Bem-vindo de volta' })).toBeVisible();
  await page.getByLabel('Usuário').fill('alice');
  await page.getByLabel('Senha').fill('uma-senha-segura-e-longa');
  await page.getByRole('button', { name: 'Entrar no k0nnect' }).click();
  await expect(page.getByRole('heading', { name: 'Geral' })).toBeVisible();
});
