import { describe } from '@effect/vitest'
import { ruleOfSchemas } from '@identity-backend/testing/schema'

import {
  BlockCount,
  ByteSize,
  ConnectionCount,
  DeadlockCount,
  PgStatsSnapshot,
  SessionCount,
} from '../pg-stats.schema.js'

describe('pg-stats schemas', () => {
  ruleOfSchemas('SessionCount', SessionCount)
  ruleOfSchemas('ConnectionCount', ConnectionCount)
  ruleOfSchemas('BlockCount', BlockCount)
  ruleOfSchemas('DeadlockCount', DeadlockCount)
  ruleOfSchemas('ByteSize', ByteSize)
  ruleOfSchemas('PgStatsSnapshot', PgStatsSnapshot)
})
