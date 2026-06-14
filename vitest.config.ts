import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    // Exclude build artifacts and deps, but allow web/src unit tests (e.g. geo).
    exclude: ['dist/**', 'node_modules/**', 'web/node_modules/**', 'web/dist/**', 'web/.astro/**'],
  },
});
