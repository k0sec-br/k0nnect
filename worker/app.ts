import { Hono } from 'hono';

import type { AppBindings } from './app-types';
import { AppError } from './errors/app-error';
import { failure, success } from './http';
import { adminRoutes } from './routes/admin-routes';
import { authRoutes } from './routes/auth-routes';
import { realtimeRoutes } from './routes/realtime-routes';
import { roomRoutes } from './routes/room-routes';
import { applySecurityHeaders } from './security/headers';
import { logSecurityEvent } from './security/logger';
import { validateRequestOrigin } from './security/origin';
import { enforceRateLimit, RATE_LIMIT_POLICIES, requestIp } from './security/rate-limit';

export const app = new Hono<AppBindings>();

app.use('/api/*', async (context, next) => {
  const requestId = crypto.randomUUID();
  context.set('requestId', requestId);
  context.header('X-Request-Id', requestId);
  await next();
  if (context.res.status !== 101) context.res = applySecurityHeaders(context.res);
});

app.use('/api/*', async (context, next) => {
  await enforceRateLimit(context.env, `ip:${requestIp(context.req.raw)}`, RATE_LIMIT_POLICIES.api);
  const method = context.req.method;
  if (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE') {
    validateRequestOrigin(context.req.raw, context.env);
  }
  await next();
});

app.get('/api/config', (context) =>
  success(context, {
    registrationMode: context.env.REGISTRATION_MODE,
    realtimeEnabled: context.env.REALTIME_ENABLED === 'true',
    turnstileEnabled: context.env.TURNSTILE_ENABLED === 'true',
    turnstileSiteKey: context.env.TURNSTILE_SITE_KEY || null,
  }),
);

app.route('/api/auth', authRoutes);
app.route('/api/admin', adminRoutes);
app.route('/api/rooms', roomRoutes);
app.route('/api/realtime', realtimeRoutes);

app.notFound((context) => failure(context, new AppError('INTERNAL_ERROR', 404)));

app.onError((error, context) => {
  const appError = error instanceof AppError ? error : new AppError('INTERNAL_ERROR', 500);
  logSecurityEvent(appError.status >= 500 ? 'error' : 'warn', {
    event: 'request_failed',
    requestId: context.get('requestId'),
    route: new URL(context.req.url).pathname,
    status: appError.status,
    errorName: error instanceof Error ? error.name : 'NonError',
  });
  return applySecurityHeaders(failure(context, appError));
});
