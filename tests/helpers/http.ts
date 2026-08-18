import { exports } from 'cloudflare:workers';

let requestCounter = 0;

export async function apiRequest(
  path: string,
  init: RequestInit & { cookie?: string; csrfToken?: string } = {},
): Promise<Response> {
  requestCounter += 1;
  const headers = new Headers(init.headers);
  if (!headers.has('Origin')) headers.set('Origin', 'http://localhost:5173');
  if (!headers.has('Host')) headers.set('Host', 'localhost:5173');
  if (!headers.has('CF-Connecting-IP')) {
    headers.set('CF-Connecting-IP', `198.51.100.${requestCounter % 250}`);
  }
  if (init.body) headers.set('Content-Type', 'application/json');
  if (init.cookie) headers.set('Cookie', init.cookie);
  if (init.csrfToken) headers.set('X-CSRF-Token', init.csrfToken);
  return exports.default.fetch(`http://localhost:5173${path}`, { ...init, headers });
}

export function sessionCookie(response: Response): string {
  const setCookie = response.headers.get('Set-Cookie');
  if (!setCookie) throw new Error('Cookie de sessão ausente no teste');
  return setCookie.split(';')[0] ?? '';
}
