import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // A sample project isobar analyzes (test/run/isobar.test.ts), not a test suite: its users.test.ts is fixture code.
    exclude: [...configDefaults.exclude, 'test/fixtures/project-tiny/**'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
