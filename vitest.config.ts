import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { configDefaults, defineConfig } from 'vitest/config';

const migrations = await readD1Migrations('./migrations');

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: migrations,
          PASSWORD_PEPPER: 'test-only-pepper-with-no-production-value',
          TURNSTILE_SECRET: '1x0000000000000000000000000000000AA',
          REALTIME_APP_ID: 'test-disabled',
          REALTIME_APP_SECRET: 'test-disabled',
          TURN_KEY_ID: 'test-disabled',
          TURN_KEY_API_TOKEN: 'test-disabled',
        },
      },
    }),
  ],
  test: {
    exclude: [...configDefaults.exclude, 'tests/e2e/**'],
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 30_000,
  },
});
