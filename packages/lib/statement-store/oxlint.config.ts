import base from '@identity-backend/oxlint-config/base'
import { defineConfig } from 'oxlint'

export default defineConfig({
  extends: [base],
  rules: {
    'no-unneeded-ternary': 'error',
    'typescript/consistent-type-assertions': ['error', { assertionStyle: 'as' }],
  },
  overrides: [
    {
      files: ['src/**/*.ts'],
      rules: {
        'no-ternary': 'error',
      },
    },
    {
      files: ['**/*.test.ts', '**/*.spec.ts', 'test/**/*.ts', 'vitest.config.ts'],
      rules: {
        'no-ternary': 'off',
        'typescript/consistent-type-assertions': 'off',
      },
    },
  ],
})
