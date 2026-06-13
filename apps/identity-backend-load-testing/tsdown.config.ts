import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    search: './src/search.ts',
    healthcheck: './src/healthcheck.ts',
    'smoke-search': './src/smoke-search.ts',
    subscriptions: './src/subscriptions.ts',
    'auth-challenges': './src/auth-challenges.ts',
    'stress-search': './src/stress-search.ts',
    'spike-search': './src/spike-search.ts',
    'concurrent-search': './src/concurrent-search.ts',
    'register-flood': './src/register-flood.ts',
    'register-ticket-storm': './src/register-ticket-storm.ts',
    loadgen: './src/cli/main.ts',
  },
  format: 'esm',
  clean: true,
  deps: {
    neverBundle: [
      /^k6(\/.+)?$/,
      'https://jslib.k6.io/k6-utils/1.2.0/index.js',
    ],
  },
})
