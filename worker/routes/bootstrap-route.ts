import type { Context } from 'hono';

import type { BootstrapView, PublicConfig } from '../../shared/types/api';
import { loadSession, rotateCsrfToken } from '../auth/session';
import type { AppBindings } from '../app-types';
import { success } from '../http';
import { listVoiceRooms } from '../repositories/rooms';
import { listActiveMembers } from '../repositories/users';

export const PRIMARY_SERVER = { id: 'k0sec', name: 'K0Sec' } as const;

function publicConfig(context: Context<AppBindings>): PublicConfig {
  return {
    registrationMode: context.env.REGISTRATION_MODE,
    realtimeEnabled: context.env.REALTIME_ENABLED === 'true',
    turnstileEnabled: context.env.TURNSTILE_ENABLED === 'true',
    turnstileSiteKey: context.env.TURNSTILE_SITE_KEY || null,
  };
}

export async function bootstrapRoute(context: Context<AppBindings>) {
  const config = publicConfig(context);
  const authenticated = await loadSession(context);
  if (!authenticated) {
    return success(context, { authenticated: false, config } satisfies BootstrapView);
  }

  const [csrfToken, channels, members] = await Promise.all([
    rotateCsrfToken(context.env, authenticated.session.id),
    listVoiceRooms(context.env.DB),
    listActiveMembers(context.env.DB),
  ]);
  return success(context, {
    authenticated: true,
    config,
    user: authenticated.user,
    csrfToken,
    server: PRIMARY_SERVER,
    channels,
    members,
    capabilities: {
      manageInvites: authenticated.user.role === 'owner' || authenticated.user.role === 'admin',
    },
  } satisfies BootstrapView);
}
