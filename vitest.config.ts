import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    // Each test file gets a fresh module graph so module-level state in
    // src/api.ts (accessExpiresAt, caches) doesn't bleed between files.
    isolate: true,
  },
});
