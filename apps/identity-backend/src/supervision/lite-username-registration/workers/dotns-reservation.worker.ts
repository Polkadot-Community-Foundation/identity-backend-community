import { outcomeFromTxResult } from '#root/batch-backoff/batch-backoff.acl.js'
import { recordBatchOutcome, RecordBatchOutcomeDeps } from '#root/batch-backoff/batch-backoff.executor.js'
import { type BatchSize, BatchSizePolicy } from '#root/batch-backoff/batch-backoff.schema.js'
import { TransactionSubmitError } from '#root/data/mod.js'
import { schema } from '#root/db/mod.js'
import type { IndividualityUsername } from '#root/db/schema.js'
import {
  type AhItemFailedEvFilter,
  DotnsGatewayAPI,
} from '#root/infrastructure/adapters/blockchain/dotns-gateway.adapter.js'
import { UtilityAPI } from '#root/infrastructure/adapters/blockchain/utility-chain.adapter.js'
import { logTxEvent, runTxFinalized, watchThroughReorgs } from '#root/infrastructure/tx-event.io.js'
import { dotnsGatewayReserveLatencyHistogram } from '#root/metrics/dotns-gateway.js'
import { sr25519 } from '@identity-backend/crypto'
import { DB } from '@identity-backend/db'
import { Daemon } from '@identity-backend/effect-daemon-spec'
import { fromObservable } from '@identity-backend/rx-effect'
import { and, eq } from 'drizzle-orm'
import { Array, Context, Duration, Effect, Either, Metric, pipe, Ref, Schedule, Stream } from 'effect'
import { Binary, type PolkadotSigner, type TxFinalized } from 'polkadot-api'

type AhUtilityItemFailed = ReturnType<AhItemFailedEvFilter>[number]

const isUtilityEvent = (event: TxFinalized['events'][number]) =>
  event.type === 'Utility' &&
  (event.value.type === 'ItemFailed' || event.value.type === 'ItemCompleted')

const getUtilityEvents = (
  events: TxFinalized['events'],
): readonly { itemIndex: number; originalEventIndex: number; event: TxFinalized['events'][number] }[] => {
  const out: { itemIndex: number; originalEventIndex: number; event: TxFinalized['events'][number] }[] = []
  events.forEach((event, originalEventIndex) => {
    if (isUtilityEvent(event)) {
      out.push({ itemIndex: out.length, originalEventIndex, event })
    }
  })
  return out
}

const isItemCompleted = (entry: { event: TxFinalized['events'][number] }) => entry.event.value.type === 'ItemCompleted'

const isItemFailed = (entry: { event: TxFinalized['events'][number] }) => entry.event.value.type === 'ItemFailed'

const isDotnsGatewayModuleError = (errorEvent: AhUtilityItemFailed) =>
  errorEvent?.payload.error.type === 'Module' &&
  errorEvent?.payload.error.value?.type === 'DotnsGateway'

const isAlreadyRegisteredError = (errorEvent: AhUtilityItemFailed) =>
  isDotnsGatewayModuleError(errorEvent) &&
  errorEvent!.payload!.error!.value!.value!.type === 'AlreadyRegistered'

export const TERMINAL_DOTNS_ERRORS = new Set([
  'InvalidName',
  'InvalidAttestationSignature',
  'ReservationSignatureExpired',
  'ReservationSignatureFromFuture',
  'NotLiteLabelOwner',
  'ContractRevert',
])

const isTerminalError = (
  errorEvent: AhUtilityItemFailed,
): errorEvent is AhUtilityItemFailed & {
  payload: { error: { type: 'Module'; value: { type: 'DotnsGateway'; value: { type: string } } } }
} =>
  isDotnsGatewayModuleError(errorEvent) &&
  TERMINAL_DOTNS_ERRORS.has(errorEvent!.payload!.error!.value!.value!.type!)

const getTerminalErrorReason = (errorEvent: AhUtilityItemFailed): string | undefined =>
  isTerminalError(errorEvent)
    ? errorEvent.payload.error.value.value.type
    : undefined

