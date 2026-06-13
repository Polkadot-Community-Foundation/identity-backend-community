import { outcomeFromTxResult } from '#root/batch-backoff/batch-backoff.acl.js'
import { recordBatchOutcome, RecordBatchOutcomeDeps } from '#root/batch-backoff/batch-backoff.executor.js'
import { type BatchSize, BatchSizePolicy } from '#root/batch-backoff/batch-backoff.schema.js'
import { schema } from '#root/db/mod.js'
import type { IndividualityUsername } from '#root/db/schema.js'
import { ChainId, ChainSubmitter } from '#root/infrastructure/adapters/blockchain/chain-submitter.adapter.js'
import type { TransactionIncluded } from '#root/infrastructure/adapters/blockchain/finalized-transaction.schema.js'
import { PeopleAPI } from '#root/infrastructure/adapters/blockchain/people-chain.adapter.js'
import { UtilityAPI } from '#root/infrastructure/adapters/blockchain/utility-chain.adapter.js'
import {
  peopleUsernameDaemonHeartbeatGauge,
  peopleUsernameDaemonLeaderGauge,
  peopleUsernameDaemonTickDurationHistogram,
  peopleUsernameE2eDurationHistogram,
  peopleUsernameQueueAgeHistogram,
  peopleUsernameRegistrationsCompletedCounter,
  peopleUsernameRegistrationsFailedCounter,
} from '#root/metrics/people.js'
import { sr25519 } from '@identity-backend/crypto'
import { DB } from '@identity-backend/db'
import { Daemon } from '@identity-backend/effect-daemon-spec'
import { buildSpanLinks } from '@identity-backend/observability'
import { TxFinalizationError, TxInclusionTimeoutError } from '@identity-backend/tx-events'
import { and, eq } from 'drizzle-orm'
import { Array, Clock, Context, Duration, Effect, Either, Match, Metric, Option, pipe, Ref, Schedule } from 'effect'
import { Binary, type PolkadotSigner, type TxFinalized } from 'polkadot-api'

interface ProcessedEvents {
  readonly firstItemEventIndex: number
  readonly successes: readonly number[]
  readonly alreadyRegistered: readonly number[]
  readonly terminalErrors: readonly { index: number; reason: string }[]
  readonly retryableItems: readonly number[]
}

type UtilityItemFailed = ReturnType<
  Effect.Effect.Success<typeof UtilityAPI['Service']['filterUtilityItemFailed']>
>[number]

const isUtilityEvent = (event: TxFinalized['events'][number]) =>
  event.type === 'Utility' &&
  (event.value.type === 'ItemFailed' || event.value.type === 'ItemCompleted')

const getUtilityEvents = (events: TxFinalized['events']) =>
  events
    .filter(isUtilityEvent)
    .map((event, index) => ({ index, event }))

const isItemCompleted = (utilityEvent: { event: TxFinalized['events'][number] }) =>
  utilityEvent.event.value.type === 'ItemCompleted'

const isItemFailed = (utilityEvent: { event: TxFinalized['events'][number] }) =>
  utilityEvent.event.value.type === 'ItemFailed'

const isPeopleLiteModuleError = (errorEvent: UtilityItemFailed) =>
  errorEvent?.payload.error.type === 'Module' &&
  errorEvent?.payload.error.value?.type === 'PeopleLite'

const isUsernameTakenError = (errorEvent: UtilityItemFailed) =>
  isPeopleLiteModuleError(errorEvent) &&
  errorEvent!.payload!.error!.value!.value!.type === 'AlreadyRegistered'

const isTerminalError = (
  errorEvent: UtilityItemFailed,
): errorEvent is UtilityItemFailed & {
  payload: { error: { type: 'Module'; value: { type: 'PeopleLite'; value: { type: string } } } }
} =>
  isPeopleLiteModuleError(errorEvent) &&
  ['InvalidAttestationSignature', 'InvalidProofOfOwnership', 'KeyAlreadyInUse'].includes(
    errorEvent!.payload!.error!.value!.value!.type!,
  )

const getTerminalErrorReason = (errorEvent: UtilityItemFailed): string | undefined =>
  isTerminalError(errorEvent)
    ? errorEvent.payload.error.value.value.type
    : undefined

const categorizeFailures = (
  failures: readonly { event: UtilityItemFailed | undefined; index: number }[],
) => {
  const alreadyRegistered = failures
    .filter(({ event }) => event && isUsernameTakenError(event))
    .map(({ index }) => index)

  const terminalErrors = failures
    .filter(({ event }) => event && isTerminalError(event))
    .map(({ event, index }) => ({ index, reason: getTerminalErrorReason(event!)! }))

  const retryableItems = failures
    .filter(({ event }) => event && !isUsernameTakenError(event) && !isTerminalError(event))
    .map(({ index }) => index)

  return { alreadyRegistered, terminalErrors, retryableItems }
}

