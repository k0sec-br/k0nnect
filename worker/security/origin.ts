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

  const requestOrigin = new URL(request.url).origin;
  if (!allowedOrigins(env).has(requestOrigin) || requestOrigin !== origin) {
    throw new AppError('FORBIDDEN', 403);
  }
}
