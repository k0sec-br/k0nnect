import { RECOVERY_CODE_COUNT } from '../../shared/constants/security';
import type {
  LoginInput,
  RecoverAccountInput,
  RegisterInviteInput,
} from '../../shared/schemas/auth';
import type { SessionUser, SessionView } from '../../shared/types/api';
import { createSessionValues, type AuthenticatedSession } from '../auth/session';
import { hashPassword, performDummyPasswordVerification, verifyPassword } from '../crypto/password';
import { generateRecoveryCodes, sha256 } from '../crypto/tokens';
import { AppError } from '../errors/app-error';
import { findUserByUsername } from '../repositories/users';

export interface NewAuthenticatedSession {
  user: SessionUser;
  sessionToken: string;
  csrfToken: string;
  recoveryCodes?: string[];
}

async function recoveryCodeRows(userId: string, codes: string[], createdAt: string) {
  return Promise.all(
    codes.map(async (code) => ({
      id: crypto.randomUUID(),
      userId,
      codeHash: await sha256(code),
      createdAt,
    })),
  );
}

function passwordRecord(user: Awaited<ReturnType<typeof findUserByUsername>>) {
  if (!user) throw new AppError('AUTH_INVALID_CREDENTIALS', 401);
  return {
    hash: user.passwordHash,
    salt: user.passwordSalt,
    iterations: user.passwordIterations,
    version: user.passwordVersion,
  };
}

