import { TransactionSubmitError } from '#root/data/mod.js'
import type { TxBestBlockNotIncludedError, TxFinalizationError } from '#root/infrastructure/tx-event.io.js'
import { Either, Match, Option, Schema as S } from 'effect'
import type { TxFinalized } from 'polkadot-api'
import { type BatchOutcome, OtherFailure, ResourceExhausted, Succeeded } from './batch-backoff.schema.js'

export type KnownTxError = TransactionSubmitError | TxBestBlockNotIncludedError | TxFinalizationError

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

export const outcomeFromTxResult = (result: Either.Either<TxFinalized, KnownTxError>): BatchOutcome =>
  Either.match(result, {
    onLeft: (error) =>
      Match.value(error).pipe(
        Match.tag('TransactionSubmitError', (submit) => outcomeFromCause(submit.cause)),
        Match.orElse(() => new OtherFailure({})),
      ),
    onRight: (finalized) =>
      Match.value(finalized).pipe(
        Match.when({ ok: true }, () => new Succeeded({})),
        Match.when({ ok: false }, () => new OtherFailure({})),
        Match.exhaustive,
      ),
  })
