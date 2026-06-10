import { DefectReporter } from '#root/infrastructure/observability/mod.js'
import type { Network } from '#root/schema/blockchain'
import { LiteUsername } from '#root/schema/username.js'
import { DB } from '@identity-backend/db'
import { individualityUsernames } from '@identity-backend/db/Schema'
import { paseo_people, pop_testnet, previewnet_people } from '@identity-backend/descriptors'
import { Daemon } from '@identity-backend/effect-daemon-spec'
import { PolkadotClient } from '@identity-backend/json-rpc'
import { LegacyJSONRPCClient } from '@identity-backend/json-rpc'
import { PrefixedHex, Ss58String } from '@identity-backend/substrate-schema'
import { ss58Address, ss58Decode } from '@polkadot-labs/hdkd-helpers'
import { sql } from 'drizzle-orm'
import {
  Array,
  Cause,
  Chunk,
  Context,
  Duration,
  Effect,
  Either,
  HashSet,
  Layer,
  Match,
  Metric,
  MetricLabel,
  Option,
  ParseResult,
  pipe,
  Ref,
  Schedule,
  Schema as S,
  Stream,
} from 'effect'
import { getTypedCodecs } from 'polkadot-api'

import {
  individualityIndexerIndexedConsumerDecodeFailures,
  individualityIndexerRpcChangesMissing,
  individualityIndexerTickDuration,
  individualityIndexerTickFailuresCounter,
  individualityIndexerTickTotal,
} from '../individuality-indexer.metrics.js'

const RawRegistration = S.Struct({
  candidateAccountId: S.String,
  liteUsername: S.String,
  fullUsername: S.NullOr(S.String),
})

type RawRegistration = S.Schema.Type<typeof RawRegistration>

const ValidatedRegistration = S.compose(
  RawRegistration,
  S.Struct({
    candidateAccountId: S.String,
    liteUsername: LiteUsername,
    fullUsername: S.NullOr(S.String),
  }),
)

type ValidatedRegistration = S.Schema.Type<typeof ValidatedRegistration>

const RawConsumerStorageChange = S.Tuple(S.String, S.String)
const IndexedConsumer = S.Struct({
  keyHex: S.String,
  valueHex: S.String,
  candidateAccountId: Ss58String,
  liteUsername: S.String,
  fullUsername: S.NullOr(S.String),
})
type IndexedConsumer = S.Schema.Type<typeof IndexedConsumer>

type IndexedConsumerDecodeFailureReason = 'key' | 'value' | 'account_id' | 'registration'

const pathHead = (path: ParseResult.Path) =>
  Match.value(path).pipe(
    Match.when(
      (candidate: ParseResult.Path): candidate is readonly [PropertyKey, ...readonly PropertyKey[]] =>
        Array.isArray(candidate),
      (tuple): PropertyKey => tuple[0],
    ),
    Match.orElse((key): PropertyKey => key),
  )

const pointerPathToDecodeReason = (head: PropertyKey) =>
  Match.value(head).pipe(
    Match.when('keyHex', () => 'key' as const),
    Match.when('valueHex', () => 'value' as const),
    Match.when('candidateAccountId', () => 'account_id' as const),
    Match.orElse(() => 'registration' as const),
  )

const decodeFailureReasonFromParseIssue = (issue: ParseResult.ParseIssue): IndexedConsumerDecodeFailureReason =>
  Match.value(issue).pipe(
    Match.when(ParseResult.isComposite, (c) => {
      const head = globalThis.Array.isArray(c.issues) ? c.issues[0] : c.issues
      return head !== undefined ? decodeFailureReasonFromParseIssue(head) : ('registration' as const)
    }),
    Match.when(
      (i: ParseResult.ParseIssue): i is ParseResult.Pointer => i instanceof ParseResult.Pointer,
      (p) => pointerPathToDecodeReason(pathHead(p.path)),
    ),
    Match.orElse(() => 'registration' as const),
  )

interface ConsumersCodecs {
  readonly value: {
    readonly dec: (hex: string) => {
      lite_username: Uint8Array
      full_username: Uint8Array | undefined
    }
  }
  readonly keys: { readonly dec: (hex: string) => ReadonlyArray<unknown> }
  readonly ss58Prefix: number
}

