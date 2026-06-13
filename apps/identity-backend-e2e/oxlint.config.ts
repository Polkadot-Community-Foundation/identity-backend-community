import base from '@identity-backend/oxlint-config/base'
import { defineConfig } from 'oxlint'

export default defineConfig({
  extends: [base],
  rules: {
    '@identity-backend/oxlint-plugin/no-bodyless-status-assertion': 'error',
  },
})
