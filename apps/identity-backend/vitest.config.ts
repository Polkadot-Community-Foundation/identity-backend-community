import { defineConfig, sharedConfig } from '@identity-backend/vitest-config'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  ...sharedConfig,
  plugins: [tsconfigPaths({ ignoreConfigErrors: true })],
  test: {
    ...sharedConfig.test,
    testTimeout: process.env.CI ? 240_000 : 120_000,
    hookTimeout: process.env.CI ? 40_000 : 20_000,
    coverage: {
      ...sharedConfig.test?.coverage,
    },
    hideSkippedTests: true,
    env: {
      JWT_AUTH_SECRET: 'my-very-strong-random-jwt-secret',
    },
    projects: [
      {
        extends: './vitest.config.ts',
        test: {
          name: 'unit',
          include: [
            'src/**/*.test.ts',
            'src/**/*.unit.test.ts',
            'src/**/*.property.test.ts',
          ],
          includeSource: ['src/**/*.{js,ts}'],
          exclude: [
            '**/*.integration.test.ts',
            'node_modules/**',
          ],
        },
      },
      {
        extends: './vitest.config.ts',
        test: {
          name: 'integration',
          include: [
            'tests/**/*.integration.test.ts',
            'src/**/*.integration.test.ts',
          ],
          exclude: ['node_modules/**'],
          setupFiles: ['./vitest.setup.ts', './otel.ts'],
        },
      },
    ],
  },
})
