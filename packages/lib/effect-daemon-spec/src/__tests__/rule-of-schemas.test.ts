import { describe } from '@identity-backend/effect-vitest-gherkin'
import { ruleOfSchemas } from '@identity-backend/testing/schema'
import {
  ChildPolicyConfig,
  IntensityConfig,
  LockPolicyConfig,
  SupervisorPolicyConfig,
  TickPolicyConfig,
} from '../daemon-policy.schema.js'
import { Continue, DecideInput, Exhausted, Restart, RestartStrategy } from '../internal/restart-decision.schema.js'

describe('Rule of Schemas', () => {
  ruleOfSchemas('IntensityConfig', IntensityConfig)
  ruleOfSchemas('ChildPolicyConfig', ChildPolicyConfig)
  ruleOfSchemas('SupervisorPolicyConfig', SupervisorPolicyConfig)
  ruleOfSchemas('LockPolicyConfig', LockPolicyConfig)
  ruleOfSchemas('TickPolicyConfig', TickPolicyConfig)
  ruleOfSchemas('RestartStrategy', RestartStrategy)
  ruleOfSchemas('Continue', Continue)
  ruleOfSchemas('Restart', Restart)
  ruleOfSchemas('Exhausted', Exhausted)
  ruleOfSchemas('DecideInput', DecideInput)
})
