import { expect, it, layer } from '@effect/vitest'
import { DaemonReporter, LeaderLock } from '@identity-backend/effect-daemon-spec'
import { And, Given, makeFeature, Then, When } from '@identity-backend/effect-vitest-gherkin'
import { PostgreSqlContainer } from '@testcontainers/postgresql'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Cause, Context, Deferred, Duration, Effect, Fiber, Layer, Redacted, Schedule, Schema } from 'effect'
import { Client } from 'pg'
import { describe } from 'vitest'
import { LeaderElectionDbConfig, LeaderElectionDbLiveWithoutDependencies } from '../pool.js'
import {
  PostgresAdvisoryLeaderLockLive,
  PostgresAdvisoryLeaderLockServiceConfig,
} from '../postgres-advisory-lock.service.js'

// ─────────────────────────────────────────────────────────────────────────────
// Test fixtures: PostgreSQL container
// ─────────────────────────────────────────────────────────────────────────────

class PgContainer extends Context.Tag('test/PgContainer')<PgContainer, { uri: string }>() {}

const TEST_POOL_MAX_CONNECTIONS = 2

const pgContainerLayer = Layer.scoped(
  PgContainer,
  Effect.gen(function*() {
    const container = yield* Effect.acquireRelease(
      Effect.promise(() => new PostgreSqlContainer('postgres:18-alpine').start()),
      (c) => Effect.promise(() => c.stop()),
    )
    const uri = container.getConnectionUri()
    yield* Effect.promise(async () => {
      const client = new Client({ connectionString: uri })
      await client.connect()
      await migrate(drizzle({ client }), {
        migrationsFolder: new URL('../../../drizzle', import.meta.url).pathname,
      })
      await client.end()
    })
    return { uri }
  }),
)

// ─────────────────────────────────────────────────────────────────────────────
// Test fixtures: two independent pods, each with its own leader lock service
// ─────────────────────────────────────────────────────────────────────────────

const leaderPodLayer = PostgresAdvisoryLeaderLockLive.pipe(
  Layer.provideMerge(LeaderElectionDbLiveWithoutDependencies),
  Layer.provideMerge(Layer.effect(
    LeaderElectionDbConfig,
    Effect.map(PgContainer, ({ uri }) => ({
      databaseUrl: Redacted.make(uri),
      maxConnections: TEST_POOL_MAX_CONNECTIONS,
      idleTimeout: Duration.seconds(10),
      connectTimeout: Duration.seconds(5),
      keepalivesIdle: Duration.seconds(10),
      keepalivesInterval: Duration.seconds(5),
      keepalivesCount: 3,
    })),
  )),
  Layer.provideMerge(
    Layer.succeed(PostgresAdvisoryLeaderLockServiceConfig, { podId: 'test-pod', reaperInterval: Duration.seconds(60) }),
  ),
  Layer.provideMerge(DaemonReporter.Noop),
)

class Leader extends Context.Tag('test/Leader')<Leader, Context.Tag.Service<typeof LeaderLock>>() {}
class Challenger extends Context.Tag('test/Challenger')<Challenger, Context.Tag.Service<typeof LeaderLock>>() {}

const podLayer = <T>(tag: Context.Tag<T, Context.Tag.Service<typeof LeaderLock>>) =>
  Layer.effect(tag, LeaderLock).pipe(Layer.provide(Layer.fresh(leaderPodLayer)))

// ─────────────────────────────────────────────────────────────────────────────
// SQL helpers: raw admin connection for direct database manipulation
// ─────────────────────────────────────────────────────────────────────────────

const adminConnection = Effect.gen(function*() {
  const { uri } = yield* PgContainer
  return yield* Effect.acquireRelease(
    Effect.promise(async () => {
      const c = new Client({ connectionString: uri })
      c.on('error', () => {})
      await c.connect()
      return c
    }),
    (c) => Effect.tryPromise(() => c.end()).pipe(Effect.ignore),
  )
})

const sql = (text: string, params: ReadonlyArray<unknown> = []) =>
  Effect.gen(function*() {
    const c = yield* adminConnection
    return yield* Effect.tryPromise(() => c.query<Record<string, unknown>>(text, params as Array<unknown>))
  })

// ─────────────────────────────────────────────────────────────────────────────
// Bloat helpers: create dead row versions and measure vacuum reclamation
// ─────────────────────────────────────────────────────────────────────────────

const createBloatTable = (table: string) =>
  Effect.gen(function*() {
    yield* sql(`CREATE TABLE ${table} (id INT) WITH (autovacuum_enabled = false)`)
    yield* sql(`INSERT INTO ${table} SELECT generate_series(1, 1000)`)
  })

const updateAllRows = (table: string) => sql(`UPDATE ${table} SET id = id + 1`)

const DeadRowCountResult = Schema.Struct({ dead: Schema.NumberFromString })

const vacuumAndCountDeadRowVersions = (table: string) =>
  Effect.gen(function*() {
    yield* sql(`VACUUM ${table}`)
    const result = yield* sql(`SELECT n_dead_tup::text AS dead FROM pg_stat_user_tables WHERE relname = $1`, [table])
    const decoded = yield* Schema.decodeUnknown(DeadRowCountResult)(result.rows[0]).pipe(Effect.orDie)
    return decoded.dead
  })

