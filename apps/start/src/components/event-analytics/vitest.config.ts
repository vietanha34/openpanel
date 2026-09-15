import { defineConfig } from 'vitest/config';

/**
 * `apps/start` is excluded from the root vitest workspace and its `vite.config.ts`
 * loads the TanStack Start / Cloudflare plugins, which cannot run under vitest.
 * This standalone config lets the pure helpers in this folder be unit tested:
 *
 *   pnpm exec vitest run --config apps/start/src/components/event-analytics/vitest.config.ts
 */
export default defineConfig({
  test: {
    root: __dirname,
    include: ['*.test.ts'],
  },
});