interface CategorizedItem {
  readonly itemIndex: number
  readonly originalEventIndex: number
}

interface CategorizedTerminal extends CategorizedItem {
  readonly reason: string
}

interface FailureEntry {
  readonly event: AhUtilityItemFailed | undefined
  readonly itemIndex: number
  readonly originalEventIndex: number
}

export const categorizeFailures = (failures: readonly FailureEntry[]) => {
  const alreadyRegistered: CategorizedItem[] = []
  const terminalErrors: CategorizedTerminal[] = []
  const retryableItems: CategorizedItem[] = []
  for (const f of failures) {
    const base = { itemIndex: f.itemIndex, originalEventIndex: f.originalEventIndex }
    if (f.event && isAlreadyRegisteredError(f.event)) {
      alreadyRegistered.push(base)
    } else if (f.event && isTerminalError(f.event)) {
      terminalErrors.push({ ...base, reason: getTerminalErrorReason(f.event)! })
    } else {
      retryableItems.push(base)
    }
  }
  return { alreadyRegistered, terminalErrors, retryableItems }
}

export interface ProcessedEvents {
  readonly successes: readonly CategorizedItem[]
  readonly alreadyRegistered: readonly CategorizedItem[]
  readonly terminalErrors: readonly CategorizedTerminal[]
  readonly retryableItems: readonly CategorizedItem[]
}

export const processEventsPure = (
  events: TxFinalized['events'],
  filterUtilityItemFailed: AhItemFailedEvFilter,
): ProcessedEvents => {
  const utilityEvents = getUtilityEvents(events)

  const successes: CategorizedItem[] = utilityEvents
    .filter(isItemCompleted)
    .map(({ itemIndex, originalEventIndex }) => ({ itemIndex, originalEventIndex }))

  const failureEntries: FailureEntry[] = utilityEvents
    .filter(isItemFailed)
    .map(({ itemIndex, originalEventIndex, event }) => ({
      event: filterUtilityItemFailed([event])[0],
      itemIndex,
      originalEventIndex,
    }))

  const { alreadyRegistered, terminalErrors, retryableItems } = categorizeFailures(failureEntries)

  return { successes, alreadyRegistered, terminalErrors, retryableItems }
}

const processEvents = (
  events: TxFinalized['events'],
  dotnsGateway: DotnsGatewayAPI,
): Effect.Effect<ProcessedEvents> =>
  Effect.sync(() => processEventsPure(events, dotnsGateway.filterUtilityItemFailed)).pipe(
    Effect.withSpan('DotnsReservationWorker/processEvents'),
    Effect.withLogSpan('DotnsReservationWorker/processEvents'),
  )

type ReadyRow = IndividualityUsername & {
  candidateSignatureDotns: string
  signedAt: Date
}

export const isReadyRow = (row: IndividualityUsername): row is ReadyRow =>
  row.candidateSignatureDotns !== null &&
  row.signedAt !== null

export const partitionReady = (rows: readonly IndividualityUsername[]) => {
  const ready: ReadyRow[] = []
  const missingFields: IndividualityUsername[] = []
  for (const row of rows) {
    if (isReadyRow(row)) ready.push(row)
    else missingFields.push(row)
  }
  return { ready, missingFields }
}

export const partitionByFreshness = (
  rows: readonly ReadyRow[],
  nowSeconds: number,
  submitDeadline: number,
  maxFutureSkewSeconds: number,
) => {
  const fresh: ReadyRow[] = []
  const expired: ReadyRow[] = []
  const future: ReadyRow[] = []
  for (const row of rows) {
    const ageSeconds = nowSeconds - Math.floor(row.signedAt.getTime() / 1000)
    if (ageSeconds > submitDeadline) {
      expired.push(row)
    } else if (ageSeconds < -maxFutureSkewSeconds) {
      future.push(row)
    } else {
      fresh.push(row)
    }
  }
  return { fresh, expired, future }
}

