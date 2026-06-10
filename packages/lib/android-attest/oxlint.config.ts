import base from '@identity-backend/oxlint-config/base'
import { defineConfig } from 'oxlint'

export default defineConfig({
  extends: [base],
  overrides: [
    {
      files: ['*'],
      rules: {
        'typescript/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
      },
    },
  ],
})
