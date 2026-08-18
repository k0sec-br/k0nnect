import { INVITE_LIFETIME_SECONDS } from '../../shared/constants/security';
import type { InviteView, SessionUser, UserRole } from '../../shared/types/api';
import { generateOpaqueToken, sha256 } from '../crypto/tokens';
import { AppError } from '../errors/app-error';

interface InviteRow {
  id: string;
  role: Exclude<UserRole, 'owner'>;
  created_at: string;
  expires_at: string;
  used_at: string | null;
  revoked_at: string | null;
}

function inviteStatus(invite: InviteRow): InviteView['status'] {
  if (invite.revoked_at) return 'revoked';
  if (invite.used_at) return 'used';
  if (new Date(invite.expires_at) <= new Date()) return 'expired';
  return 'available';
}

export async function listInvites(env: Env): Promise<InviteView[]> {
  const result = await env.DB.prepare(
    `SELECT id, role, created_at, expires_at, used_at, revoked_at
     FROM invites WHERE role <> 'owner' ORDER BY created_at DESC LIMIT 100`,
  ).all<InviteRow>();
  return result.results.map((invite) => ({
    id: invite.id,
    role: invite.role,
    createdAt: invite.created_at,
    expiresAt: invite.expires_at,
    status: inviteStatus(invite),
  }));
}

export async function createInvite(
  env: Env,
  creator: SessionUser,
  role: 'admin' | 'member',
): Promise<{ invite: InviteView; token: string; url: string }> {
  if (creator.role === 'member' || (creator.role === 'admin' && role === 'admin')) {
    throw new AppError('FORBIDDEN', 403);
  }
  const token = generateOpaqueToken();
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + INVITE_LIFETIME_SECONDS * 1_000);
  const invite: InviteView = {
    id: crypto.randomUUID(),
    role,
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    status: 'available',
  };
  await env.DB.prepare(
    `INSERT INTO invites (id, token_hash, role, created_by, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(invite.id, await sha256(token), role, creator.id, invite.createdAt, invite.expiresAt)
    .run();
  return { invite, token, url: `${env.APP_ORIGIN}/invite#${token}` };
}

export async function revokeInvite(env: Env, inviteId: string): Promise<void> {
  const result = await env.DB.prepare(
    `UPDATE invites SET revoked_at = ?
     WHERE id = ? AND used_at IS NULL AND revoked_at IS NULL AND role <> 'owner'`,
  )
    .bind(new Date().toISOString(), inviteId)
    .run();
  if (result.meta.changes !== 1) throw new AppError('INVITE_UNAVAILABLE', 404);
}