export const RETRY_BACKOFF_SECONDS: readonly number[] = [30, 60, 300, 900, 3600]
export const MAX_AH_RETRIES = RETRY_BACKOFF_SECONDS.length

export const computeNextRetryAt = (
  retryCount: number,
  now: Date,
): Date | null => {
  if (retryCount >= MAX_AH_RETRIES) return null
  return new Date(now.getTime() + RETRY_BACKOFF_SECONDS[retryCount]! * 1000)
}

const markStaleRowsFailed = (rows: readonly IndividualityUsername[]) =>
  Effect.gen(function*() {
    const db = yield* DB
    yield* Effect.all(
      rows.map((row) =>
        Effect.tryPromise(() =>
          db
            .update(schema.individualityUsernames)
            .set({
              ahStatus: 'FAILED',
              ahOnchainData: { failure: { reason: 'SIGNATURE_EXPIRED' } },
            })
            .where(
              and(
                eq(schema.individualityUsernames.username, row.username),
                eq(schema.individualityUsernames.network, row.network),
                eq(schema.individualityUsernames.digits, row.digits),
              ),
            )
        )
      ),
      { concurrency: 'unbounded' },
    )
  })

type ProcessedResult = TxFinalized & {
  readonly candidateRows: readonly IndividualityUsername[]
  readonly processedEvents: ProcessedEvents
  readonly now: Date
}

const createSuccessUpdate = (
  db: DB.DB,
  result: ProcessedResult,
  entry: CategorizedItem,
) => {
  const item = result.candidateRows[entry.itemIndex]!
  return Effect.asVoid(Effect.tryPromise(() =>
    db
      .update(schema.individualityUsernames)
      .set({
        ahStatus: 'ASSIGNED',
        ahOnchainData: {
          blockIndex: result.block.index,
          blockNumber: result.block.number,
          blockHash: result.block.hash,
          eventIndex: entry.originalEventIndex,
        },
      })
      .where(
        and(
          eq(schema.individualityUsernames.username, item.username),
          eq(schema.individualityUsernames.network, item.network),
          eq(schema.individualityUsernames.digits, item.digits),
        ),
      )
  ))
}

const createAlreadyRegisteredUpdate = (
  db: DB.DB,
  result: ProcessedResult,
  entry: CategorizedItem,
) => {
  const item = result.candidateRows[entry.itemIndex]!
  return Effect.asVoid(Effect.tryPromise(() =>
    db
      .update(schema.individualityUsernames)
      .set({ ahStatus: 'ASSIGNED' })
      .where(
        and(
          eq(schema.individualityUsernames.username, item.username),
          eq(schema.individualityUsernames.network, item.network),
          eq(schema.individualityUsernames.digits, item.digits),
        ),
      )
  ))
}

const createTerminalErrorUpdate = (
  db: DB.DB,
  result: ProcessedResult,
  entry: CategorizedTerminal,
) => {
  const item = result.candidateRows[entry.itemIndex]!
  return Effect.asVoid(
    Effect.tryPromise(() =>
      db
        .update(schema.individualityUsernames)
        .set({
          ahStatus: 'FAILED',
          ahOnchainData: { failure: { reason: entry.reason } },
        })
        .where(
          and(
            eq(schema.individualityUsernames.username, item.username),
            eq(schema.individualityUsernames.network, item.network),
            eq(schema.individualityUsernames.digits, item.digits),
          ),
        )
    ),
  )
}

const createRetryableUpdate = (
  db: DB.DB,
  result: ProcessedResult,
  entry: CategorizedItem,
) => {
  const item = result.candidateRows[entry.itemIndex]!
  const nextRetryCount = item.ahRetryCount + 1
  const nextRetryAt = computeNextRetryAt(item.ahRetryCount, result.now)
  return Effect.asVoid(
    Effect.tryPromise(() =>
      db
        .update(schema.individualityUsernames)
        .set(
          nextRetryAt === null
            ? {
              ahStatus: 'FAILED',
              ahRetryCount: nextRetryCount,
              ahOnchainData: { failure: { reason: 'RETRIES_EXHAUSTED' } },
            }
            : {
              ahRetryAt: nextRetryAt,
              ahRetryCount: nextRetryCount,
            },
        )
        .where(
          and(
            eq(schema.individualityUsernames.username, item.username),
            eq(schema.individualityUsernames.network, item.network),
            eq(schema.individualityUsernames.digits, item.digits),
          ),
        )
    ),
  )
}

