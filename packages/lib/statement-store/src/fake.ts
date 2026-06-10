import type { Statement as SdkStatement, SubmitResult, TopicFilter } from '@novasamatech/sdk-statement'
import { statementCodec } from '@novasamatech/sdk-statement'
import { Chunk, Clock, Effect, Either, HashMap, Layer, Option, PubSub, Ref, Stream } from 'effect'
import { StatementStoreService } from './index.js'
import {
  isExpiredAt,
  processStatement,
  type ProcessStatementRejectionReason,
  verifyStream,
} from './process-statement.js'

export {
  StatementHash,
  StatementStoreConfig,
  StatementStoreError,
  StatementStoreService,
  VerifiedStatement,
} from './index.js'

type ChannelRecord = {
  readonly statementHash: string
  readonly expiry: bigint
}

const make = Effect.gen(function*() {
  const raws = yield* Ref.make<ReadonlyArray<SdkStatement>>([])
  const channelIndex = yield* Ref.make(HashMap.empty<string, ChannelRecord>())
  const hub = yield* PubSub.unbounded<SdkStatement>()

  const toInvalidResult = (reason: ProcessStatementRejectionReason): SubmitResult => {
    switch (reason) {
      case 'no_proof':
        return { status: 'invalid', reason: 'noProof' }
      default:
        return { status: 'invalid', reason: 'badProof' }
    }
  }

  const matchesFilter = (statement: SdkStatement, filter: TopicFilter): boolean => {
    if (filter === 'any') return true
    const topics = statement.topics ?? []
    if ('matchAll' in filter) return filter.matchAll.every((topic) => topics.includes(topic))
    return filter.matchAny.some((topic) => topics.includes(topic))
  }

  const canonicalStatement = (stmt: SdkStatement): SdkStatement => statementCodec.dec(statementCodec.enc(stmt))

  const submit: StatementStoreService.Definition['submit'] = (stmt) =>
    Effect.gen(function*() {
      const canonical = canonicalStatement(stmt)

      if (canonical.expiry === undefined) {
        return { status: 'invalid', reason: 'alreadyExpired' }
      }

      const verdict = processStatement(canonical)
      if (Either.isLeft(verdict)) {
        return toInvalidResult(verdict.left)
      }
      const verified = verdict.right
      const now = yield* Clock.currentTimeMillis
      if (verified.expiry !== null && isExpiredAt(verified.expiry, now)) {
        return { status: 'invalid', reason: 'alreadyExpired' }
      }

      const channel = verified.channel
      if (channel !== null) {
        const key = `${verified.proofSigner}:${channel}`
        const submittedExpiry = verified.expiry ?? 0n
        const map = yield* Ref.get(channelIndex)
        const existing = HashMap.get(map, key)
        if (Option.isSome(existing)) {
          const prev = existing.value
          if (submittedExpiry <= prev.expiry) {
            return {
              status: 'rejected',
              reason: 'channelPriorityTooLow',
              submitted_expiry: submittedExpiry,
              min_expiry: prev.expiry,
            }
          }
        }
        yield* Ref.update(channelIndex, (m) =>
          HashMap.set(m, key, { statementHash: verified.statementHash, expiry: submittedExpiry }))
      }

      yield* Ref.update(raws, (ss) => [...ss, canonical])
      yield* PubSub.publish(hub, canonical)
      return { status: 'new' }
    })

  const subscribeStatements: StatementStoreService.Definition['subscribeStatements'] = (filter = 'any') =>
    Stream.merge(
      Stream.fromEffect(Ref.get(raws)).pipe(Stream.flatMap(Stream.fromIterable)),
      Stream.fromPubSub(hub),
    ).pipe(
      Stream.filter((statement) => matchesFilter(statement, filter)),
      verifyStream(),
    )

  const getStatements: StatementStoreService.Definition['getStatements'] = (filter = 'any') =>
    Ref.get(raws).pipe(
      Effect.flatMap((rs) =>
        Stream.fromIterable(rs).pipe(
          Stream.filter((statement) => matchesFilter(statement, filter)),
          verifyStream(),
          Stream.runCollect,
          Effect.map(Chunk.toReadonlyArray),
        )
      ),
    )

  return StatementStoreService.of({ submit, subscribeStatements, getStatements })
})

export const StatementStoreFake: Layer.Layer<StatementStoreService> = Layer.effect(StatementStoreService, make)
