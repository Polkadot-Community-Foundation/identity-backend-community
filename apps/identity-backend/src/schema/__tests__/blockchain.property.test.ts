import { describe } from '@effect/vitest'
import { ruleOfSchemas } from '@identity-backend/testing/schema'
import { Network } from '../blockchain.js'

describe('Blockchain Schema - Property-Based Tests', () => {
  ruleOfSchemas('Network', Network)
})
