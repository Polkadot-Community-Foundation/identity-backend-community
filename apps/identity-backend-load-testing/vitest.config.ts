import { defineConfig, sharedConfig } from '@identity-backend/vitest-config'

export default defineConfig({
  ...sharedConfig,
  test: {
    ...sharedConfig.test,
    include: ['src/**/*.test.ts', 'ts-setup/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/lib/bytes.ts', 'ts-setup/perf-report.ts', 'ts-setup/username-fixtures.ts'],
      exclude: ['**/*.test.ts'],
    },
  },
})
