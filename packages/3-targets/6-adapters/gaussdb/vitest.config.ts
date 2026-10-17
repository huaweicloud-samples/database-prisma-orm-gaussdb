import { timeouts } from '@repo/test-utils';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./test/setup-temporal.ts'],
    testTimeout: timeouts.default,
    hookTimeout: timeouts.default,
    // Migration-plane integration tests exercise dialect-specific DDL and the
    // marker/ledger upsert path, which this adapter renders as GaussDB
    // `ON DUPLICATE KEY UPDATE` — syntax the PGlite host engine rejects.
    // That dialect-specific integration coverage is gated to Task 8
    // live-GaussDB journeys.
    exclude: ['**/node_modules/**', '**/dist/**', 'test/migrations/**/*.integration.test.ts'],
  },
});