const updateDB = (result: ProcessedResult) =>
  Effect.gen(function*() {
    const db = yield* DB

    const updates = [
      ...result.processedEvents.successes.map((e) => createSuccessUpdate(db, result, e)),
      ...result.processedEvents.alreadyRegistered.map((e) => createAlreadyRegisteredUpdate(db, result, e)),
      ...result.processedEvents.terminalErrors.map((e) => createTerminalErrorUpdate(db, result, e)),
      ...result.processedEvents.retryableItems.map((e) => createRetryableUpdate(db, result, e)),
    ]

    yield* Effect.all(updates, { concurrency: 'unbounded' })
  }).pipe(
    Effect.withSpan('DotnsReservationWorker/updateDB'),
    Effect.withLogSpan('DotnsReservationWorker/updateDB'),
  )

export class DotnsReservationWorkerConfig extends Context.Tag(
  'DotnsReservationWorkerConfig',
)<
  DotnsReservationWorkerConfig,
  {
    readonly dotnsGatewayEnabled: boolean
    readonly submitTimeout: Duration.Duration
    readonly batchSize: BatchSize
    readonly pollInterval: Duration.Duration
    readonly tickTimeout: Duration.Duration
    readonly operationsTotalCounter: Metric.Metric.Counter<number>
    readonly operationsFailuresCounter: Metric.Metric.Counter<number>
    readonly keypair: sr25519.Keypair
    readonly proxyDelegationEnabled: boolean
    readonly attesterPublicKey: sr25519.PublicKey
    readonly signedAtSafetyMarginSeconds: number
  }
>() {}