// ─────────────────────────────────────────────────────────────────────────────
// Lock helpers
// ─────────────────────────────────────────────────────────────────────────────

const acquireLockAs = <T>(pod: Context.Tag<T, Context.Tag.Service<typeof LeaderLock>>, key: string) =>
  Effect.gen(function*() {
    const lock = yield* pod
    const acquired = yield* Deferred.make<void, unknown>()
    const hold = yield* Deferred.make<void>()
    const fiber = yield* Effect.forkScoped(
      lock.withLock(
        key,
        Effect.gen(function*() {
          yield* Deferred.succeed(acquired, undefined)
          yield* Deferred.await(hold)
        }),
      ).pipe(Effect.onError((cause) => Deferred.fail(acquired, Cause.squash(cause)))),
    )
    yield* Deferred.await(acquired)
    return fiber
  })

const tryAcquireAs = <T>(
  pod: Context.Tag<T, Context.Tag.Service<typeof LeaderLock>>,
  key: string,
  timeout: Duration.Duration = Duration.millis(500),
) =>
  Effect.gen(function*() {
    const lock = yield* pod
    return yield* lock.withLock(key, Effect.succeed(true)).pipe(
      Effect.timeoutOption(timeout),
      Effect.map((outer) => outer.pipe((opt) => opt._tag === 'Some' && opt.value._tag === 'Some')),
    )
  })

const leaderScenarioLayer = Layer.mergeAll(podLayer(Leader), podLayer(Challenger)).pipe(
  Layer.provideMerge(pgContainerLayer),
  Layer.orDie,
)

const feature = makeFeature({ it, layer })

feature('Leader election lock', { concurrent: true })
  .withScenarioLayer(leaderScenarioLayer)
  .withScope({})
  .liveClock()
  .body(({ scenario, scope }) => {
    scenario(
      'a contending challenger does not obstruct routine database maintenance',
      scope.pipe(
        Given('a leader holds the election lock')('leaderFiber', () => acquireLockAs(Leader, 'mutex-test')),
        And('a challenger repeatedly attempts to acquire the same lock')(() =>
          Effect.gen(function*() {
            const challenger = yield* Challenger
            yield* Effect.forkScoped(
              challenger.withLock('mutex-test', Effect.void).pipe(
                Effect.repeat(Schedule.spaced(Duration.millis(50))),
              ),
            )
          })
        ),
        And('a table has dead row versions')(() =>
          Effect.gen(function*() {
            yield* createBloatTable('mutex_bloat')
            yield* updateAllRows('mutex_bloat')
          })
        ),
        When('the database reclaims dead row versions')(
          'remainingDead',
          () => vacuumAndCountDeadRowVersions('mutex_bloat'),
        ),
        Then('the dead row versions are reclaimed')(({ remainingDead }) => {
          expect(remainingDead).toBe(0)
        }),
        And('the leader steps down')(({ leaderFiber }) => Fiber.interrupt(leaderFiber)),
      ),
    )

    scenario(
      'leadership transfers when the current leader stops',
      scope.pipe(
        Given('a leader holds the election lock')(
          'leaderFiber',
          () => acquireLockAs(Leader, 'failover-test'),
        ),
        When('the leader stops')(
          'acquired',
          ({ leaderFiber }) =>
            Effect.gen(function*() {
              yield* Fiber.interrupt(leaderFiber)
              return yield* tryAcquireAs(Challenger, 'failover-test', Duration.seconds(2))
            }),
        ),
        Then('a challenger acquires the lock')(({ acquired }) => {
          expect(acquired).toBe(true)
        }),
      ),
    )
  })

describe('Advisory lock MVCC safety', () => {
  const holdTransactionLevelLock = (key: string) =>
    Effect.gen(function*() {
      const c = yield* adminConnection
      yield* Effect.tryPromise(() => c.query('BEGIN'))
      yield* Effect.tryPromise(() => c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [key]))
    })

  it.scopedLive('Should_BlockVacuumReclamation_When_TransactionLockHeld', () =>
    Effect.gen(function*() {
      yield* createBloatTable('control_bloat')
      yield* holdTransactionLevelLock('control-bloat-test')
      yield* updateAllRows('control_bloat')
      const remainingDead = yield* vacuumAndCountDeadRowVersions('control_bloat')
      expect(remainingDead).toBeGreaterThan(0)
    }).pipe(
      Effect.provide(pgContainerLayer),
    ))

  it.scopedLive('Should_BlockVacuumReclamation_When_BlockingLockWaiterUsesExtendedProtocol', () =>
    Effect.gen(function*() {
      const holder = yield* adminConnection
      yield* Effect.tryPromise(() => holder.query(`SELECT pg_advisory_lock(hashtext('blocker-test'))`))
      const waiter = yield* adminConnection
      yield* Effect.forkScoped(
        Effect.tryPromise(() => waiter.query('SELECT pg_advisory_lock(hashtext($1))', ['blocker-test'])),
      )
      yield* Effect.sleep(Duration.millis(200))
      yield* createBloatTable('blocker_bloat')
      yield* updateAllRows('blocker_bloat')
      const remainingDead = yield* vacuumAndCountDeadRowVersions('blocker_bloat')
      expect(remainingDead).toBeGreaterThan(0)
    }).pipe(
      Effect.provide(pgContainerLayer),
    ))
})
