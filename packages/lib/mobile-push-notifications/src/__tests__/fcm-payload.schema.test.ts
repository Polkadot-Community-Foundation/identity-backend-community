import { describe } from '@effect/vitest'
import { ruleOfSchemas } from '@identity-backend/testing/schema'
import { FlatFcmPayload, StatementFcmPayloadWire } from '../fcm-payload.schema.js'

describe('Rule of Schemas', () => {
  ruleOfSchemas('StatementFcmPayloadWire', StatementFcmPayloadWire)
  ruleOfSchemas('FlatFcmPayload', FlatFcmPayload)
})
