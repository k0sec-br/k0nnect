import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';

import type { ApiSuccess } from '../../shared/types/api';
import { cleanupExpiredData } from '../../worker/services/cleanup-service';
import { resetDatabase, seedInvite } from '../helpers/database';
import { apiRequest } from '../helpers/http';

describe('limpeza periódica', () => {
  beforeEach(resetDatabase);

  it('é idempotente e preserva dados ativos', async () => {
    const registration = await apiRequest('/api/auth/register-invite', {
      method: 'POST',
      body: JSON.stringify({
        inviteToken: await seedInvite({ role: 'owner' }),
        username: 'owner.user',
        displayName: 'Owner',
        password: 'uma-senha-segura-e-longa',
      }),
    });
    expect(registration.status).toBe(201);
    const registrationBody = await registration.json<ApiSuccess<{ user: { id: string } }>>();
    const userId = registrationBody.data.user.id;
    const oldDate = '2020-01-01T00:00:00.000Z';
    await seedInvite({ expiresAt: oldDate });
    await seedInvite({ expiresAt: '2099-01-01T00:00:00.000Z' });
    await env.DB.batch([
      env.DB.prepare('UPDATE sessions SET expires_at = ? WHERE user_id = ?').bind(oldDate, userId),
      env.DB.prepare(
        `INSERT INTO sessions (
           id, user_id, token_hash, csrf_token_hash, created_at, last_seen_at, expires_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        userId,
        `active-${crypto.randomUUID()}`,
        `csrf-${crypto.randomUUID()}`,
        new Date().toISOString(),
        new Date().toISOString(),
        '2099-01-01T00:00:00.000Z',
      ),
      env.DB.prepare('UPDATE invites SET created_at = ? WHERE expires_at = ?').bind(
        oldDate,
        oldDate,
      ),
      env.DB.prepare(
        `INSERT INTO security_events (
           id, event_type, user_id, request_id, created_at, expires_at
         ) VALUES (?, 'test', ?, 'expired-request', ?, ?)`,
      ).bind(crypto.randomUUID(), userId, oldDate, oldDate),
      env.DB.prepare(
        `INSERT INTO security_events (
           id, event_type, user_id, request_id, created_at, expires_at
         ) VALUES (?, 'test', ?, 'active-request', ?, ?)`,
      ).bind(crypto.randomUUID(), userId, new Date().toISOString(), '2099-01-01T00:00:00.000Z'),
    ]);

    await cleanupExpiredData(env);
    await cleanupExpiredData(env);

    const sessions = await env.DB.prepare('SELECT token_hash FROM sessions WHERE user_id = ?')
      .bind(userId)
      .all<{ token_hash: string }>();
    expect(sessions.results).toHaveLength(1);
    expect(sessions.results[0]?.token_hash).toContain('active-');
    const events = await env.DB.prepare('SELECT request_id FROM security_events').all<{
      request_id: string;
    }>();
    expect(events.results.map((event) => event.request_id)).toEqual(['active-request']);
    const invites = await env.DB.prepare(
      'SELECT expires_at FROM invites WHERE used_at IS NULL',
    ).all<{
      expires_at: string;
    }>();
    expect(invites.results).toHaveLength(1);
    expect(invites.results[0]?.expires_at).toBe('2099-01-01T00:00:00.000Z');
  });
});
