import { defineConfig, sharedConfig } from '@identity-backend/vitest-config'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  ...sharedConfig,
  plugins: [tsconfigPaths({ ignoreConfigErrors: true })],
  test: {
    ...sharedConfig.test,
    setupFiles: ['./vitest.setup.ts'],
  },
})
