import { describe } from '@effect/vitest'
import { ruleOfSchemas } from '@identity-backend/testing/schema'
import { PrivateKey, PublicKey } from '../types.js'

describe('Rule of Schemas', () => {
  ruleOfSchemas('PublicKey', PublicKey)
  ruleOfSchemas('PrivateKey', PrivateKey)
})
