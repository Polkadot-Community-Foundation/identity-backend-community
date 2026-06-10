import * as schema from '#root/db/schema.js'
import { PgClient } from '@effect/sql-pg/PgClient'
import { expect, it, layer } from '@effect/vitest'
import { DaemonReporter } from '@identity-backend/effect-daemon-spec'
import { And, Given, makeFeature, Then, When } from '@identity-backend/effect-vitest-gherkin'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { eq } from 'drizzle-orm'
import * as PgDrizzle from 'drizzle-orm/effect-postgres'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Duration, Effect, Layer, Redacted } from 'effect'
import { Client } from 'pg'
import { afterAll, beforeAll, beforeEach } from 'vitest'
import { LeaderElectionDb, LeaderElectionDbConfig, LeaderElectionDbLiveWithoutDependencies } from '../pool.js'
import { PostgresAdvisoryLeaderLockServiceConfig } from '../postgres-advisory-lock.service.js'
import { reaperDaemon } from '../reaper.daemon.js'

const ALPHA = 'alpha'
const GAMMA = 'gamma'
const GHOST = 'reaper-stale-key'

const REAPER_INTERVAL = Duration.millis(100)
const POOL_MAX = 4

let container: StartedPostgreSqlContainer
let uri = ''

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:18-alpine').start()
  uri = container.getConnectionUri()
  const client = new Client({ connectionString: uri })
  await client.connect()
  await migrate(drizzle({ client }), { migrationsFolder: new URL('../../../drizzle', import.meta.url).pathname })
  await client.end()
}, 60_000)

afterAll(async () => {
  await container?.stop()
})

beforeEach(async () => {
  const client = new Client({ connectionString: uri })
  await client.connect()
  await drizzle({ client }).delete(schema.leaderElection)
  await client.end()
})

const dbLayer = LeaderElectionDbLiveWithoutDependencies.pipe(
  Layer.provideMerge(Layer.sync(LeaderElectionDbConfig, () => ({
    databaseUrl: Redacted.make(uri),
    maxConnections: POOL_MAX,
    idleTimeout: Duration.seconds(10),
    connectTimeout: Duration.seconds(5),
    keepalivesIdle: Duration.seconds(10),
  }))),
)

const reaperScenarioLayer = reaperDaemon.pipe(
  Layer.provideMerge(dbLayer),
  Layer.provideMerge(
    Layer.succeed(PostgresAdvisoryLeaderLockServiceConfig, {
      podId: 'reaper-test-pod',
      reaperInterval: REAPER_INTERVAL,
    }),
  ),
  Layer.provideMerge(DaemonReporter.Noop),
  Layer.orDie,
)

const withDb = <A, E, R>(
  f: (db: PgDrizzle.EffectPgDatabase<{ leaderElection: typeof schema.leaderElection }>) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R | LeaderElectionDb> =>
  Effect.gen(function*() {
    const pgClient = yield* LeaderElectionDb
    const db = yield* PgDrizzle.makeWithDefaults({ schema: { leaderElection: schema.leaderElection } }).pipe(
      Effect.provide(Layer.effect(PgClient, Effect.succeed(pgClient))),
    )
    return yield* f(db)
  })

const recordFor = (key: string) =>
  withDb((db) => db.insert(schema.leaderElection).values({ key, holder: 'former-leader' }))

const recordsFor = (key: string) =>
  withDb((db) => db.select().from(schema.leaderElection).where(eq(schema.leaderElection.key, key)))

const allRecords = withDb((db) => db.select().from(schema.leaderElection))

const takePost = (key: string) =>
  Effect.tryPromise({
    try: async () => {
      const c = new Client({ connectionString: uri })
      await c.connect()
      const r = await c.query<{ held: boolean }>('SELECT pg_try_advisory_lock(hashtext($1)) AS held', [key])
      if (r.rows[0]?.held !== true) throw new Error(`could not take post ${key}`)
      return c
    },
    catch: (cause) => new Error('post session failed', { cause }),
  })

const holdPost = (key: string) => Effect.acquireRelease(takePost(key), (c) => Effect.promise(() => c.end()))

const keyHashSign = (key: string) =>
  Effect.tryPromise(async () => {
    const c = new Client({ connectionString: uri })
    await c.connect()
    const r = await c.query<{ negative: boolean }>('SELECT hashtext($1) < 0 AS negative', [key])
    await c.end()
    return r.rows[0]?.negative === true ? 'negative' : 'positive'
  })

const expectKeyHashes = (key: string, sign: string) =>
  keyHashSign(key).pipe(Effect.map((actual) => expect(actual).toBe(sign)))

const waitFor = <E, R>(
  check: Effect.Effect<boolean, E, R>,
  options: { readonly interval: Duration.DurationInput; readonly timeout: Duration.DurationInput },
): Effect.Effect<void, E | Error, R> => {
  const deadline = Date.now() + Duration.toMillis(options.timeout)
  const loop = (): Effect.Effect<void, E | Error, R> =>
    Effect.gen(function*() {
      if (yield* check) return
      if (Date.now() >= deadline) return yield* Effect.fail(new Error('waitFor: timeout'))
      yield* Effect.sleep(options.interval)
      return yield* loop()
    })
  return loop()
}

const recordRemoved = (key: string) =>
  waitFor(recordsFor(key).pipe(Effect.map((rows) => rows.length === 0)), {
    interval: Duration.millis(50),
    timeout: Duration.seconds(5),
  })

const recordKept = (key: string) => recordsFor(key).pipe(Effect.map((rows) => expect(rows.length).toBe(1)))

const feature = makeFeature({ it, layer })

feature('Leader-election reaper')
  .withScenarioLayer(reaperScenarioLayer)
  .withScope({})
  .liveClock()
  .body(({ scenario, scenarioOutline, scope }) => {
    scenario(
      'a leader that steps down has its stale record cleaned up',
      scope.pipe(
        Given('"Gamma" was elected leader and recorded it')(
          'gammaPost',
          () => takePost(GAMMA).pipe(Effect.tap(() => recordFor(GAMMA))),
        ),
        When('"Gamma" steps down from the post')(({ gammaPost }) => Effect.promise(() => gammaPost.end())),
        Then("the reaper removes Gamma's stale record")(() => recordRemoved(GAMMA)),
      ),
    )

    scenarioOutline(
      'a leader keeps its record while it still holds the post (key hashes <hash>)',
      [{ hash: 'positive', leader: 'Alpha', key: ALPHA }, { hash: 'negative', leader: 'Gamma', key: GAMMA }],
      (row) =>
        scope.pipe(
          Given(`${row.leader}'s lock key hashes ${row.hash}`)(() => expectKeyHashes(row.key, row.hash)),
          And(`${row.leader} holds the leadership post and recorded it`)(() =>
            holdPost(row.key).pipe(Effect.zipRight(recordFor(row.key)))
          ),
          And('a departed leader "Ghost" left a stale record behind')(() => recordFor(GHOST)),
          When("the reaper removes Ghost's stale record")(() => recordRemoved(GHOST)),
          Then(`${row.leader}'s leadership record is kept`)(() => recordKept(row.key)),
        ),
    )

    scenario(
      'the reaper keeps running when there is nothing to clean up',
      scope.pipe(
        Given('no leadership records exist')(() => allRecords.pipe(Effect.map((rows) => expect(rows.length).toBe(0)))),
        When('a departed leader leaves a stale record behind')(() => recordFor(GHOST)),
        Then('the reaper removes it')(() => recordRemoved(GHOST)),
      ),
    )
  })
