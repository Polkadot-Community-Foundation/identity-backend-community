import { defineConfig, sharedConfig } from '@identity-backend/vitest-config'

export default defineConfig({
  ...sharedConfig,
  test: {
    ...sharedConfig.test,
    setupFiles: ['./vitest-setup.ts'],
  },
})
