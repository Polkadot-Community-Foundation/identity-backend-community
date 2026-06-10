import type { Statement, SubmitResult, TopicFilter } from '@novasamatech/sdk-statement'
import type { JsonRpcProvider } from '@polkadot-api/substrate-client'
import { Context, type Effect, Schema as S, type Stream } from 'effect'
import type { VerifiedStatement } from './types.js'

export type { Statement, SubmitResult, TopicFilter } from '@novasamatech/sdk-statement'
export { statementRejectionCounter } from './process-statement.js'
export { StatementHash, VerifiedStatement } from './types.js'

export class StatementStoreError extends S.TaggedError<StatementStoreError>()(
  'StatementStoreError',
  {
    reason: S.Literal('subscribe_failed', 'submit_failed', 'get_failed'),
    cause: S.optional(S.Unknown),
  },
) {}

export class StatementStoreConfig extends Context.Tag('@identity-backend/statement-store/Config')<
  StatementStoreConfig,
  { readonly provider: JsonRpcProvider }
>() {}

export namespace StatementStoreService {
  export interface Definition {
    readonly submit: (stmt: Statement) => Effect.Effect<SubmitResult, StatementStoreError>
    readonly subscribeStatements: (filter?: TopicFilter) => Stream.Stream<VerifiedStatement, StatementStoreError>
    readonly getStatements: (
      filter?: TopicFilter,
    ) => Effect.Effect<ReadonlyArray<VerifiedStatement>, StatementStoreError>
  }
}

export class StatementStoreService extends Context.Tag('@identity-backend/statement-store/StatementStoreService')<
  StatementStoreService,
  StatementStoreService.Definition
>() {}
