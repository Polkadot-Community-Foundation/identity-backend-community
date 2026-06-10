import { describe } from '@effect/vitest'
import { ruleOfSchemas } from '@identity-backend/testing/schema'
import { FlatApnsPayload, StatementApnsPayloadWire } from '../statement-payload.schema.js'

describe('Rule of Schemas', () => {
  ruleOfSchemas('StatementApnsPayloadWire', StatementApnsPayloadWire)
  ruleOfSchemas('FlatApnsPayload', FlatApnsPayload)
})