const processEvents = (
  events: TxFinalized['events'],
  utilityAPI: UtilityAPI,
): Effect.Effect<ProcessedEvents> =>
  Effect.gen(function*() {
    const filterUtilityItemFailed = yield* utilityAPI.filterUtilityItemFailed

    return yield* Effect.sync(() => {
      const firstItemEventIndex = events.findIndex(isUtilityEvent)
      const utilityEvents = getUtilityEvents(events)

      const successes = utilityEvents
        .filter(isItemCompleted)
        .map(({ index }) => index)

      const failures = utilityEvents
        .filter(isItemFailed)
        .map(({ event, index }) => ({
          event: filterUtilityItemFailed([event])[0],
          index,
        }))

      const { alreadyRegistered, terminalErrors, retryableItems } = categorizeFailures(failures)

      return {
        firstItemEventIndex,
        successes,
        alreadyRegistered,
        terminalErrors,
        retryableItems,
      }
    })
  }).pipe(
    Effect.withSpan('PeopleLiteAttestationWorker/processEvents'),
    Effect.withLogSpan('PeopleLiteAttestationWorker/processEvents'),
  )

type ProcessedResult = {
  readonly block: TransactionIncluded['block']
  readonly unregisteredUsernames: readonly IndividualityUsername[]
  readonly processedEvents: ProcessedEvents
}

