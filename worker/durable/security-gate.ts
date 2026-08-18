import { DurableObject } from 'cloudflare:workers';

export interface RateLimitDecision {
  allowed: boolean;
  count: number;
  retryAfter: number;
}

export class SecurityGate extends DurableObject<Env> {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    void state.blockConcurrencyWhile(() => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS counters (
          policy TEXT NOT NULL,
          window_start INTEGER NOT NULL,
          request_count INTEGER NOT NULL,
          PRIMARY KEY (policy, window_start)
        )
      `);
      return Promise.resolve();
    });
  }

  consume(
    policy: string,
    limit: number,
    windowSeconds: number,
    now = Date.now(),
  ): RateLimitDecision {
    const windowMilliseconds = windowSeconds * 1_000;
    const windowStart = Math.floor(now / windowMilliseconds) * windowMilliseconds;
    this.ctx.storage.sql.exec(
      `INSERT INTO counters (policy, window_start, request_count)
       VALUES (?, ?, 1)
       ON CONFLICT (policy, window_start)
       DO UPDATE SET request_count = request_count + 1`,
      policy,
      windowStart,
    );
    const row = this.ctx.storage.sql
      .exec<{ request_count: number }>(
        'SELECT request_count FROM counters WHERE policy = ? AND window_start = ?',
        policy,
        windowStart,
      )
      .one();
    this.ctx.storage.sql.exec(
      'DELETE FROM counters WHERE window_start < ?',
      windowStart - 86_400_000,
    );
    return {
      allowed: row.request_count <= limit,
      count: row.request_count,
      retryAfter: Math.max(1, Math.ceil((windowStart + windowMilliseconds - now) / 1_000)),
    };
  }
}
