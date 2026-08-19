import { expect, test, type Page } from '@playwright/test';

const OWNER = {
  id: '11111111-1111-4111-8111-111111111111',
  username: 'paznic',
  displayName: 'jdoe47',
  role: 'owner',
};

const MEMBER = {
  ...OWNER,
  id: '22222222-2222-4222-8222-222222222222',
  role: 'member',
};

function isoFromNow(offsetMilliseconds: number): string {
  return new Date(Date.now() + offsetMilliseconds).toISOString();
}

async function installSettingsBrowserFakes(page: Page): Promise<void> {
  await page.addInitScript(() => {
    class FakeMediaStream {
      getTracks() {
        return [];
      }
    }

    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        addEventListener() {},
        removeEventListener() {},
        async enumerateDevices() {
          return [
            {
              deviceId: 'microphone-1',
              kind: 'audioinput',
              label: 'Default - Razer Seiren Mini (Razer Seiren Mini) (1532:0531)',
            },
            {
              deviceId: 'microphone-2',
              kind: 'audioinput',
              label: 'Communications - Razer Seiren Mini (Razer Seiren Mini)',
            },
            { deviceId: 'camera-1', kind: 'videoinput', label: 'Câmera principal' },
          ];
        },
        async getUserMedia() {
          return new FakeMediaStream();
        },
      },
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { async writeText() {} },
    });
    class FakeWebSocket extends EventTarget {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSED = 3;
      readyState = FakeWebSocket.CONNECTING;
      constructor() {
        super();
        window.setTimeout(() => {
          this.readyState = FakeWebSocket.OPEN;
          this.dispatchEvent(
            new MessageEvent('message', {
              data: JSON.stringify({
                v: 4,
                type: 'server.ready',
                payload: {
                  connectionId: '22222222-2222-4222-8222-222222222222',
                  connectionEpoch: 1,
                  resumed: false,
                  onlineUserIds: ['11111111-1111-4111-8111-111111111111'],
                  participants: [],
                  publications: [],
                },
              }),
            }),
          );
        }, 0);
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

async function mockSettingsApi(page: Page, user = OWNER): Promise<void> {
  const invites = [
    {
      id: 'invite-active',
      role: 'member',
      createdAt: isoFromNow(-12 * 60_000),
      expiresAt: isoFromNow(2 * 86_400_000),
      status: 'available',
    },
    {
      id: 'invite-used',
      role: 'member',
      createdAt: isoFromNow(-2 * 3_600_000),
      expiresAt: isoFromNow(70 * 3_600_000),
      status: 'used',
    },
    {
      id: 'invite-revoked',
      role: 'admin',
      createdAt: isoFromNow(-3 * 3_600_000),
      expiresAt: isoFromNow(69 * 3_600_000),
      status: 'revoked',
    },
    {
      id: 'invite-expired',
      role: 'member',
      createdAt: isoFromNow(-5 * 86_400_000),
      expiresAt: isoFromNow(-2 * 86_400_000),
      status: 'expired',
    },
  ];

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    let data: unknown = {};

    if (path === '/api/bootstrap') {
      data = {
        authenticated: true,
        user,
        csrfToken: 'settings-csrf',
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
        members: [{ id: user.id, displayName: user.displayName, role: user.role }],
        capabilities: { manageInvites: user.role !== 'member' },
      };
    } else if (path === '/api/admin/invites' && method === 'GET') {
      data = { invites };
    } else if (path === '/api/admin/invites' && method === 'POST') {
      const role = (request.postDataJSON() as { role: 'admin' | 'member' }).role;
      data = {
        invite: {
          id: 'invite-created',
          role,
          createdAt: isoFromNow(0),
          expiresAt: isoFromNow(72 * 3_600_000),
          status: 'available',
        },
        url: `https://connect.k0sec.org/invite#${'A'.repeat(43)}`,
      };
    } else if (path.startsWith('/api/admin/invites/') && method === 'DELETE') {
      data = { revoked: true };
    } else if (path === '/api/auth/sessions') {
      data = {
        sessions: [
          {
            id: 'session-current',
            createdAt: isoFromNow(-86_400_000),
            lastSeenAt: isoFromNow(-60_000),
            expiresAt: isoFromNow(6 * 86_400_000),
            current: true,
          },
        ],
      };
    } else if (path === '/api/auth/logout' || path === '/api/auth/logout-all') {
      data = { loggedOut: true };
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, data, requestId: 'settings-e2e' }),
    });
  });
}

