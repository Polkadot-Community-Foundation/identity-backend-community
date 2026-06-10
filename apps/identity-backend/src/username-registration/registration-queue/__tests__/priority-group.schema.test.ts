import { describe } from '@effect/vitest'
import { ruleOfSchemas } from '@identity-backend/testing/schema'
import { QueuePriorityRules } from '../priority-group.schema.js'

describe('QueuePriorityRules schema', () => {
  ruleOfSchemas('QueuePriorityRules', QueuePriorityRules)
})
