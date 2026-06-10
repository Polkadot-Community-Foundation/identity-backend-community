import { describe } from '@effect/vitest'
import { ruleOfSchemas } from '@identity-backend/testing/schema'
import {
  Deliver,
  DeliveryChannel,
  DeliveryPlan,
  NoMatches,
  NotifyType,
  PipelineRateLimitConfig,
  PipelineRateState,
  ProcessStatementCommand,
  PublicKey,
  PushRecord,
  RateLimitRecord,
  RuleId,
  Skip,
  StatementHash,
  Subscription,
  SubscriptionId,
  SubscriptionRule,
  Topic,
  VerifiedStatement,
} from '../types.js'

describe('Rule of Schemas', () => {
  ruleOfSchemas('SubscriptionId', SubscriptionId)
  ruleOfSchemas('RuleId', RuleId)
  ruleOfSchemas('PublicKey', PublicKey)
  ruleOfSchemas('Topic', Topic)
  ruleOfSchemas('StatementHash', StatementHash)
  ruleOfSchemas('NotifyType', NotifyType)
  ruleOfSchemas('DeliveryChannel', DeliveryChannel)
  ruleOfSchemas('Subscription', Subscription)
  ruleOfSchemas('SubscriptionRule', SubscriptionRule)
  ruleOfSchemas('PushRecord', PushRecord)
  ruleOfSchemas('RateLimitRecord', RateLimitRecord)
  ruleOfSchemas('DeliveryPlan', DeliveryPlan)
  ruleOfSchemas('NoMatches', NoMatches)
  ruleOfSchemas('Deliver', Deliver)
  ruleOfSchemas('Skip', Skip)
  ruleOfSchemas('VerifiedStatement', VerifiedStatement)
  ruleOfSchemas('PipelineRateState', PipelineRateState)
  ruleOfSchemas('PipelineRateLimitConfig', PipelineRateLimitConfig)
  ruleOfSchemas('ProcessStatementCommand', ProcessStatementCommand)
})
