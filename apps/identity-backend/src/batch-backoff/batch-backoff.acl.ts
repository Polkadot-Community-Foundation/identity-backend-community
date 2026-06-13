import { TransactionSubmitError } from '#root/data/mod.js'
import type { FinalizedTransaction } from '#root/infrastructure/adapters/blockchain/finalized-transaction.schema.js'
import type {
  TxBestBlockNotIncludedError,
  TxFinalizationError,
  TxInclusionTimeoutError,
} from '@identity-backend/tx-events'
import { Either, Match, Option, Schema as S } from 'effect'
import { type BatchOutcome, OtherFailure, ResourceExhausted, Succeeded } from './batch-backoff.schema.js'

export type KnownTxError =
  | TransactionSubmitError
  | TxBestBlockNotIncludedError
  | TxFinalizationError
  | TxInclusionTimeoutError

const ValidityExhaustion = S.Struct({
  type: S.Literal('Invalid'),
  value: S.Struct({ type: S.Literal('ExhaustsResources') }),
})

type ExhaustionEnvelope =
  | { readonly error: S.Schema.Type<typeof ValidityExhaustion> }
  | { readonly cause: ExhaustionEnvelope }

const ExhaustionEnvelope: S.Schema<ExhaustionEnvelope> = S.suspend(() =>
  S.Union(
    S.Struct({ error: ValidityExhaustion }),
    S.Struct({ cause: ExhaustionEnvelope }),
  )
)

const decodeExhaustion = S.decodeUnknownOption(ExhaustionEnvelope)

export const outcomeFromCause = (cause: unknown): BatchOutcome =>
  Option.match(decodeExhaustion(cause), {
    onNone: () => new OtherFailure({}),
    onSome: () => new ResourceExhausted({}),
  })

export const outcomeFromTxResult = (result: Either.Either<FinalizedTransaction, KnownTxError>): BatchOutcome =>
  Either.match(result, {
    onLeft: (error) =>
      Match.value(error).pipe(
        Match.tag('TransactionSubmitError', (submit) => outcomeFromCause(submit.cause)),
        Match.orElse(() => new OtherFailure({})),
      ),
    onRight: (finalized) =>
      Match.value(finalized).pipe(
        Match.tag('TransactionIncluded', () => new Succeeded({})),
        Match.tag('TransactionReverted', () => new OtherFailure({})),
        Match.exhaustive,
      ),
  })