const makeIndexedConsumerSchema = (codecs: ConsumersCodecs) =>
  S.transformOrFail(
    RawConsumerStorageChange,
    IndexedConsumer,
    {
      strict: true,
      decode: ([keyHex, valueHex], options, ast) => {
        const issues: ParseResult.ParseIssue[] = []
        const input: readonly [string, string] = [keyHex, valueHex]

        let decodedValue: ReturnType<ConsumersCodecs['value']['dec']> | undefined
        try {
          decodedValue = codecs.value.dec(valueHex)
        } catch (error) {
          issues.push(
            new ParseResult.Pointer(
              'valueHex',
              input,
              new ParseResult.Type(
                ast,
                valueHex,
                error instanceof Error ? error.message : 'failed to decode Consumers value',
              ),
            ),
          )
        }

        let keyArgs: ReadonlyArray<unknown> | undefined
        try {
          keyArgs = codecs.keys.dec(keyHex)
        } catch (error) {
          issues.push(
            new ParseResult.Pointer(
              'keyHex',
              input,
              new ParseResult.Type(
                ast,
                keyHex,
                error instanceof Error ? error.message : 'failed to decode Consumers key',
              ),
            ),
          )
        }

        let candidateAccountId: S.Schema.Type<typeof Ss58String> | undefined
        if (keyArgs) {
          const keyArg0 = keyArgs[0]
          if (keyArg0 === undefined) {
            issues.push(
              new ParseResult.Pointer(
                'candidateAccountId',
                input,
                new ParseResult.Type(ast, keyArgs, 'missing Consumers key account id'),
              ),
            )
          } else {
            let pubkey: Uint8Array | undefined
            try {
              if (typeof keyArg0 === 'string') {
                pubkey = ss58Decode(keyArg0)[0]
              } else if (keyArg0 instanceof Uint8Array) {
                pubkey = keyArg0
              } else {
                issues.push(
                  new ParseResult.Pointer(
                    'candidateAccountId',
                    input,
                    new ParseResult.Type(ast, keyArg0, 'unexpected Consumers key account id type'),
                  ),
                )
              }
            } catch {
              issues.push(
                new ParseResult.Pointer(
                  'candidateAccountId',
                  input,
                  new ParseResult.Type(ast, keyArg0, 'failed to derive account id pubkey from Consumers key'),
                ),
              )
            }
            if (pubkey !== undefined) {
              const normalizedCandidate = ss58Address(pubkey, codecs.ss58Prefix)
              const accountIdDecoded = ParseResult.decodeUnknownEither(Ss58String)(normalizedCandidate, options)
              if (Either.isLeft(accountIdDecoded)) {
                issues.push(
                  new ParseResult.Pointer(
                    'candidateAccountId',
                    input,
                    accountIdDecoded.left,
                  ),
                )
              } else {
                candidateAccountId = accountIdDecoded.right
              }
            }
          }
        }

        if (issues.length > 0 || !decodedValue || !candidateAccountId) {
          const firstIssue = issues[0]
          if (firstIssue === undefined) {
            return ParseResult.fail(
              new ParseResult.Type(ast, input, 'failed to decode storage change'),
            )
          }
          return ParseResult.fail(
            new ParseResult.Composite(ast, input, [firstIssue, ...issues.slice(1)]),
          )
        }

        return ParseResult.succeed(
          {
            keyHex,
            valueHex,
            candidateAccountId,
            liteUsername: new TextDecoder().decode(decodedValue.lite_username),
            fullUsername: decodedValue.full_username
              ? new TextDecoder().decode(decodedValue.full_username)
              : null,
          } satisfies IndexedConsumer,
        )
      },
      encode: ({ keyHex, valueHex }) => ParseResult.succeed([keyHex, valueHex]),
    },
  )

interface DecodeFailure {
  readonly candidateAccountId: string
  readonly liteUsername: string
}

interface ClassifyRegistrationsInput {
  readonly seen: HashSet.HashSet<string>
  readonly entries: readonly RawRegistration[]
}

