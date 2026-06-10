import { DB } from '#root/db/mod.js'
import { availableDigitsForUsername, selectDigits } from '#root/features/username-registration/digit-selection.js'
import { UsernameDigits } from '#root/schema/username.js'
import {
  CandidateAccountId,
  Network,
  QueueEntryId,
  UsernameReservation,
} from '#root/username-registration/registration-queue/entry.schema.js'
import {
  queueCycleDuration,
  queueCycleTotal,
  queueDepth,
} from '#root/username-registration/registration-queue/metrics.js'
import { QueuePriorityConfig } from '#root/username-registration/registration-queue/priority-group.config.js'
import { selectUsersForPriorityCycle } from '#root/username-registration/registration-queue/priority-group.js'
import {
  deleteQueuedEntriesByIds,
  findQueuedEntries,
  insertReservedUsernames,
} from '#root/username-registration/registration-queue/store.js'
import { getAllocatedDigits } from '#root/username-registration/store.js'
import { Daemon } from '@identity-backend/effect-daemon-spec'
import { Context, Duration, Effect, Either, HashSet, Metric, Random, Runtime, Schedule } from 'effect'

export class ProcessingWorkerRuntimeConfig extends Context.Reference<ProcessingWorkerRuntimeConfig>()(
  'ProcessingWorkerRuntimeConfig',
  {
    defaultValue: (): {
      pollInterval: Duration.Duration
      tickTimeout: Duration.Duration
    } => ({
      pollInterval: Duration.seconds(60),
      tickTimeout: Duration.seconds(120),
    }),
  },
) {}

export class RegistrationQueueConfig extends Context.Tag('RegistrationQueueConfig')<
  RegistrationQueueConfig,
  { network: 'westend2' | 'paseo' | 'polkadot' }
>() {}

const buildReservationValues = (
  assignments: ReadonlyArray<{
    readonly entryId: QueueEntryId
    readonly username: string
    readonly candidateAccountId: CandidateAccountId
    readonly digit: UsernameDigits
  }>,
  network: Network,
) => {
  const keyMap = new Map<string, QueueEntryId>()
  const values: UsernameReservation[] = assignments.map((a) => {
    const key = `${a.candidateAccountId}:${a.username}:${a.digit}`
    keyMap.set(key, a.entryId)
    return {
      username: a.username,
      digits: a.digit,
      network,
      candidateAccountId: a.candidateAccountId,
    }
  })
  return { values, keyMap }
}

const mapToQueueIds = (
  inserted: ReadonlyArray<{ readonly candidateAccountId: string; readonly username: string; readonly digits: string }>,
  keyMap: Map<string, QueueEntryId>,
): QueueEntryId[] =>
  inserted.flatMap((row) => {
    const queueId = keyMap.get(`${row.candidateAccountId}:${row.username}:${row.digits}`)
    return queueId === undefined ? [] : [queueId]
  })

export const makeRegistrationQueueWorker = Effect.gen(function*() {
  const db = yield* DB
  const rand = yield* Random.Random
  const runtime = yield* Effect.runtime()

  const config = yield* ProcessingWorkerRuntimeConfig
  const priorityConfig = yield* QueuePriorityConfig
  const { network } = yield* RegistrationQueueConfig

  const work = Effect.gen(function*() {
    yield* Metric.increment(queueCycleTotal)

    const queued = yield* findQueuedEntries().pipe(
      Effect.retry(Schedule.exponential(Duration.millis(200), 2).pipe(Schedule.compose(Schedule.recurs(3)))),
      Effect.orDie,
    )
    yield* Metric.set(queueDepth, queued.length)

    if (queued.length === 0) return

    const selected = selectUsersForPriorityCycle(queued, priorityConfig)
    if (selected.length === 0) return

    const usernames = [...HashSet.fromIterable(selected.map((s) => s.entry.username))]
    const allocated = yield* getAllocatedDigits(usernames, network)

    const digitAssignments = yield* Effect.all(
      selected.map((s) =>
        Effect.gen(function*() {
          const availableDigits = availableDigitsForUsername(allocated, s.entry.username)
          const digit = yield* selectDigits({
            availableDigits,
            baseUsername: s.entry.username,
          }).pipe(
            Effect.catchTag('NoDigitsAvailableError', () => Effect.succeed(null)),
            Effect.catchTag('PreferredDigitsTakenError', () => Effect.succeed(null)),
          )
          if (digit === null) return null
          return {
            entryId: s.entry.id,
            username: s.entry.username,
            candidateAccountId: s.entry.candidateAccountId,
            digit,
          }
        })
      ),
    ).pipe(Effect.map((results) => results.filter((r): r is NonNullable<typeof r> => r !== null)))

    if (digitAssignments.length === 0) return

    const { values, keyMap } = buildReservationValues(digitAssignments, network)

    const registeredIds: QueueEntryId[] = yield* Effect.tryPromise(() => {
      const runP = Runtime.runPromise(runtime)
      return db.transaction(async (tx) => {
        const either = await runP(
          Effect.gen(function*() {
            const rows = yield* insertReservedUsernames(values).pipe(
              Effect.provideService(DB, tx),
            )
            const ids = mapToQueueIds(rows, keyMap)
            if (ids.length > 0) {
              yield* deleteQueuedEntriesByIds(ids).pipe(Effect.provideService(DB, tx))
            }
            return ids
          }).pipe(
            Effect.retry(
              Schedule.exponential(Duration.millis(200), 2).pipe(Schedule.compose(Schedule.recurs(3))),
            ),
            Effect.either,
          ),
        )
        if (Either.isLeft(either)) throw either.left
        return either.right
      })
    }).pipe(Effect.orDie)

    yield* Effect.annotateCurrentSpan({
      'app.queue.entries_queried': queued.length,
      'app.queue.entries_selected': selected.length,
      'app.queue.entries_registered': registeredIds.length,
    })
  }).pipe(
    Effect.provideService(DB, db),
    Effect.provideService(Random.Random, rand),
  )

  return Daemon.poll({
    name: 'registration-queue',
    work,
    interval: config.pollInterval,
    tick: {
      spanName: 'registration_queue.processing_cycle',
      tickTimeout: config.tickTimeout,
    },
    tickHooks: {
      trackDuration: queueCycleDuration,
    },
    lock: { mode: 'none' },
  })
})
