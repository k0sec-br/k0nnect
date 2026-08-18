import { env } from 'cloudflare:workers';

export async function resetDatabase(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM security_events'),
    env.DB.prepare('DELETE FROM recovery_codes'),
    env.DB.prepare('DELETE FROM sessions'),
    env.DB.prepare('DELETE FROM invites'),
    env.DB.prepare('DELETE FROM users'),
  ]);
}

export async function seedInvite(options?: {
  expiresAt?: string;
  revokedAt?: string | null;
  role?: 'admin' | 'member' | 'owner';
  usedAt?: string | null;
}): Promise<string> {
  const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const byte of tokenBytes) binary += String.fromCharCode(byte);
  const token = btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  let hashBinary = '';
  for (const byte of new Uint8Array(digest)) hashBinary += String.fromCharCode(byte);
  const hash = btoa(hashBinary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
  const now = new Date();
  const role = options?.role ?? 'member';
  const creatorId = role === 'owner' ? null : '00000000-0000-4000-8000-000000000001';
  if (creatorId) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO users (
         id, username, display_name, password_hash, password_salt, password_iterations,
         password_version, role, status, created_at, updated_at, password_changed_at
       ) VALUES (?, 'test.creator', 'Test Creator', 'unused-test-hash', 'unused-test-salt',
         600000, 1, 'owner', 'active', ?, ?, ?)`,
    )
      .bind(creatorId, now.toISOString(), now.toISOString(), now.toISOString())
      .run();
  }
  await env.DB.prepare(
    `INSERT INTO invites (
       id, token_hash, role, created_by, created_at, expires_at, used_at, used_by, revoked_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      hash,
      role,
      creatorId,
      now.toISOString(),
      options?.expiresAt ?? new Date(now.getTime() + 3_600_000).toISOString(),
      options?.usedAt ?? null,
      options?.usedAt ? creatorId : null,
      options?.revokedAt ?? null,
    )
    .run();
  return token;
}
