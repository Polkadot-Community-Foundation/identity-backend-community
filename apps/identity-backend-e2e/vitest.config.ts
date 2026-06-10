import { defineConfig, sharedConfig, type ViteUserConfig } from '@identity-backend/vitest-config'

const isCI = process.env.CI === 'true' || process.env.GITHUB_ACTIONS !== undefined

export default defineConfig({
  ...sharedConfig,
  test: {
    ...sharedConfig.test,
    hookTimeout: 360_000,
    isolate: true,
    reporters: isCI ? ['blob', 'github-actions', 'verbose'] : ['verbose'],
    setupFiles: ['./vitest.setup.ts'],
    globalSetup: ['./vitest.global-setup.ts'],
    retry: 1,
    testTimeout: 60_000,
    coverage: {
      enabled: false,
    },
    experimental: {
      openTelemetry: {
        enabled: process.env.OTEL_ENABLED === 'true',
        sdkPath: './otel.ts',
      },
    },
  },
} as ViteUserConfig)
