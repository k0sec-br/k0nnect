import { Hono } from 'hono';

import type { AppBindings } from './app-types';
import { AppError } from './errors/app-error';
import { failure } from './http';
import { adminRoutes } from './routes/admin-routes';
import { authRoutes } from './routes/auth-routes';
import { bootstrapRoute } from './routes/bootstrap-route';
import { realtimeRoutes } from './routes/realtime-routes';
import { serverRoutes } from './routes/server-routes';
import { socialRoutes } from './routes/social-routes';
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
  const path = new URL(context.req.url).pathname;
  const hasDedicatedRealtimeLimit =
    context.req.header('Upgrade')?.toLowerCase() === 'websocket' ||
    path === '/api/realtime/session';
  if (!hasDedicatedRealtimeLimit) {
    await enforceRateLimit(
      context.env,
      `ip:${requestIp(context.req.raw)}`,
      RATE_LIMIT_POLICIES.api,
    );
  }
  const method = context.req.method;
  if (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE') {
    validateRequestOrigin(context.req.raw, context.env);
  }
  await next();
});

app.get('/api/bootstrap', bootstrapRoute);

app.route('/api/auth', authRoutes);
app.route('/api/admin', adminRoutes);
app.route('/api/servers', serverRoutes);
app.route('/api/social', socialRoutes);
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
