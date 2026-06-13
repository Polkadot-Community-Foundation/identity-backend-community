import { DaemonReporter, LeaderLock, run } from '@identity-backend/effect-daemon-spec'
import {
  And,
  Gherkin,
  Given,
  it as itLayer,
  layer,
  makeFeature,
  Then,
  When,
} from '@identity-backend/effect-vitest-gherkin'
import { sql } from 'drizzle-orm'
import { Duration, Effect, Layer, Metric, MetricState } from 'effect'
import { expect } from 'vitest'

import { EffectSQLDb } from '#root/db/effect-sql-db.js'

import {
  cacheHitRatio,
  databaseSizeBytes,
  deadlocks,
  serverConnections,
  serverMaxConnections,
  sessionsActive,
  sessionsIdle,
  sessionsTotal,
  sessionsWaitingLock,
} from '#root/supervision/pg-monitor/metrics.js'
import {
  makePgMonitorCapacityWorker,
  PgMonitorCapacityConfig,
} from '#root/supervision/pg-monitor/workers/pg-monitor-capacity.worker.js'
import { makePgMonitorIoWorker, PgMonitorIoConfig } from '#root/supervision/pg-monitor/workers/pg-monitor-io.worker.js'
import {
  makePgMonitorLivenessWorker,
  PgMonitorLivenessConfig,
} from '#root/supervision/pg-monitor/workers/pg-monitor-liveness.worker.js'
import {
  makePgMonitorSessionsWorker,
  PgMonitorSessionsConfig,
} from '#root/supervision/pg-monitor/workers/pg-monitor-sessions.worker.js'

import { EffectSQLDbTest } from '../helpers/effect-sql-db-test.js'

const Feature = makeFeature({ it: itLayer, layer })

const fastTick = (ms: number) => ({
  interval: Duration.millis(ms),
  tickTimeout: Duration.seconds(5),
})

const fullLayer = Layer.mergeAll(
  Layer.succeed(PgMonitorLivenessConfig, fastTick(100)),
  Layer.succeed(PgMonitorIoConfig, fastTick(100)),
  Layer.succeed(PgMonitorSessionsConfig, fastTick(100)),
  Layer.succeed(PgMonitorCapacityConfig, fastTick(100)),
  LeaderLock.Noop,
  DaemonReporter.Noop,
)

const readGauge = (metric: Metric.Metric.Gauge<number>): Effect.Effect<number, never, never> =>
  Metric.value(metric).pipe(
    Effect.map((state) => {
      expect(MetricState.isGaugeState(state)).toBe(true)
      return state.value
    }),
  )

const workLayer = Layer.provide(EffectSQLDbTest, fullLayer)