const classifyRegistrations = (input: ClassifyRegistrationsInput) => {
  const { seen, entries } = input
  const valid: ValidatedRegistration[] = []
  const invalid: DecodeFailure[] = []
  const newKeys: string[] = []
  const batchSeen = new Set<string>()

  for (const entry of entries) {
    const registrationKey = `${entry.candidateAccountId}:${entry.liteUsername}`
    if (batchSeen.has(registrationKey)) continue
    batchSeen.add(registrationKey)
    if (HashSet.has(seen, registrationKey)) continue

    const decoded = S.decodeUnknownEither(ValidatedRegistration)(entry)
    if (Either.isRight(decoded)) {
      valid.push(decoded.right)
      newKeys.push(registrationKey)
    } else {
      invalid.push({ candidateAccountId: entry.candidateAccountId, liteUsername: entry.liteUsername })
      newKeys.push(registrationKey)
    }
  }

  return {
    valid,
    invalid,
    newKeys: HashSet.fromIterable(newKeys),
  }
}

class IndexerTickFailure extends S.TaggedError<IndexerTickFailure>()('IndexerTickFailure', {
  reason: S.Literal('rpc', 'db'),
  cause: S.Unknown,
}) {}

const ConsumersPaginationStateTypeId: unique symbol = Symbol.for(
  '@identity-backend/individuality-indexer/ConsumersPaginationState',
)
type ConsumersPaginationStateTypeId = typeof ConsumersPaginationStateTypeId

class ConsumersPageFirst extends S.TaggedClass<ConsumersPageFirst>()('ConsumersPageFirst', {}) {
  readonly [ConsumersPaginationStateTypeId] = ConsumersPaginationStateTypeId
}

class ConsumersPageNext extends S.TaggedClass<ConsumersPageNext>()('ConsumersPageNext', { afterKey: PrefixedHex }) {
  readonly [ConsumersPaginationStateTypeId] = ConsumersPaginationStateTypeId
}

class ConsumersPageDone extends S.TaggedClass<ConsumersPageDone>()('ConsumersPageDone', {}) {
  readonly [ConsumersPaginationStateTypeId] = ConsumersPaginationStateTypeId
}

type ConsumersPaginationCursor = ConsumersPageFirst | ConsumersPageNext
const ConsumersPaginationState = S.Union(ConsumersPageFirst, ConsumersPageNext, ConsumersPageDone)
type ConsumersPaginationState = typeof ConsumersPaginationState.Type

const IndexerPageFoldStateTypeId: unique symbol = Symbol.for(
  '@identity-backend/individuality-indexer/IndexerPageFoldState',
)
type IndexerPageFoldStateTypeId = typeof IndexerPageFoldStateTypeId

class IndexerPageFoldState extends S.Class<IndexerPageFoldState>('IndexerPageFoldState')({
  pagesProcessed: S.NonNegativeInt,
  totalEntries: S.NonNegativeInt,
  validRecords: S.NonNegativeInt,
  invalidRecords: S.NonNegativeInt,
}) {
  readonly [IndexerPageFoldStateTypeId] = IndexerPageFoldStateTypeId
}

type FetchConsumersPageResult = readonly [
  Chunk.Chunk<RawRegistration>,
  ConsumersPaginationState,
]

export class IndividualityIndexerConfig extends Context.Tag('IndividualityIndexerConfig')<IndividualityIndexerConfig, {
  readonly network: Network
}>() {}

export class IndividualityIndexerRuntimeConfig extends Context.Reference<IndividualityIndexerRuntimeConfig>()(
  'IndividualityIndexerRuntimeConfig',
  {
    defaultValue: () => ({
      storagePageSize: 1000,
      insertBatchSize: 512,
      syncInterval: Duration.minutes(5),
      tickTimeout: Duration.minutes(5),
      decodeFailureLogSampleCap: 10,
    }),
  },
) {}

interface IndividualityIndexerWorkSpec {
  readonly client: PolkadotClient.PolkadotClientWithProvider
}

