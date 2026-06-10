import { Daemon } from '@identity-backend/effect-daemon-spec'
import { Context, Duration, Effect, Metric, Random, Schedule } from 'effect'

import { type PlanckBalance, ZERO_PLANCK } from '#root/schema/balance.js'
import {
  queueBalanceCheckDuration,
  queueBalanceCheckTotal,
} from '#root/username-registration/registration-queue/metrics.js'
import { QueuePriorityConfig } from '#root/username-registration/registration-queue/priority-group.config.js'
import { priorityUpdatesForBalances } from '#root/username-registration/registration-queue/priority-group.js'
import { findQueuedEntries, updatePriorityGroups } from '#root/username-registration/registration-queue/store.js'
import { DB } from '@identity-backend/db'

export class BalanceCheckConfig extends Context.Reference<BalanceCheckConfig>()('BalanceCheckConfig', {
  defaultValue: (): {
    readonly pollInterval: Duration.Duration
    readonly tickTimeout: Duration.Duration
  } => ({
    pollInterval: Duration.seconds(60),
    tickTimeout: Duration.seconds(120),
  }),
}) {}

export class BalanceCheckWorkerDeps extends Context.Tag('BalanceCheckWorkerDeps')<
  BalanceCheckWorkerDeps,
  {
    getFreeBalances: (accountIds: ReadonlyArray<string>) => Effect.Effect<ReadonlyArray<PlanckBalance>, never>
  }
>() {}

export const makeBalanceCheckWorker = Effect.gen(function*() {
  const db = yield* DB
  const rand = yield* Random.Random

  const config = yield* BalanceCheckConfig
  const priorityConfig = yield* QueuePriorityConfig
  const { getFreeBalances } = yield* BalanceCheckWorkerDeps

  const work = Effect.gen(function*() {
    yield* Metric.increment(queueBalanceCheckTotal)

    const entries = yield* findQueuedEntries().pipe(
      Effect.retry(Schedule.exponential(Duration.millis(200), 2).pipe(Schedule.compose(Schedule.recurs(3)))),
      Effect.orDie,
    )
    if (entries.length === 0) {
      yield* Effect.annotateCurrentSpan({ 'app.queue.entries_checked': 0 })
      return
    }

    const balances = yield* getFreeBalances(entries.map((e) => e.candidateAccountId))
    const updates = priorityUpdatesForBalances(
      entries.map((e, i) => ({
        id: e.id,
        currentGroup: e.priorityGroup,
        balance: balances[i] ?? ZERO_PLANCK,
      })),
      priorityConfig,
    )

    if (updates.length > 0) {
      yield* updatePriorityGroups(updates).pipe(
        Effect.retry(Schedule.exponential(Duration.millis(200), 2).pipe(Schedule.compose(Schedule.recurs(3)))),
        Effect.orDie,
      )
    }

    yield* Effect.annotateCurrentSpan({
      'app.queue.entries_checked': entries.length,
      'app.queue.updates_applied': updates.length,
    })
  }).pipe(
    Effect.provideService(DB, db),
    Effect.provideService(Random.Random, rand),
  )

  return Daemon.poll({
    name: 'registration-queue-balance-check',
    work,
    interval: config.pollInterval,
    tick: {
      spanName: 'registration_queue.balance_check_cycle',
      tickTimeout: config.tickTimeout,
    },
    tickHooks: {
      trackDuration: queueBalanceCheckDuration,
    },
    lock: { mode: 'none' },
  })
})