Feature('PostgreSQL health monitoring')
  .liveClock()
  .withLayer(fullLayer)
  .withScenarioLayer(workLayer)
  .body(({ scenario }) => {
    scenario(
      'Maximum connection capacity is reported at startup',
      Gherkin.Do.pipe(
        Given('a PostgreSQL server with a configured connection limit')('expected', () =>
          Effect.gen(function*() {
            const db = yield* EffectSQLDb
            const row = yield* db.execute<{ setting: string }>(
              sql`SELECT setting FROM pg_settings WHERE name = ${'max_connections'}`,
            )
            expect(row[0]?.setting).toMatch(/^\d+$/)
            return { expectedMax: Number(row[0]!.setting) }
          })),
        When('the monitor starts')(() =>
          Effect.gen(function*() {
            const worker = yield* makePgMonitorLivenessWorker
            const health = yield* run.worker(worker)
            yield* health.ready.await
            return health
          })
        ),
        Then('the maximum connection gauge equals the configured limit')((s) =>
          Effect.gen(function*() {
            const observed = yield* readGauge(serverMaxConnections)
            expect(observed).toBe(s.expected.expectedMax)
          })
        ),
        And('the gauge is positive')((_s) =>
          Effect.gen(function*() {
            const observed = yield* readGauge(serverMaxConnections)
            expect(observed).toBeGreaterThan(0)
          })
        ),
      ),
    )

    scenario(
      'Monitor readiness is reported after the first health check',
      Gherkin.Do.pipe(
        Given('a liveness worker is configured')('config', () => Effect.succeed({})),
        When('the monitor starts')('health', () =>
          Effect.gen(function*() {
            const worker = yield* makePgMonitorLivenessWorker
            return yield* run.worker(worker)
          })),
        Then('the monitor readiness signal is set')((s) => s.health.ready.await),
      ),
    )

    scenario(
      'Database I/O health metrics are reported',
      Gherkin.Do.pipe(
        Given('a database with query activity')('init', () =>
          Effect.gen(function*() {
            const db = yield* EffectSQLDb
            yield* db.execute(sql`SELECT 1`)
            return {}
          })),
        When('I/O metrics are collected')(() =>
          Effect.gen(function*() {
            const worker = yield* makePgMonitorIoWorker
            const health = yield* run.worker(worker)
            yield* health.ready.await
            return health
          })
        ),
        Then('deadlock count is a non-negative integer')((_s) =>
          Effect.gen(function*() {
            const d = yield* readGauge(deadlocks)
            expect(Number.isInteger(d)).toBe(true)
            expect(d).toBeGreaterThanOrEqual(0)
          })
        ),
        And('cache hit ratio is between 0 and 1 inclusive')((_s) =>
          Effect.gen(function*() {
            const c = yield* readGauge(cacheHitRatio)
            if (Number.isNaN(c)) return
            expect(c).toBeGreaterThanOrEqual(0)
            expect(c).toBeLessThanOrEqual(1)
          })
        ),
      ),
    )

    scenario(
      'Session state counts are reported',
      Gherkin.Do.pipe(
        Given('an active database')('init', () =>
          Effect.gen(function*() {
            const db = yield* EffectSQLDb
            yield* db.execute(sql`SELECT 1`)
            yield* db.execute(sql`SELECT 2`)
            return {}
          })),
        When('session metrics are collected')(() =>
          Effect.gen(function*() {
            const worker = yield* makePgMonitorSessionsWorker
            const health = yield* run.worker(worker)
            yield* health.ready.await
            return health
          })
        ),
        Then('total sessions is non-negative')((_s) =>
          Effect.gen(function*() {
            const total = yield* readGauge(sessionsTotal)
            expect(total).toBeGreaterThanOrEqual(0)
          })
        ),
        And('active sessions is non-negative')((_s) =>
          Effect.gen(function*() {
            const active = yield* readGauge(sessionsActive)
            expect(active).toBeGreaterThanOrEqual(0)
          })
        ),
      ),
    )

    scenario(
      'Idle and waiting-lock session counts are reported',
      Gherkin.Do.pipe(
        Given('an active database')('init', () =>
          Effect.gen(function*() {
            const db = yield* EffectSQLDb
            yield* db.execute(sql`SELECT 1`)
            yield* db.execute(sql`SELECT 2`)
            return {}
          })),
        When('session and connection metrics are collected')(() =>
          Effect.gen(function*() {
            const worker = yield* makePgMonitorSessionsWorker
            const health = yield* run.worker(worker)
            yield* health.ready.await
            return health
          })
        ),
        Then('idle sessions is non-negative')((_s) =>
          Effect.gen(function*() {
            const idle = yield* readGauge(sessionsIdle)
            expect(idle).toBeGreaterThanOrEqual(0)
          })
        ),
        And('waiting-lock sessions is a non-negative integer')((_s) =>
          Effect.gen(function*() {
            const waiting = yield* readGauge(sessionsWaitingLock)
            expect(Number.isInteger(waiting)).toBe(true)
            expect(waiting).toBeGreaterThanOrEqual(0)
          })
        ),
        And('server connections is at least 1')((_s) =>
          Effect.gen(function*() {
            const server = yield* readGauge(serverConnections)
            expect(server).toBeGreaterThanOrEqual(1)
          })
        ),
      ),
    )

    scenario(
      'Database storage size is reported',
      Gherkin.Do.pipe(
        Given('a database with stored data')('init', () =>
          Effect.gen(function*() {
            const db = yield* EffectSQLDb
            yield* db.execute(sql`CREATE TABLE IF NOT EXISTS _pg_monitor_test (id int)`)
            yield* db.execute(sql`INSERT INTO _pg_monitor_test VALUES (1)`)
            return {}
          })),
        When('storage metrics are collected')(() =>
          Effect.gen(function*() {
            const worker = yield* makePgMonitorCapacityWorker
            const health = yield* run.worker(worker)
            yield* health.ready.await
            return health
          })
        ),
        Then('database size is positive')((_s) =>
          Effect.gen(function*() {
            const size = yield* readGauge(databaseSizeBytes)
            expect(size).toBeGreaterThan(0)
          })
        ),
      ),
    )
  })
