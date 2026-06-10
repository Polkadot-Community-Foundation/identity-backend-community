import { describe } from '@effect/vitest'
import { ruleOfSchemas } from '@identity-backend/testing/schema'
import { Ss58String, Ss58StringFromHex } from '../mod.js'

describe('Rule of Schemas', () => {
  ruleOfSchemas('Ss58String', Ss58String)
  ruleOfSchemas('Ss58StringFromHex', Ss58StringFromHex)
})
