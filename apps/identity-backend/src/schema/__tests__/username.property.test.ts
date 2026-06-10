import { describe } from '@effect/vitest'
import { ruleOfSchemas } from '@identity-backend/testing/schema'
import { BaseUsername, LiteUsername, UsernameDigits } from '../username.js'

describe('Username Schema - Property-Based Tests', () => {
  ruleOfSchemas('BaseUsername', BaseUsername)
  ruleOfSchemas('UsernameDigits', UsernameDigits)
  ruleOfSchemas('LiteUsername', LiteUsername)
})
