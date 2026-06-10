import { describe } from '@effect/vitest'
import { ruleOfSchemas } from '@identity-backend/testing/schema'
import { BatchOutcome, BatchSize, BatchSizePolicy, DecreaseFactor, IncreaseStep } from '../batch-backoff.schema.js'

describe('batch-backoff schemas', () => {
  ruleOfSchemas('BatchSize', BatchSize)
  ruleOfSchemas('DecreaseFactor', DecreaseFactor)
  ruleOfSchemas('IncreaseStep', IncreaseStep)
  ruleOfSchemas('BatchSizePolicy', BatchSizePolicy)
  ruleOfSchemas('BatchOutcome', BatchOutcome)
})