export const make = Effect.gen(function*() {
  const config = yield* DotnsReservationWorkerConfig
  const db = yield* DB
  const dotnsGateway = yield* DotnsGatewayAPI
  const utilityAPI = yield* UtilityAPI
  const { operationsTotalCounter, operationsFailuresCounter } = config
  const batchSizePolicy = BatchSizePolicy.Default(config.batchSize)
  const batchSizeRef = yield* Ref.make(batchSizePolicy.max)
  const batchBackoff: Context.Tag.Service<typeof RecordBatchOutcomeDeps> = {
    daemon: 'dotns-reservations',
    policy: batchSizePolicy,
    size: batchSizeRef,
  }

  const { getPolkadotSigner } = yield* Effect.promise(() => import('@polkadot-api/signer'))

  const createAhSigner = (keyPair: sr25519.Keypair): PolkadotSigner => {
    const baseSigner = getPolkadotSigner(
      keyPair.publicKey,
      'Sr25519',
      (input) => Effect.runSync(keyPair.sign(input)),
    )

    return ({
      publicKey: baseSigner.publicKey,
      signBytes: baseSigner.signBytes,
      signTx: async (callData, signedExtensions, metadata, atBlockNumber, hasher) => {
        // VerifyMultiSignature signed extension: a single 0 byte selects the
        // sr25519 variant of MultiSignature on Asset Hub. Same shape used by the
        // People-lite and DIM signers — without it the runtime rejects the tx.
        const extensionsWithCustom = {
          ...signedExtensions,
          VerifyMultiSignature: {
            identifier: 'VerifyMultiSignature',
            value: new Uint8Array([0]),
            additionalSigned: new Uint8Array([]),
          },
        }
        return baseSigner.signTx(callData, extensionsWithCustom, metadata, atBlockNumber, hasher)
      },
    }) satisfies PolkadotSigner
  }

  const attesterAhSigner = createAhSigner(config.keypair)

  const work = Effect.gen(function*() {
    // Disable gate — replaces the previous `layerSubmitDotnsReservationsDaemonConditional`
    // in main.ts. The supervisor runs unconditionally; the work function returns early
    // when Asset Hub dotNS gateway is disabled.
    if (!config.dotnsGatewayEnabled) return

    const batchSize = yield* Ref.get(batchSizeRef)
    const candidateRows = yield* pipe(
      Effect.tryPromise(() =>
        db.query.individualityUsernames.findMany({
          where: {
            source: { eq: 'INTERNAL' },
            ahStatus: { eq: 'RESERVED' },
            OR: [
              { ahRetryAt: { isNull: true } },
              { ahRetryAt: { lte: new Date() } },
            ],
          },
          limit: batchSize,
        })
      ),
      Effect.retry(
        Schedule.intersect(
          Schedule.exponential('100 millis', 2),
          Schedule.recurs(2),
        ),
      ),
    )

    yield* Effect.annotateLogsScoped({
      usernames: Array.map(candidateRows, ({ username }) => username),
    })

    if (candidateRows.length === 0) {
      return
    }

    const { ready: readyRows, missingFields: missingFieldRows } = partitionReady(candidateRows)

    if (missingFieldRows.length > 0) {
      // Defensive: rows in ah_status='RESERVED' should always have the AH fields populated
      // by the register route. Log loudly but do not auto-FAIL — operator inspection wanted.
      yield* Effect.logError('dotNS RESERVED rows missing AH fields; skipping')
        .pipe(
          Effect.annotateLogs({
            missingCount: missingFieldRows.length,
            'error.category': 'data-integrity',
            'error.subcategory': 'dotns-reservation',
            'error.type': 'MISSING_AH_FIELDS',
          }),
        )
    }

    const nowSeconds = Math.floor(Date.now() / 1000)
    const { maxValiditySeconds, maxFutureSkewSeconds } = dotnsGateway.chainConstants
    const submitDeadline = maxValiditySeconds - config.signedAtSafetyMarginSeconds
    const { fresh: freshRows, expired: expiredRows, future: futureRows } = partitionByFreshness(
      readyRows,
      nowSeconds,
      submitDeadline,
      maxFutureSkewSeconds,
    )

    if (expiredRows.length > 0) {
      yield* Effect.logWarning('Dropping rows with stale dotNS signatures')
        .pipe(
          Effect.annotateLogs({
            expiredCount: expiredRows.length,
            'error.category': 'blockchain',
            'error.subcategory': 'dotns-reservation',
            'error.type': 'SIGNATURE_EXPIRED',
          }),
        )
      yield* markStaleRowsFailed(expiredRows)
    }

    if (futureRows.length > 0) {
      yield* Effect.logError('Dropping rows with future-dated dotNS signatures')
        .pipe(
          Effect.annotateLogs({
            futureCount: futureRows.length,
            'error.category': 'blockchain',
            'error.subcategory': 'dotns-reservation',
            'error.type': 'SIGNATURE_FROM_FUTURE',
          }),
        )
      yield* markStaleRowsFailed(futureRows)
    }

    if (freshRows.length === 0) {
      return
    }

    const success = yield* Ref.make(false)
    yield* operationsTotalCounter(Effect.succeed(freshRows.length))
    yield* Effect.addFinalizer(() =>
      Effect.gen(function*() {
        if (!(yield* Ref.get(success))) {
          yield* operationsFailuresCounter(Effect.succeed(freshRows.length))
        }
      })
    )

    yield* Effect.logInfo('Submit dotNS Reservations Job Started')

    const reserveParams = Array.map(
      freshRows,
      ({
        candidateAccountId,
        username,
        digits,
        candidateSignatureDotns,
        identifierKey,
        reservedUsername,
        signedAt,
      }) => ({
        candidate: candidateAccountId,
        candidateSignature: Binary.fromHex(candidateSignatureDotns),
        liteLabel: `${username}.${digits}`,
        chatKey: Binary.fromHex(identifierKey),
        reservedBaseLabel: reservedUsername ?? undefined,
        signedAt: BigInt(Math.floor(signedAt.getTime() / 1000)),
      }),
    )

    const tx = yield* config.proxyDelegationEnabled
      ? Effect.gen(function*() {
        const baseTx = yield* dotnsGateway.reserveNames(reserveParams)
        const ss58Address = yield* utilityAPI.computeSs58Address(config.attesterPublicKey)
        return yield* dotnsGateway.proxy({
          real: ss58Address,
          forceProxyType: 'Any',
          call: baseTx.decodedCall,
        })
      })
      : dotnsGateway.reserveNames(reserveParams)

    yield* Effect.logDebug('Reserve dotNS names extrinsic started')

    const submission = yield* Effect.either(pipe(
      Effect.sync(() => tx.signSubmitAndWatch(attesterAhSigner)),
      Effect.map(fromObservable((err) => new TransactionSubmitError({ cause: err }))),
      Effect.andThen((stream) =>
        pipe(
          stream,
          Stream.tap(logTxEvent),
          watchThroughReorgs,
          runTxFinalized({ timeout: config.submitTimeout }),
        )
      ),
    ))
    yield* recordBatchOutcome(outcomeFromTxResult(submission)).pipe(
      Effect.provideService(RecordBatchOutcomeDeps, batchBackoff),
    )

    if (Either.isLeft(submission)) {
      yield* Effect.logWarning('Reserve dotNS names extrinsic failed', { 'error.type': submission.left._tag })
      return
    }
    if (!submission.right.ok) {
      return
    }

    const txResult = submission.right
    yield* Effect.annotateLogsScoped({
      blockHash: txResult.block.hash,
      blockNumber: txResult.block.number,
      blockIndex: txResult.block.index,
      txHash: txResult.txHash,
    })

    yield* Effect.logDebug('Reserve dotNS names extrinsic completed')

    const processedEvents = yield* processEvents(txResult.events, dotnsGateway)
    yield* Ref.set(success, true)
    yield* operationsFailuresCounter(
      Effect.succeed(
        processedEvents.terminalErrors.length + processedEvents.retryableItems.length,
      ),
    )

    yield* Effect.logDebug('Committing reserve dotNS names results to database')

    if (processedEvents.terminalErrors.length > 0) {
      yield* Effect.forEach(
        processedEvents.terminalErrors,
        ({ itemIndex, reason }) =>
          Effect.logWarning('Terminal dotNS reservation failure').pipe(
            Effect.annotateLogs({
              'username.lite': `${freshRows[itemIndex]!.username}.${freshRows[itemIndex]!.digits}`,
              'error.category': 'blockchain',
              'error.subcategory': 'dotns-reservation',
              'error.type': reason,
              'error.retryable': false,
            }),
          ),
        { discard: true },
      )
    }

    if (processedEvents.retryableItems.length > 0) {
      yield* Effect.forEach(
        processedEvents.retryableItems,
        ({ itemIndex }) =>
          Effect.logWarning('dotNS reservation will be retried').pipe(
            Effect.annotateLogs({
              'username.lite': `${freshRows[itemIndex]!.username}.${freshRows[itemIndex]!.digits}`,
              'error.category': 'blockchain',
              'error.subcategory': 'dotns-reservation',
              'error.retryable': true,
            }),
          ),
        { discard: true },
      )
    }

    yield* updateDB({
      ...txResult,
      candidateRows: freshRows,
      processedEvents,
      now: new Date(),
    })

    yield* Effect.logDebug('Committed reserve dotNS names results to database')
    yield* Effect.log('Reserve dotNS names job completed')
  })

  return Daemon.poll({
    name: 'dotns-reservation',
    work: work.pipe(
      Effect.provideService(DB, db),
      Effect.scoped,
      Effect.orDie,
    ),
    interval: config.pollInterval,
    tick: {
      spanName: 'jobs.dotns_gateway.reserve',
      tickTimeout: config.tickTimeout,
    },
    tickHooks: {
      trackDuration: dotnsGatewayReserveLatencyHistogram,
    },
    lock: { mode: 'none' },
  })
})
