import { defineConfig } from 'vitest/config'
import { statementStoreVitestCiTestTimeoutMillis } from './test/harness/timings.js'

const isCI = process.env['CI'] === 'true' || process.env['GITHUB_ACTIONS'] !== undefined
const isAgent = !isCI && !process.stdout.isTTY

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    includeSource: ['src/**/*.{js,ts}'],
    include: ['src/**/*.ts', 'test/**/*.test.ts'],
    exclude: ['**/.stryker-tmp/**', '**/node_modules/**', '**/.repo/**'],
    passWithNoTests: true,
    testTimeout: statementStoreVitestCiTestTimeoutMillis,
    silent: isAgent ? 'passed-only' : false,
    bail: isAgent ? 1 : undefined,
    tags: [
      {
        name: 'ppn',
        description: 'Requires a running paritytech/ppn node and GITHUB_TOKEN; opt-in via `pnpm test:ppn`',
      },
    ],
    coverage: {
      enabled: isCI || process.env['COVERAGE'] === 'true',
      provider: 'istanbul',
      reporter: ['text-summary', 'text', 'json', 'html', 'lcov'],
      include: ['./src/**/*.ts'],
      exclude: ['./src/index.ts', './src/**/*.test.ts'],
    },
  },
})