const createSuccessUpdate = (
  db: DB.DB,
  result: ProcessedResult,
  index: number,
) => {
  const item = result.unregisteredUsernames[index]!
  return Effect.asVoid(Effect.tryPromise(() =>
    db
      .update(schema.individualityUsernames)
      .set({
        status: 'ASSIGNED',
        onchainData: {
          blockIndex: result.block.index,
          blockNumber: result.block.number,
          blockHash: result.block.hash,
          eventIndex: result.processedEvents.firstItemEventIndex + index,
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
  index: number,
) => {
  const item = result.unregisteredUsernames[index]!
  return Effect.asVoid(Effect.tryPromise(() =>
    db
      .update(schema.individualityUsernames)
      .set({ status: 'ASSIGNED' })
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
  index: number,
) => {
  const item = result.unregisteredUsernames[index]!
  return Effect.asVoid(
    Effect.tryPromise(() =>
      db
        .update(schema.individualityUsernames)
        .set({ status: 'FAILED' })
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
      ...result.processedEvents.successes.map(index => createSuccessUpdate(db, result, index)),
      ...result.processedEvents.alreadyRegistered.map(index => createAlreadyRegisteredUpdate(db, result, index)),
      ...result.processedEvents.terminalErrors.map(({ index }) => createTerminalErrorUpdate(db, result, index)),
    ]

    yield* Effect.all(updates, { concurrency: 'unbounded' })
  }).pipe(
    Effect.withSpan('PeopleLiteAttestationWorker/updateDB'),
    Effect.withLogSpan('PeopleLiteAttestationWorker/updateDB'),
  )

const incrementFailed = (failure: string, amount: number): Effect.Effect<void> =>
  amount > 0
    ? Metric.incrementBy(Metric.tagged(peopleUsernameRegistrationsFailedCounter, 'failure', failure), amount)
    : Effect.void

const incrementCompleted = (completion: string, amount: number): Effect.Effect<void> =>
  amount > 0
    ? Metric.incrementBy(Metric.tagged(peopleUsernameRegistrationsCompletedCounter, 'completion', completion), amount)
    : Effect.void

const failureTagForSubmissionError = (
  error: TxInclusionTimeoutError | TxFinalizationError | { readonly _tag: string },
): 'tx_not_included' | 'finalization_timeout' | 'submit_error' =>
  Match.value(error).pipe(
    Match.tag('TxInclusionTimeoutError', () => 'tx_not_included' as const),
    Match.tag('TxFinalizationError', () => 'finalization_timeout' as const),
    Match.orElse(() => 'submit_error' as const),
  )

export class PeopleLiteAttestationWorkerConfig extends Context.Tag(
  'PeopleLiteAttestationWorkerConfig',
)<
  PeopleLiteAttestationWorkerConfig,
  {
    readonly inclusionTimeout: Duration.Duration
    readonly finalizationTimeout: Duration.Duration
    readonly batchSize: BatchSize
    readonly pollInterval: Duration.Duration
    readonly tickTimeout: Duration.Duration
    readonly keypair: sr25519.Keypair
    readonly proxyDelegationEnabled: boolean
    readonly attesterPublicKey: sr25519.PublicKey
  }
>() {}

export const make = Effect.gen(function*() {
  const config = yield* PeopleLiteAttestationWorkerConfig
  const db = yield* DB
  const peopleApi = yield* PeopleAPI
  const utilityAPI = yield* UtilityAPI
  const chainSubmitter = yield* ChainSubmitter
  const batchSizePolicy = BatchSizePolicy.Default(config.batchSize)
  const batchSizeRef = yield* Ref.make(batchSizePolicy.max)
  const batchBackoff: Context.Tag.Service<typeof RecordBatchOutcomeDeps> = {
    daemon: 'people-lite-attestation',
    policy: batchSizePolicy,
    size: batchSizeRef,
  }

  const { getPolkadotSigner } = yield* Effect.promise(() => import('@polkadot-api/signer'))

  const createPeopleSigner = (keyPair: sr25519.Keypair): PolkadotSigner => {
    const baseSigner = getPolkadotSigner(
      keyPair.publicKey,
      'Sr25519',
      (input) => Effect.runSync(keyPair.sign(input)),
    )

    return {
      publicKey: baseSigner.publicKey,
      signBytes: baseSigner.signBytes,
      signTx: async (callData, signedExtensions, metadata, atBlockNumber, hasher) => {
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
    }
  }

  const individualityAuthority = createPeopleSigner(config.keypair)

  const prereq = Effect.gen(function*() {
    const now = yield* Clock.currentTimeMillis
    const batchSize = yield* Ref.get(batchSizeRef)
    const unregisteredUsernames = yield* pipe(
      Effect.tryPromise(() =>
        db.query.individualityUsernames.findMany({
          where: {
            source: { eq: 'INTERNAL' },
            status: { eq: 'RESERVED' },
            OR: [
              { retryAt: { isNull: true } },
              { retryAt: { lte: new Date(now) } },
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
    yield* Effect.forEach(
      unregisteredUsernames,
      (row) =>
        Metric.update(
          peopleUsernameQueueAgeHistogram,
          Math.max(0, (now - row.createdAt.getTime()) / 1000),
        ),
      { discard: true },
    )
    return Option.liftPredicate(unregisteredUsernames, (found) => found.length > 0)
  }).pipe(Effect.orDie)

  const work = (unregisteredUsernames: ReadonlyArray<IndividualityUsername>) =>
    Effect.gen(function*() {
      yield* Effect.annotateLogsScoped({
        usernames: Array.map(unregisteredUsernames, ({ username }) => username),
      })

      yield* Effect.linkSpanCurrent(
        buildSpanLinks(unregisteredUsernames, (u) => ({ 'username': `${u.username}` })),
      )

      yield* pipe(
        Effect.all(
          [
            utilityAPI.getSs58Prefix(),
            utilityAPI.getLatestFinalizedBlock(),
          ],
          { concurrency: 'unbounded' },
        ),
        Effect.map(([ss58Prefix, currentBlockNumber]) => ({ ss58Prefix, currentBlockNumber })),
        Effect.tap(({ ss58Prefix, currentBlockNumber }) =>
          Effect.annotateLogsScoped({ ss58Prefix, currentBlockNumber })
        ),
      )

      yield* Effect.gen(function*() {
        yield* Metric.set(peopleUsernameDaemonLeaderGauge, 1)
        yield* Effect.annotateCurrentSpan({ 'app.people.username.batch.size': unregisteredUsernames.length })

        yield* Effect.logInfo('Register People Usernames Job Started')

        const attestParams = Array.map(
          unregisteredUsernames,
          ({
            candidateAccountId,
            username,
            candidateSignature,
            ringVrfKey,
            proofOfOwnership,
            consumerRegistrationSignature,
            identifierKey,
            digits,
            reservedUsername,
          }) => ({
            candidate: candidateAccountId,
            candidateSignature: Binary.fromHex(candidateSignature),
            ringVrfKey: Binary.fromHex(ringVrfKey),
            proofOfOwnership: Binary.fromHex(proofOfOwnership),
            consumerRegistration: {
              signature: Binary.fromHex(consumerRegistrationSignature),
              account: candidateAccountId,
              identifierKey: Binary.fromHex(identifierKey),
              username: `${username}.${digits}`,
              reservedUsername: reservedUsername ?? undefined,
            },
          }),
        )

        const tx = yield* config.proxyDelegationEnabled
          ? Effect.gen(function*() {
            const batchTx = yield* peopleApi.attests(attestParams)
            const ss58Address = yield* utilityAPI.computeSs58Address(config.attesterPublicKey)
            return yield* peopleApi.proxy({
              real: ss58Address,
              force_proxy_type: 'Any',
              call: batchTx.decodedCall,
            })
          })
          : peopleApi.attests(attestParams)

        yield* Effect.logDebug('Register People usernames extrinsic started')

        const submission = yield* Effect.either(
          chainSubmitter.submit(individualityAuthority, tx, {
            chain: ChainId.make('people'),
            timeout: config.inclusionTimeout,
            finalizationTimeout: config.finalizationTimeout,
          }),
        )
        yield* recordBatchOutcome(outcomeFromTxResult(submission)).pipe(
          Effect.provideService(RecordBatchOutcomeDeps, batchBackoff),
        )

        if (Either.isLeft(submission)) {
          const failure = failureTagForSubmissionError(submission.left)
          yield* Effect.logWarning('Register People usernames extrinsic failed', {
            'error.type': submission.left._tag,
            'failure': failure,
          })
          yield* incrementFailed(failure, unregisteredUsernames.length)
          return
        }
        const included = Match.value(submission.right).pipe(
          Match.tag('TransactionIncluded', (transaction) => Option.some(transaction)),
          Match.tag('TransactionReverted', () => Option.none<TransactionIncluded>()),
          Match.exhaustive,
        )
        if (Option.isNone(included)) {
          return
        }

        const txResult = included.value
        yield* Effect.annotateLogsScoped({
          blockHash: txResult.block.hash,
          blockNumber: txResult.block.number,
          blockIndex: txResult.block.index,
          txHash: txResult.txHash,
        })

        yield* Effect.logDebug('Register People usernames extrinsic completed')

        const processedEvents = yield* processEvents(txResult.events, utilityAPI)
        const completedAt = yield* Clock.currentTimeMillis
        yield* incrementCompleted('item_completed', processedEvents.successes.length)
        yield* incrementCompleted('already_registered_on_chain', processedEvents.alreadyRegistered.length)
        yield* incrementFailed('terminal', processedEvents.terminalErrors.length)
        yield* incrementFailed('retryable', processedEvents.retryableItems.length)
        yield* Effect.forEach(
          [...processedEvents.successes, ...processedEvents.alreadyRegistered],
          (index) =>
            Metric.update(
              peopleUsernameE2eDurationHistogram,
              Math.max(0, (completedAt - unregisteredUsernames[index]!.createdAt.getTime()) / 1000),
            ),
          { discard: true },
        )

        yield* Effect.logDebug('Committing Register People usernames results to database')

        const registeredUsernames = Array.map(
          [...processedEvents.successes, ...processedEvents.alreadyRegistered],
          (i) => unregisteredUsernames[i]!,
        )

        const notRegisteredUsernames = processedEvents.terminalErrors.map(
          ({ index }) => unregisteredUsernames[index]!,
        )

        if (processedEvents.terminalErrors.length > 0) {
          yield* Effect.forEach(
            processedEvents.terminalErrors,
            ({ index, reason }) =>
              Effect.logWarning('Terminal username registration failure').pipe(
                Effect.annotateLogs({
                  'username.lite': `${unregisteredUsernames[index]!.username}.${unregisteredUsernames[index]!.digits}`,
                  'error.category': 'blockchain',
                  'error.subcategory': 'people-lite-attestation',
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
            (index) =>
              Effect.logWarning('Username registration will be retried').pipe(
                Effect.annotateLogs({
                  'username.lite': `${unregisteredUsernames[index]!.username}.${unregisteredUsernames[index]!.digits}`,
                  'error.category': 'blockchain',
                  'error.subcategory': 'people-lite-attestation',
                  'error.retryable': true,
                }),
              ),
            { discard: true },
          )
        }

        yield* Effect.annotateLogsScoped({
          registeredUsernames: Array.map(registeredUsernames, ({ username }) => username),
          notRegisteredUsernames: Array.map(notRegisteredUsernames, ({ username }) => username),
        })

        yield* Effect.uninterruptible(updateDB({
          block: txResult.block,
          unregisteredUsernames,
          processedEvents,
        }))

        yield* Effect.logDebug('Committed Register People usernames results to database')
        yield* Effect.log('Register People usernames job completed')
      })

      yield* Metric.set(peopleUsernameDaemonHeartbeatGauge, 1)
    }).pipe(
      Effect.provideService(DB, db),
      Effect.scoped,
      Effect.orDie,
    )

  return Daemon.poll({
    name: 'people-lite-attestation',
    prereq,
    work,
    interval: config.pollInterval,
    tick: {
      spanName: 'jobs.people_lite.attest',
      tickTimeout: config.tickTimeout,
    },
    tickHooks: {
      trackDuration: peopleUsernameDaemonTickDurationHistogram,
    },
    lock: { mode: 'none' },
  })
})
