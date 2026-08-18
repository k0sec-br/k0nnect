import { AppError } from '../errors/app-error';

function allowedOrigins(env: Env): Set<string> {
  const origins = new Set<string>([env.APP_ORIGIN]);
  if (env.ENVIRONMENT === 'development') {
    origins.add('http://localhost:5173');
    origins.add('http://127.0.0.1:5173');
  }
  return origins;
}

export function validateRequestOrigin(request: Request, env: Env): void {
  const origin = request.headers.get('Origin');
  if (origin === null || !allowedOrigins(env).has(origin)) throw new AppError('FORBIDDEN', 403);

  const expectedHost = new URL(origin).host;
  const forwardedHost = request.headers.get('X-Forwarded-Host');
  const host = forwardedHost ?? request.headers.get('Host') ?? new URL(request.url).host;
  if (host !== expectedHost) throw new AppError('FORBIDDEN', 403);
}