export async function registerWithInvite(
  env: Env,
  input: RegisterInviteInput,
): Promise<NewAuthenticatedSession> {
  if (env.REGISTRATION_MODE !== 'invite') throw new AppError('INVITE_UNAVAILABLE', 400);
  const inviteHash = await sha256(input.inviteToken);
  const invite = await env.DB.prepare(
    `SELECT id, role FROM invites
     WHERE token_hash = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?
     LIMIT 1`,
  )
    .bind(inviteHash, new Date().toISOString())
    .first<{ id: string; role: SessionUser['role'] }>();
  if (!invite) throw new AppError('INVITE_UNAVAILABLE', 400);

  const now = new Date().toISOString();
  const userId = crypto.randomUUID();
  const password = await hashPassword(input.password, env.PASSWORD_PEPPER);
  const recoveryCodes = generateRecoveryCodes();
  const recoveryRows = await recoveryCodeRows(userId, recoveryCodes, now);
  const session = await createSessionValues(userId);

  try {
    const statements: D1PreparedStatement[] = [
      env.DB.prepare(
        `INSERT INTO users (
           id, username, display_name, password_hash, password_salt, password_iterations,
           password_version, role, status, created_at, updated_at, password_changed_at
         )
         SELECT ?, ?, ?, ?, ?, ?, ?, role, 'active', ?, ?, ?
         FROM invites
         WHERE id = ? AND token_hash = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?
           AND NOT EXISTS (SELECT 1 FROM users WHERE username = ? COLLATE NOCASE)`,
      ).bind(
        userId,
        input.username,
        input.displayName,
        password.hash,
        password.salt,
        password.iterations,
        password.version,
        now,
        now,
        now,
        invite.id,
        inviteHash,
        now,
        input.username,
      ),
      env.DB.prepare(
        `UPDATE invites
         SET used_at = CASE WHEN EXISTS (SELECT 1 FROM users WHERE id = ?) THEN ? ELSE used_at END,
             used_by = CASE WHEN EXISTS (SELECT 1 FROM users WHERE id = ?) THEN ? ELSE used_by END,
             revoked_at = CASE WHEN EXISTS (SELECT 1 FROM users WHERE id = ?) THEN revoked_at ELSE ? END
         WHERE id = ? AND token_hash = ? AND used_at IS NULL AND revoked_at IS NULL
           AND expires_at > ?`,
      ).bind(userId, now, userId, userId, userId, now, invite.id, inviteHash, now),
      ...recoveryRows.map((row) =>
        env.DB.prepare(
          `INSERT INTO recovery_codes (id, user_id, code_hash, created_at)
           SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM users WHERE id = ?)`,
        ).bind(row.id, row.userId, row.codeHash, row.createdAt, row.userId),
      ),
      env.DB.prepare(
        `INSERT INTO sessions (
           id, user_id, token_hash, csrf_token_hash, created_at, last_seen_at, expires_at
         ) SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM users WHERE id = ?)`,
      ).bind(
        session.id,
        userId,
        session.tokenHash,
        session.csrfTokenHash,
        session.createdAt,
        session.createdAt,
        session.expiresAt,
        userId,
      ),
    ];
    const results = await env.DB.batch(statements);
    if (results[0]?.meta.changes !== 1 || results[1]?.meta.changes !== 1) {
      throw new AppError('INVITE_UNAVAILABLE', 400);
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('VALIDATION_ERROR', 409);
  }

  return {
    user: {
      id: userId,
      username: input.username,
      displayName: input.displayName,
      role: invite.role,
    },
    sessionToken: session.token,
    csrfToken: session.csrfToken,
    recoveryCodes,
  };
}

export async function login(
  env: Env,
  input: LoginInput,
  currentSessionToken?: string,
): Promise<NewAuthenticatedSession> {
  const user = await findUserByUsername(env.DB, input.username);
  if (!user) {
    await performDummyPasswordVerification(input.password, env.PASSWORD_PEPPER);
    throw new AppError('AUTH_INVALID_CREDENTIALS', 401);
  }

  const validPassword = await verifyPassword(
    input.password,
    env.PASSWORD_PEPPER,
    passwordRecord(user),
  );
  if (!validPassword || user.status !== 'active') {
    const failureCount = user.failedLoginCount + 1;
    const cooldownSeconds =
      failureCount >= 8 ? 300 : failureCount >= 5 ? 30 : failureCount >= 3 ? 5 : 0;
    const loginNotBefore =
      cooldownSeconds > 0 ? new Date(Date.now() + cooldownSeconds * 1_000).toISOString() : null;
    await env.DB.prepare(
      'UPDATE users SET failed_login_count = ?, login_not_before = ?, updated_at = ? WHERE id = ?',
    )
      .bind(failureCount, loginNotBefore, new Date().toISOString(), user.id)
      .run();
    throw new AppError('AUTH_INVALID_CREDENTIALS', 401);
  }

  const session = await createSessionValues(user.id);
  const statements = [
    env.DB.prepare(
      `INSERT INTO sessions (id, user_id, token_hash, csrf_token_hash, created_at, last_seen_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      session.id,
      user.id,
      session.tokenHash,
      session.csrfTokenHash,
      session.createdAt,
      session.createdAt,
      session.expiresAt,
    ),
    env.DB.prepare(
      `UPDATE users SET failed_login_count = 0, login_not_before = NULL,
       last_login_at = ?, updated_at = ? WHERE id = ?`,
    ).bind(session.createdAt, session.createdAt, user.id),
  ];
  if (currentSessionToken) {
    statements.push(
      env.DB.prepare(
        'UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL',
      ).bind(session.createdAt, await sha256(currentSessionToken)),
    );
  }
  await env.DB.batch(statements);
  return {
    user: { id: user.id, username: user.username, displayName: user.displayName, role: user.role },
    sessionToken: session.token,
    csrfToken: session.csrfToken,
  };
}

export async function recoverAccount(
  env: Env,
  input: RecoverAccountInput,
): Promise<{ recoveryCodes: string[] }> {
  const user = await findUserByUsername(env.DB, input.username);
  if (!user) {
    await performDummyPasswordVerification(input.newPassword, env.PASSWORD_PEPPER);
    throw new AppError('RECOVERY_INVALID', 400);
  }

  const now = new Date().toISOString();
  const recoveryCodeHash = await sha256(input.recoveryCode);
  const newPassword = await hashPassword(input.newPassword, env.PASSWORD_PEPPER);
  const newCodes = generateRecoveryCodes();
  const newRows = await recoveryCodeRows(user.id, newCodes, now);
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `UPDATE users
       SET password_hash = ?, password_salt = ?, password_iterations = ?, password_version = ?,
           password_changed_at = ?, updated_at = ?, failed_login_count = 0, login_not_before = NULL
       WHERE id = ? AND status = 'active'
         AND EXISTS (
           SELECT 1 FROM recovery_codes
           WHERE user_id = ? AND code_hash = ? AND used_at IS NULL
         )`,
    ).bind(
      newPassword.hash,
      newPassword.salt,
      newPassword.iterations,
      newPassword.version,
      now,
      now,
      user.id,
      user.id,
      recoveryCodeHash,
    ),
    env.DB.prepare(
      `UPDATE recovery_codes SET used_at = ?
       WHERE user_id = ? AND code_hash = ? AND used_at IS NULL
         AND EXISTS (SELECT 1 FROM users WHERE id = ? AND password_changed_at = ?)`,
    ).bind(now, user.id, recoveryCodeHash, user.id, now),
    env.DB.prepare(
      `UPDATE sessions SET revoked_at = ?
       WHERE user_id = ? AND revoked_at IS NULL
         AND EXISTS (SELECT 1 FROM users WHERE id = ? AND password_changed_at = ?)`,
    ).bind(now, user.id, user.id, now),
    env.DB.prepare(
      `DELETE FROM recovery_codes
       WHERE user_id = ? AND code_hash <> ?
         AND EXISTS (SELECT 1 FROM users WHERE id = ? AND password_changed_at = ?)`,
    ).bind(user.id, recoveryCodeHash, user.id, now),
    ...newRows.map((row) =>
      env.DB.prepare(
        `INSERT INTO recovery_codes (id, user_id, code_hash, created_at)
         SELECT ?, ?, ?, ?
         WHERE EXISTS (SELECT 1 FROM users WHERE id = ? AND password_changed_at = ?)`,
      ).bind(row.id, row.userId, row.codeHash, row.createdAt, user.id, now),
    ),
  ];
  const results = await env.DB.batch(statements);
  if (results[0]?.meta.changes !== 1 || results[1]?.meta.changes !== 1) {
    throw new AppError('RECOVERY_INVALID', 400);
  }
  return { recoveryCodes: newCodes };
}

export async function regenerateRecoveryCodes(
  env: Env,
  authenticated: AuthenticatedSession,
  password: string,
): Promise<NewAuthenticatedSession> {
  const user = await findUserByUsername(env.DB, authenticated.user.username);
  if (!user || !(await verifyPassword(password, env.PASSWORD_PEPPER, passwordRecord(user)))) {
    throw new AppError('AUTH_INVALID_CREDENTIALS', 401);
  }
  const now = new Date().toISOString();
  const codes = generateRecoveryCodes();
  if (codes.length !== RECOVERY_CODE_COUNT) throw new AppError('INTERNAL_ERROR', 500);
  const rows = await recoveryCodeRows(user.id, codes, now);
  const session = await createSessionValues(user.id);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM recovery_codes WHERE user_id = ?').bind(user.id),
    ...rows.map((row) =>
      env.DB.prepare(
        'INSERT INTO recovery_codes (id, user_id, code_hash, created_at) VALUES (?, ?, ?, ?)',
      ).bind(row.id, row.userId, row.codeHash, row.createdAt),
    ),
    env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ? AND user_id = ?').bind(
      now,
      authenticated.session.id,
      user.id,
    ),
    env.DB.prepare(
      `INSERT INTO sessions (id, user_id, token_hash, csrf_token_hash, created_at, last_seen_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      session.id,
      user.id,
      session.tokenHash,
      session.csrfTokenHash,
      session.createdAt,
      session.createdAt,
      session.expiresAt,
    ),
  ]);
  return {
    user: authenticated.user,
    sessionToken: session.token,
    csrfToken: session.csrfToken,
    recoveryCodes: codes,
  };
}

export async function logoutSession(env: Env, sessionId: string): Promise<void> {
  await env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL')
    .bind(new Date().toISOString(), sessionId)
    .run();
}

export async function logoutAllSessions(env: Env, userId: string): Promise<void> {
  await env.DB.prepare(
    'UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL',
  )
    .bind(new Date().toISOString(), userId)
    .run();
}

export async function listSessions(
  env: Env,
  authenticated: AuthenticatedSession,
): Promise<SessionView[]> {
  const result = await env.DB.prepare(
    `SELECT id, created_at, last_seen_at, expires_at
     FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?
     ORDER BY created_at DESC`,
  )
    .bind(authenticated.user.id, new Date().toISOString())
    .all<{ id: string; created_at: string; last_seen_at: string; expires_at: string }>();
  return result.results.map((session) => ({
    id: session.id,
    createdAt: session.created_at,
    lastSeenAt: session.last_seen_at,
    expiresAt: session.expires_at,
    current: session.id === authenticated.session.id,
  }));
}
