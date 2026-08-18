import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';

import { resetDatabase, seedInvite } from '../helpers/database';

describe('invariantes de segurança do D1', () => {
  beforeEach(resetDatabase);

  it('mantém foreign keys válidas depois de todas as migrations', async () => {
    await seedInvite();
    const violations = await env.DB.prepare('PRAGMA foreign_key_check').all();
    expect(violations.results).toEqual([]);
  });

  it('recusa role inválida, token duplicado e sessão órfã', async () => {
    const now = new Date().toISOString();
    await expect(
      env.DB.prepare(
        `INSERT INTO users (
           id, username, display_name, password_hash, password_salt, password_iterations,
           password_version, role, status, created_at, updated_at, password_changed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          crypto.randomUUID(),
          'invalid.role',
          'Invalid Role',
          'hash',
          'salt',
          100_000,
          1,
          'superadmin',
          'active',
          now,
          now,
          now,
        )
        .run(),
    ).rejects.toThrow();

    await seedInvite();
    const invite = await env.DB.prepare('SELECT token_hash FROM invites LIMIT 1').first<{
      token_hash: string;
    }>();
    expect(invite).not.toBeNull();
    await expect(
      env.DB.prepare(
        `INSERT INTO invites (id, token_hash, role, created_by, created_at, expires_at)
         VALUES (?, ?, 'member', ?, ?, ?)`,
      )
        .bind(
          crypto.randomUUID(),
          invite?.token_hash,
          '00000000-0000-4000-8000-000000000001',
          now,
          new Date(Date.now() + 60_000).toISOString(),
        )
        .run(),
    ).rejects.toThrow();

    await expect(
      env.DB.prepare(
        `INSERT INTO sessions (
           id, user_id, token_hash, csrf_token_hash, created_at, last_seen_at, expires_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          crypto.randomUUID(),
          crypto.randomUUID(),
          'unique-session-hash',
          'unique-csrf-hash',
          now,
          now,
          new Date(Date.now() + 60_000).toISOString(),
        )
        .run(),
    ).rejects.toThrow();
  });
});
