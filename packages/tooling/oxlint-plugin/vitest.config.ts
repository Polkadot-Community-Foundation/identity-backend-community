import { defineConfig, sharedConfig } from '@identity-backend/vitest-config'

export default defineConfig({
  ...sharedConfig,
  test: {
    ...sharedConfig.test,
    include: ['src/**/*.test.ts'],
    setupFiles: ['vitest-setup.ts'],
  },
})