export const make = Effect.fn(function*(spec: IndividualityIndexerWorkSpec) {
  const config = yield* IndividualityIndexerRuntimeConfig
  const { network } = yield* IndividualityIndexerConfig
  const db = yield* DB
  const defectReporter = yield* DefectReporter
  const { client } = spec
  const legacyRpc = LegacyJSONRPCClient.make(client)

  const [metadataBuilders, substrateBindings, polkadotUtils] = yield* Effect.promise(() =>
    Promise.all([
      import('@polkadot-api/metadata-builders'),
      import('@polkadot-api/substrate-bindings'),
      import('polkadot-api/utils'),
    ])
  )
  const { getDynamicBuilder, getLookupFn } = metadataBuilders
  const { decAnyMetadata, Twox128, unifyMetadata } = substrateBindings
  const { mergeUint8, toHex } = polkadotUtils
  const consumersPrefixHex = yield* S.decode(PrefixedHex)(toHex(
    mergeUint8([
      Twox128(new TextEncoder().encode('Resources')),
      Twox128(new TextEncoder().encode('Consumers')),
    ]),
  )).pipe(Effect.orDie)

  const descriptor = Match.value(network).pipe(
    Match.when('paseo', () => paseo_people),
    Match.when('polkadot', () => previewnet_people),
    Match.when('westend2', () => pop_testnet),
    Match.exhaustive,
  )
  const metadataBytes = yield* Effect.promise(() => descriptor.getMetadata())
  const metadata = unifyMetadata(decAnyMetadata(metadataBytes))
  const lookup = getLookupFn(metadata)
  const { buildStorage } = getDynamicBuilder(lookup)

  const codecs = yield* Effect.promise(() => getTypedCodecs(descriptor))
  const consumersCodec = codecs.query.Resources.Consumers
  const consumersStorageKeysCodec = buildStorage('Resources', 'Consumers').keys
  const typedApi = client.getTypedApi(descriptor)
  const ss58Prefix = yield* Effect.promise(() => typedApi.constants.System.SS58Prefix())
  const decodeIndexedConsumer = S.decodeUnknownEither(
    makeIndexedConsumerSchema({
      value: consumersCodec.value,
      keys: consumersStorageKeysCodec,
      ss58Prefix,
    }),
  )

  const upsertPage = (records: readonly ValidatedRegistration[]) =>
    pipe(
      Array.chunksOf(records, config.insertBatchSize),
      Effect.forEach((batch) =>
        pipe(
          Effect.gen(function*() {
            if (batch.length === 0) return
            const rows = batch.map((r) => ({
              username: r.liteUsername.username,
              digits: r.liteUsername.digits,
              fullUsername: r.fullUsername,
              network,
              candidateAccountId: r.candidateAccountId,
              candidateSignature: '',
              ringVrfKey: '',
              proofOfOwnership: '',
              consumerRegistrationSignature: '',
              identifierKey: '',
              status: 'ASSIGNED' as const,
              source: 'EXTERNAL' as const,
            }))
            yield* Effect.tryPromise(() =>
              db.insert(individualityUsernames).values(rows).onConflictDoUpdate({
                target: [
                  individualityUsernames.username,
                  individualityUsernames.network,
                  individualityUsernames.digits,
                ],
                set: {
                  candidateAccountId: sql`excluded.candidate_account_id`,
                  fullUsername: sql`excluded.full_username`,
                  status: sql`excluded.status`,
                  source: sql`excluded.source`,
                },
              })
            )
          }),
          Effect.retry({
            schedule: Schedule.intersect(
              Schedule.exponential(Duration.millis(100)),
              Schedule.recurs(3),
            ),
          }),
          Effect.tapError((_error) =>
            Effect.flatMap(Schedule.CurrentIterationMetadata, (meta) =>
              Effect.gen(function*() {
                const isLastAttempt = meta.recurrence >= 3
                yield* Effect.annotateCurrentSpan({
                  'retry.attempt': meta.recurrence + 1,
                  'retry.delay_ms': Duration.toMillis(meta.elapsedSincePrevious),
                })
                if (isLastAttempt) {
                  yield* Effect.logError('individuality_indexer db upsert failed after max retries', {
                    retry_attempt: meta.recurrence + 1,
                    batch_size: batch.length,
                  })
                }
              }))
          ),
          Effect.catchAll((cause) => Effect.fail(new IndexerTickFailure({ reason: 'db', cause }))),
        )
      ),
      Effect.asVoid,
    )

  const work = Effect.gen(function*() {
    yield* Metric.increment(
      Metric.taggedWithLabels(individualityIndexerTickTotal, [MetricLabel.make('network', network)]),
    )

    const decodeSampleCountRef = yield* Ref.make(0)
    const seenRef = yield* Ref.make(HashSet.empty<string>())
    const decodeFailureTotalsRef = yield* Ref.make(
      {
        key: 0,
        value: 0,
        account_id: 0,
        registration: 0,
      } satisfies Record<IndexedConsumerDecodeFailureReason, number>,
    )

    const handleDecodeRowFailure = (
      { keyHex, valueHex, issue }: {
        readonly keyHex: string
        readonly valueHex: string
        readonly issue: ParseResult.ParseError
      },
    ) => {
      const reason = decodeFailureReasonFromParseIssue(issue.issue)
      return pipe(
        Metric.increment(
          Metric.taggedWithLabels(individualityIndexerIndexedConsumerDecodeFailures, [
            MetricLabel.make('reason', reason),
            MetricLabel.make('network', network),
          ]),
        ),
        Effect.zipRight(
          Ref.update(decodeFailureTotalsRef, (totals) => ({
            ...totals,
            [reason]: totals[reason] + 1,
          })),
        ),
        Effect.zipRight(
          Ref.modify(
            decodeSampleCountRef,
            (n): readonly [boolean, number] => n < config.decodeFailureLogSampleCap ? [true, n + 1] : [false, n],
          ),
        ),
        Effect.tap((shouldLog) =>
          shouldLog
            ? Effect.logWarning('individuality_indexer consumer decode row failed', {
              decode_failure_reason: reason,
              key_hex: keyHex,
              value_hex_preview: valueHex.slice(0, 66),
            })
            : Effect.void
        ),
        Effect.asVoid,
      )
    }

    yield* Effect.gen(function*() {
      const finalizedHash = yield* legacyRpc.getFinalizedHead().pipe(
        Effect.mapError((cause) => new IndexerTickFailure({ reason: 'rpc', cause: cause as unknown })),
      )

      yield* Effect.annotateCurrentSpan({
        'ledger.block.hash': finalizedHash,
      })

      const fetchConsumersPage = (
        state: ConsumersPaginationCursor,
      ): Effect.Effect<FetchConsumersPageResult, IndexerTickFailure> =>
        Effect.gen(function*() {
          const afterKey = Match.value(state).pipe(
            Match.when({ _tag: 'ConsumersPageNext' }, (s) => s.afterKey),
            Match.orElse(() => undefined),
          )

          const keys = yield* legacyRpc.getKeysPaged(
            consumersPrefixHex,
            {
              pageSize: config.storagePageSize,
              atBlockHash: finalizedHash,
              ...(afterKey !== undefined ? { startKey: afterKey } : {}),
            },
          ).pipe(
            Effect.mapError((cause) => new IndexerTickFailure({ reason: 'rpc', cause })),
          )

          yield* Effect.annotateCurrentSpan({
            'indexer.keys_returned': keys.length,
          })

          if (keys.length === 0) {
            return [Chunk.empty<RawRegistration>(), new ConsumersPageDone()] as const
          }

          const changes = yield* legacyRpc.queryStorageAt(
            keys,
            { atBlockHash: finalizedHash },
          ).pipe(
            Effect.mapError((cause) => new IndexerTickFailure({ reason: 'rpc', cause })),
          )

          const nonNullChanges = pipe(
            changes,
            Array.flatMap((changeSet) => changeSet.changes),
            Array.filterMap((row) => row[1] === null ? Option.none() : Option.some([row[0], row[1]] as const)),
          )

          const changesRows = nonNullChanges.length

          yield* Effect.annotateCurrentSpan({
            'indexer.changes_returned': changesRows,
          })

          if (changesRows < keys.length) {
            yield* Effect.logWarning('individuality_indexer state_queryStorageAt returned fewer value rows than keys', {
              keys_requested: keys.length,
              changes_rows: changesRows,
              ledger_block_hash: finalizedHash,
            })
            yield* Metric.increment(
              Metric.taggedWithLabels(individualityIndexerRpcChangesMissing, [MetricLabel.make('network', network)]),
            )
          }

          const entriesChunk = yield* pipe(
            nonNullChanges,
            Effect.forEach(
              ([keyHex, valueHex]) =>
                pipe(
                  decodeIndexedConsumer([keyHex, valueHex]),
                  Either.match({
                    onLeft: (issue) =>
                      pipe(
                        handleDecodeRowFailure({ keyHex, valueHex, issue }),
                        Effect.as(Option.none()),
                      ),
                    onRight: (decoded) =>
                      Effect.succeed(
                        Option.some({
                          candidateAccountId: decoded.candidateAccountId,
                          liteUsername: decoded.liteUsername,
                          fullUsername: decoded.fullUsername,
                        }),
                      ),
                  }),
                ),
            ),
            Effect.map((rows) =>
              Chunk.fromIterable(
                pipe(
                  rows,
                  Array.filter(Option.isSome),
                  Array.map((some) => some.value),
                ),
              )
            ),
          )

          const nextPage = keys.length >= config.storagePageSize
            ? new ConsumersPageNext({ afterKey: keys[keys.length - 1]! })
            : new ConsumersPageDone()

          return [entriesChunk, nextPage] as const
        })

      const counters = yield* pipe(
        Stream.paginateChunkEffect<ConsumersPaginationCursor, RawRegistration, IndexerTickFailure, never>(
          new ConsumersPageFirst(),
          (state) =>
            pipe(
              fetchConsumersPage(state),
              Effect.map(([chunk, nextState]) =>
                [
                  chunk,
                  Match.value(nextState).pipe(
                    Match.tag('ConsumersPageFirst', (s) => Option.some(s)),
                    Match.tag('ConsumersPageNext', (s) => Option.some(s)),
                    Match.tag('ConsumersPageDone', () => Option.none()),
                    Match.exhaustive,
                  ),
                ] as const
              ),
            ),
        ),
        Stream.chunks,
        Stream.runFoldEffect(
          IndexerPageFoldState.make({
            pagesProcessed: 0,
            totalEntries: 0,
            validRecords: 0,
            invalidRecords: 0,
          }),
          (acc, pageChunk) =>
            Effect.gen(function*() {
              const entries = Chunk.toReadonlyArray(pageChunk)
              const seen = yield* Ref.get(seenRef)
              const classified = classifyRegistrations({ seen, entries })
              const seenNext = HashSet.union(seen, classified.newKeys)
              yield* Ref.set(seenRef, seenNext)

              yield* Effect.forEach(
                classified.invalid,
                (failure) =>
                  pipe(
                    Effect.logWarning('Failed to decode person registration record', {
                      candidate_account_id: failure.candidateAccountId,
                      lite_username: failure.liteUsername,
                    }),
                    Effect.tap(() =>
                      Metric.increment(
                        Metric.taggedWithLabels(individualityIndexerIndexedConsumerDecodeFailures, [
                          MetricLabel.make('reason', 'registration'),
                          MetricLabel.make('network', network),
                        ]),
                      )
                    ),
                    Effect.tap(() =>
                      Ref.update(decodeFailureTotalsRef, (tot) => ({
                        ...tot,
                        registration: tot.registration + 1,
                      }))
                    ),
                  ),
              )

              if (classified.valid.length > 0) {
                yield* upsertPage(classified.valid)
              }

              return IndexerPageFoldState.make({
                pagesProcessed: acc.pagesProcessed + 1,
                totalEntries: acc.totalEntries + entries.length,
                validRecords: acc.validRecords + classified.valid.length,
                invalidRecords: acc.invalidRecords + classified.invalid.length,
              })
            }),
        ),
      )

      const decodeTotals = yield* Ref.get(decodeFailureTotalsRef)
      const totalDecodeFailures = decodeTotals.key + decodeTotals.value + decodeTotals.account_id +
        decodeTotals.registration

      if (totalDecodeFailures > 0) {
        const decodeSampleLogged = yield* Ref.get(decodeSampleCountRef)
        yield* Effect.logWarning('individuality_indexer consumer decode failures summary', {
          decode_failures_total: totalDecodeFailures,
          decode_failures_sample_logged: decodeSampleLogged,
          decode_failures_by_reason: decodeTotals,
        })
      }

      yield* Effect.annotateCurrentSpan({
        'indexer.pages_processed': counters.pagesProcessed,
        'indexer.total_entries': counters.totalEntries,
        'indexer.valid_records': counters.validRecords,
        'indexer.invalid_records': counters.invalidRecords,
      })
    }).pipe(
      Effect.timeoutFail({
        duration: config.tickTimeout,
        onTimeout: () => new IndexerTickFailure({ reason: 'rpc', cause: 'timeout' }),
      }),
      Effect.catchTag('IndexerTickFailure', (error) =>
        Effect.gen(function*() {
          yield* Metric.increment(
            Metric.taggedWithLabels(individualityIndexerTickFailuresCounter, [
              MetricLabel.make('reason', error.reason),
              MetricLabel.make('network', network),
            ]),
          )
          yield* defectReporter.captureException(Cause.fail(error))
        })),
    )
  })

  return Daemon.poll({
    name: 'individuality-indexer',
    work: work.pipe(Effect.provide(Layer.succeed(DB, db))),
    interval: config.syncInterval,
    tick: {
      spanName: 'individuality_indexer.daemon_tick',
      tickTimeout: config.tickTimeout,
      startLogLevel: 'info',
    },
    tickHooks: {
      spanAttributes: Effect.succeed({
        'indexer.network': network,
        'indexer.storage_page_size': config.storagePageSize,
        'indexer.insert_batch_size': config.insertBatchSize,
        'indexer.sync_interval_s': Duration.toSeconds(config.syncInterval),
      }),
      trackDuration: Metric.taggedWithLabels(individualityIndexerTickDuration, [
        MetricLabel.make('network', network),
      ]),
    },
    lock: { mode: 'none' },
  })
})

