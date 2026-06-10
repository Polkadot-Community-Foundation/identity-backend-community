import base from '@identity-backend/oxlint-config/base'
import { defineConfig } from 'oxlint'

export default defineConfig({
  extends: [base],

  overrides: [
    {
      files: ['*'],
      rules: {
        'typescript/consistent-type-assertions': ['warn', { assertionStyle: 'never' }],
      },
    },
    {
      files: ['*.config.ts', '**/*.test.ts', '**/*.spec.ts', '**/__tests__/**'],
      rules: {
        'typescript/consistent-type-assertions': ['warn', { assertionStyle: 'as' }],
      },
    },
    {
      files: ['**/*.integration.test.ts'],
      plugins: ['jest'],
      rules: {
        'jest/no-conditional-expect': 'error',
      },
    },
  ],
})