async function openSettings(page: Page, path = '/settings', user = OWNER): Promise<void> {
  await installSettingsBrowserFakes(page);
  await mockSettingsApi(page, user);
  await page.goto(path);
  await expect(page.getByRole('heading', { name: 'Configurações', level: 1 })).toBeVisible();
}

test('preserva navegação, convites, segurança, fechamento e logout', async ({ page }) => {
  await openSettings(page);

  await expect(page.getByText('@paznic').first()).toBeVisible();
  await expect(page.getByText('Owner', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Voz e vídeo' }).click();
  await expect(page).toHaveURL(/\/settings\/media$/u);
  await expect(page.getByRole('heading', { name: 'Voz e vídeo' })).toBeVisible();

  await page.getByRole('link', { name: 'Segurança e sessões' }).click();
  await expect(page.getByRole('heading', { name: 'Sessões ativas' })).toBeVisible();
  await expect(page.getByText('Esta sessão')).toBeVisible();

  await page.getByRole('link', { name: 'Convites' }).click();
  await expect(page).toHaveURL(/\/settings\/invites$/u);
  await expect(page.getByLabel('Status: Ativo').first()).toBeVisible();
  await expect(page.getByLabel('Status: Usado')).toBeVisible();
  await expect(page.getByLabel('Status: Revogado')).toBeVisible();
  await expect(page.getByLabel('Status: Expirado')).toBeVisible();

  await page.getByRole('button', { name: 'Gerar convite' }).click();
  await expect(page.getByRole('heading', { name: 'Convite criado' })).toBeVisible();
  await page.getByRole('button', { name: 'Copiar link' }).click();
  await expect(page.getByText('Link copiado. Envie-o por um canal seguro.')).toBeVisible();

  const revokeButton = page.getByRole('button', { name: 'Revogar convite de membro' }).last();
  await revokeButton.click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('alertdialog')).toBeHidden();
  await revokeButton.click();
  await page.getByRole('button', { name: 'Revogar convite', exact: true }).click();
  await expect(page.getByLabel('Status: Revogado')).toHaveCount(2);

  await page.getByRole('button', { name: 'Fechar' }).click();
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/\/app$/u);

  await page.goto('/settings');
  await page.getByRole('link', { name: 'Fechar configurações' }).click();
  await expect(page).toHaveURL(/\/app$/u);

  await page.goto('/settings');
  await page.getByRole('button', { name: 'Sair' }).click();
  await expect(page).toHaveURL(/\/login$/u);
});

test('usa navegação sobreposta no mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openSettings(page);

  await expect(page.getByRole('link', { name: 'Convites' })).toBeHidden();
  await page.getByRole('button', { name: 'Configurações', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Convites' })).toBeVisible();
  await page.getByRole('link', { name: 'Convites' }).click();
  await expect(page).toHaveURL(/\/settings\/invites$/u);
  await expect(page.getByRole('link', { name: 'Convites' })).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Convites', exact: true })).toBeVisible();
});

test('oculta a administração para membros', async ({ page }) => {
  await openSettings(page, '/settings', MEMBER);
  await expect(page.getByRole('link', { name: 'Convites' })).toHaveCount(0);

  await page.goto('/settings/invites');
  await expect(page).toHaveURL(/\/settings$/u);
});

test('apresenta dispositivos sem IDs técnicos e permite seleção por teclado', async ({ page }) => {
  await openSettings(page, '/settings/media');

  const microphone = page.getByRole('combobox', { name: 'Microfone' });
  await microphone.press('ArrowDown');
  await expect(page.getByRole('option', { name: /Padrão Razer Seiren Mini/u })).toBeVisible();
  await expect(page.getByRole('option', { name: /Comunicações Razer Seiren Mini/u })).toBeVisible();
  await expect(page.locator('body')).not.toContainText('1532:0531');
  await microphone.press('ArrowDown');
  await microphone.press('Enter');
  await expect(microphone).toHaveAttribute('title', 'Comunicações — Razer Seiren Mini');
});
