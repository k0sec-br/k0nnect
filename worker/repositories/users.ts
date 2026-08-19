import type { MemberView, SessionUser, UserRole } from '../../shared/types/api';

export interface UserWithPassword extends SessionUser {
  passwordHash: string;
  passwordSalt: string;
  passwordIterations: number;
  passwordVersion: number;
  status: 'active' | 'disabled';
  failedLoginCount: number;
  loginNotBefore: string | null;
}

interface UserRow {
  id: string;
  username: string;
  display_name: string;
  role: UserRole;
  status: 'active' | 'disabled';
  password_hash: string;
  password_salt: string;
  password_iterations: number;
  password_version: number;
  failed_login_count: number;
  login_not_before: string | null;
}

export async function findUserByUsername(
  database: D1Database,
  username: string,
): Promise<UserWithPassword | null> {
  const row = await database
    .prepare(
      `SELECT id, username, display_name, role, status, password_hash, password_salt,
              password_iterations, password_version, failed_login_count, login_not_before
       FROM users WHERE username = ? LIMIT 1`,
    )
    .bind(username)
    .first<UserRow>();
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    passwordHash: row.password_hash,
    passwordSalt: row.password_salt,
    passwordIterations: row.password_iterations,
    passwordVersion: row.password_version,
    failedLoginCount: row.failed_login_count,
    loginNotBefore: row.login_not_before,
  };
}

export async function listActiveMembers(database: D1Database): Promise<MemberView[]> {
  const result = await database
    .prepare(
      `SELECT id, username, display_name, role
       FROM users
       WHERE status = 'active'
       ORDER BY display_name COLLATE NOCASE, username COLLATE NOCASE`,
    )
    .all<{ id: string; username: string; display_name: string; role: UserRole }>();
  return result.results.map((member) => ({
    id: member.id,
    username: member.username,
    displayName: member.display_name,
    role: member.role,
  }));
}