// Stryker disable all
if (import.meta.vitest) {
  const validEntry: RawRegistration = {
    candidateAccountId: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY',
    liteUsername: 'alice.42',
    fullUsername: 'alice_smith',
  }

  const invalidEntry: RawRegistration = {
    candidateAccountId: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY',
    liteUsername: 'invalid-username',
    fullUsername: null,
  }

  const { describe, it, expect } = await import('@effect/vitest')

  describe('classifyRegistrations', () => {
    it.prop(
      '∀x_ReturnAllValidAllEntriesValid_=x',
      [S.Array(RawRegistration)],
      ([rawEntries]) => {
        const seen = HashSet.empty<string>()
        const result = classifyRegistrations({ seen, entries: rawEntries })

        const uniqueKeys = HashSet.fromIterable(
          rawEntries.map((e) => `${e.candidateAccountId}:${e.liteUsername}`),
        )

        const batchSeen = new Set<string>()
        let expectedValid = 0
        for (const entry of rawEntries) {
          const key = `${entry.candidateAccountId}:${entry.liteUsername}`
          if (batchSeen.has(key)) continue
          batchSeen.add(key)
          if (Either.isRight(S.decodeUnknownEither(ValidatedRegistration)(entry))) {
            expectedValid++
          }
        }

        return (
          result.valid.length === expectedValid &&
          result.invalid.length === HashSet.size(uniqueKeys) - expectedValid &&
          HashSet.size(result.newKeys) === HashSet.size(uniqueKeys)
        )
      },
    )

    it.prop(
      '∀x_ReturnInvalidEntriesInvalid_=x',
      [S.Array(RawRegistration)],
      ([rawEntries]) => {
        const seen = HashSet.empty<string>()
        const result = classifyRegistrations({ seen, entries: rawEntries })

        const uniqueKeys = HashSet.fromIterable(
          rawEntries.map((e) => `${e.candidateAccountId}:${e.liteUsername}`),
        )

        return (
          result.valid.length + result.invalid.length === HashSet.size(uniqueKeys) &&
          result.valid.length + result.invalid.length === HashSet.size(result.newKeys)
        )
      },
    )

    it('Should_DeduplicateSeenEntries_When_AlreadyProcessed', () => {
      const seen = HashSet.make(`${validEntry.candidateAccountId}:${validEntry.liteUsername}`)
      const result = classifyRegistrations({ seen, entries: [validEntry] })

      expect(result.valid).toHaveLength(0)
      expect(result.invalid).toHaveLength(0)
      expect(HashSet.size(result.newKeys)).toBe(0)
    })

    it('Should_CollectNewSeenKeys_When_FailuresOccur', () => {
      const seen = HashSet.empty<string>()
      const result = classifyRegistrations({ seen, entries: [invalidEntry] })

      expect(result.invalid).toHaveLength(1)
      expect(HashSet.size(result.newKeys)).toBe(1)
      expect(HashSet.has(result.newKeys, `${invalidEntry.candidateAccountId}:${invalidEntry.liteUsername}`)).toBe(true)
    })

    it.prop(
      '∀x_BeIdempotentSameEntriesSeenTwice_=x',
      [S.Array(RawRegistration)],
      ([rawEntries]) => {
        const seen = HashSet.empty<string>()
        const first = classifyRegistrations({ seen, entries: rawEntries })
        const second = classifyRegistrations({ seen: HashSet.union(seen, first.newKeys), entries: rawEntries })

        return second.invalid.length === 0 && second.valid.length === 0
      },
    )
  })
}
