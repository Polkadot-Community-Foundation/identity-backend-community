import base from '@identity-backend/oxlint-config/base'
import { defineConfig } from 'oxlint'

export default defineConfig({
  extends: [base],
  ignorePatterns: ['infra/**', 'sst.config.ts'],
})
