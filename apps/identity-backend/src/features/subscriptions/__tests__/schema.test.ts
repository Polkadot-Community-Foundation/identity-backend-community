import { describe } from '@effect/vitest'
import { ruleOfSchemas } from '@identity-backend/testing/schema'
import { AddRulesRequestSchema, DeleteRulesRequestSchema, ReplaceRulesRequestSchema } from '../schema.js'

describe('Rule of Schemas', () => {
  ruleOfSchemas('AddRulesRequest', AddRulesRequestSchema)
  ruleOfSchemas('DeleteRulesRequest', DeleteRulesRequestSchema)
  ruleOfSchemas('ReplaceRulesRequest', ReplaceRulesRequestSchema)
})
