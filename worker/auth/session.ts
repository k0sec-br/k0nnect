import { getCookie, setCookie } from 'hono/cookie';
import type { Context } from 'hono';

import {
  SESSION_ABSOLUTE_SECONDS,
  SESSION_COOKIE_NAME,
  SESSION_IDLE_SECONDS,
  SESSION_TOUCH_INTERVAL_SECONDS,
} from '../../shared/constants/security';
import type { SessionUser, SessionView } from '../../shared/types/api';
import { base64UrlToBytes } from '../crypto/encoding';
import { generateOpaqueToken, sha256 } from '../crypto/tokens';
import { AppError } from '../errors/app-error';
import { validateRequestOrigin } from '../security/origin';
import type { AppBindings } from '../app-types';

export interface AuthenticatedSession {
  session: SessionView;
  user: SessionUser;
  csrfTokenHash: string;
}

interface SessionRow {
  session_id: string;
  user_id: string;
  username: string;
  display_name: string;
  role: SessionUser['role'];
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  csrf_token_hash: string;
}

export function sessionCookieOptions(maxAge = SESSION_ABSOLUTE_SECONDS) {
  return { httpOnly: true, secure: true, sameSite: 'Lax' as const, path: '/', maxAge };
}

export function writeSessionCookie(context: Context, token: string): void {
  setCookie(context, SESSION_COOKIE_NAME, token, sessionCookieOptions());
}

export function clearSessionCookie(context: Context): void {
  setCookie(context, SESSION_COOKIE_NAME, '', sessionCookieOptions(0));
}

export function readSessionToken(context: Context): string | undefined {
  const token = getCookie(context, SESSION_COOKIE_NAME);
  return token && /^[A-Za-z0-9_-]{43}$/u.test(token) ? token : undefined;
}

export async function loadSession(
  context: Context<AppBindings>,
  touch = true,
): Promise<AuthenticatedSession | null> {
  const token = readSessionToken(context);
  if (!token) {
    if (getCookie(context, SESSION_COOKIE_NAME)) clearSessionCookie(context);
    return null;
  }
  const tokenHash = await sha256(token);
  const now = new Date();
  const idleCutoff = new Date(now.getTime() - SESSION_IDLE_SECONDS * 1_000).toISOString();
  const row = await context.env.DB.prepare(
    `SELECT s.id AS session_id, s.user_id, s.created_at, s.last_seen_at, s.expires_at,
            s.csrf_token_hash, u.username, u.display_name, u.role
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?
       AND s.last_seen_at > ? AND u.status = 'active'
     LIMIT 1`,
  )
    .bind(tokenHash, now.toISOString(), idleCutoff)
    .first<SessionRow>();
  if (!row) {
    clearSessionCookie(context);
    return null;
  }

  if (
    touch &&
    now.getTime() - new Date(row.last_seen_at).getTime() >= SESSION_TOUCH_INTERVAL_SECONDS * 1_000
  ) {
    const touchedAt = now.toISOString();
    await context.env.DB.prepare(
      'UPDATE sessions SET last_seen_at = ? WHERE id = ? AND last_seen_at = ?',
    )
      .bind(touchedAt, row.session_id, row.last_seen_at)
      .run();
    row.last_seen_at = touchedAt;
  }

  return {
    session: {
      id: row.session_id,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
      expiresAt: row.expires_at,
      current: true,
    },
    user: {
      id: row.user_id,
      username: row.username,
      displayName: row.display_name,
      role: row.role,
    },
    csrfTokenHash: row.csrf_token_hash,
  };
}

export async function requireSession(context: Context<AppBindings>): Promise<AuthenticatedSession> {
  const session = await loadSession(context);
  if (!session) throw new AppError('AUTH_REQUIRED', 401);
  return session;
}

export async function rotateCsrfToken(env: Env, sessionId: string): Promise<string> {
  const token = generateOpaqueToken();
  await env.DB.prepare(
    'UPDATE sessions SET csrf_token_hash = ? WHERE id = ? AND revoked_at IS NULL',
  )
    .bind(await sha256(token), sessionId)
    .run();
  return token;
}

export async function verifyCsrf(
  context: Context<AppBindings>,
  session: AuthenticatedSession,
): Promise<void> {
  validateRequestOrigin(context.req.raw, context.env);
  const token = context.req.header('X-CSRF-Token');
  if (!token || !/^[A-Za-z0-9_-]{43}$/u.test(token)) throw new AppError('CSRF_INVALID', 403);
  const actual = base64UrlToBytes(await sha256(token));
  const expected = base64UrlToBytes(session.csrfTokenHash);
  if (
    actual.byteLength !== expected.byteLength ||
    !crypto.subtle.timingSafeEqual(actual, expected)
  ) {
    throw new AppError('CSRF_INVALID', 403);
  }
}

export async function createSessionValues(userId: string) {
  const token = generateOpaqueToken();
  const csrfToken = generateOpaqueToken();
  const now = new Date();
  return {
    id: crypto.randomUUID(),
    userId,
    token,
    tokenHash: await sha256(token),
    csrfToken,
    csrfTokenHash: await sha256(csrfToken),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + SESSION_ABSOLUTE_SECONDS * 1_000).toISOString(),
  };
}
