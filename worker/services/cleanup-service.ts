import { SECURITY_EVENT_RETENTION_SECONDS } from '../../shared/constants/security';

export async function cleanupExpiredData(env: Env): Promise<void> {
  const now = new Date();
  const oldInviteCutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1_000).toISOString();
  const securityCutoff = new Date(
    now.getTime() - SECURITY_EVENT_RETENTION_SECONDS * 1_000,
  ).toISOString();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ? OR revoked_at <= ?').bind(
      now.toISOString(),
      oldInviteCutoff,
    ),
    env.DB.prepare(
      `DELETE FROM invites
       WHERE (expires_at <= ? OR used_at <= ? OR revoked_at <= ?) AND created_at <= ?`,
    ).bind(oldInviteCutoff, oldInviteCutoff, oldInviteCutoff, oldInviteCutoff),
    env.DB.prepare('DELETE FROM security_events WHERE expires_at <= ? OR created_at <= ?').bind(
      now.toISOString(),
      securityCutoff,
    ),
  ]);
}
