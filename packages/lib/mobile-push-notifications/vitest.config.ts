import { defineConfig, sharedConfig } from '@identity-backend/vitest-config'

export default defineConfig({
  ...sharedConfig,
  test: {
    ...sharedConfig.test,
    include: ['**/*.test.ts'],
    includeSource: ['src/**/*.{js,ts}'],
    exclude: ['!**/__tests__/fixtures.ts', '**/.stryker-tmp', '**/dist', '**/node_modules'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', '**/*/mod.ts'],
      thresholds: {
        statements: 0,
        branches: 70,
        functions: 70,
        lines: 0,
      },
    },
  },
})
