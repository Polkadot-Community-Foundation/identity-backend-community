import { describe } from '@effect/vitest'
import { ruleOfSchemas } from '@identity-backend/testing/schema'
import { RpcU64Schema } from '../rpc-u64.schema.js'
import { StatementSubmitRpcSchema } from '../submit-result-rpc.js'

describe('Rule of Schemas', () => {
  ruleOfSchemas('RpcU64Schema', RpcU64Schema)
  ruleOfSchemas('StatementSubmitRpcSchema', StatementSubmitRpcSchema)
})
