import { DB, DBLiveConfig, DBLiveWithoutDependencies, WebDbPoolConfig } from '#root/db/drizzle.js'
import { it } from '@effect/vitest'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { sql } from 'drizzle-orm'
import { Duration, Effect, Layer, pipe, Redacted } from 'effect'
import { GenericContainer, Network, type StartedNetwork, type StartedTestContainer, Wait } from 'testcontainers'
import type { Proxy as ToxiProxy, Toxiproxy } from 'toxiproxy-node-client'
import { afterAll, beforeAll, describe, expect } from 'vitest'

const PG_ALIAS = 'pg'
const TOXIPROXY_API_PORT = 8474
const PROXY_PORT_BASE = 15_000

let network: StartedNetwork
let pgContainer: StartedPostgreSqlContainer
let toxiproxyContainer: StartedTestContainer
let toxiClient: Toxiproxy
const proxies: Array<{ proxy: ToxiProxy; url: string }> = []

beforeAll(async () => {
  network = await new Network().start()

  pgContainer = await new PostgreSqlContainer('postgres:18-alpine')
    .withNetwork(network)
    .withNetworkAliases(PG_ALIAS)
    .start()

  const proxyCount = 2
  const exposedPorts = Array.from({ length: proxyCount }, (_, i) => PROXY_PORT_BASE + i)

  toxiproxyContainer = await new GenericContainer('shopify/toxiproxy')
    .withNetwork(network)
    .withExposedPorts(TOXIPROXY_API_PORT, ...exposedPorts)
    .withWaitStrategy(Wait.forLogMessage('API HTTP server starting'))
    .start()

  const { Toxiproxy } = await import('toxiproxy-node-client')
  const toxiApiHost = toxiproxyContainer.getHost()
  const toxiApiPort = toxiproxyContainer.getMappedPort(TOXIPROXY_API_PORT)
  toxiClient = new Toxiproxy(`http://${toxiApiHost}:${toxiApiPort}`)

  for (let i = 0; i < proxyCount; i++) {
    const port = PROXY_PORT_BASE + i
    const proxy = await toxiClient.createProxy({
      name: `pg_${i}`,
      listen: `0.0.0.0:${port}`,
      upstream: `${PG_ALIAS}:5432`,
    })
    const mappedPort = toxiproxyContainer.getMappedPort(port)
    const url =
      `postgres://${pgContainer.getUsername()}:${pgContainer.getPassword()}@${toxiApiHost}:${mappedPort}/${pgContainer.getDatabase()}`
    proxies.push({ proxy, url })
  }
}, 120_000)

afterAll(async () => {
  await toxiproxyContainer?.stop()
  await pgContainer?.stop()
  await network?.stop()
})

const proxyLayerFor = (index: number, overrides?: Partial<WebDbPoolConfig['Type']>) =>
  pipe(
    DBLiveWithoutDependencies,
    Layer.provide(Layer.succeed(DBLiveConfig, { databaseUrl: Redacted.make(proxies[index]!.url) })),
    Layer.provide(Layer.succeed(WebDbPoolConfig, {
      max: 10,
      idleTimeout: Duration.seconds(3),
      maxLifetime: Duration.seconds(30),
      connectTimeout: Duration.seconds(5),
      keepAlive: Duration.seconds(5),
      socketTimeout: Duration.seconds(5),
      statementTimeout: Duration.seconds(30),
      lockTimeout: Duration.seconds(5),
      idleInTransactionTimeout: Duration.seconds(60),
      ...overrides,
    })),
  )

describe.concurrent('Web pool — proxy stall recovery', () => {
  it.scopedLive('Should_DestroyAndReconnect_When_ProxyStallsThenRecovers', () =>
    Effect.gen(function*() {
      const db = yield* DB
      const param = 1
      const before = yield* Effect.tryPromise(() => db.execute(sql`SELECT pg_backend_pid() AS pid, ${param} AS p`))
      const pidBefore = Number(before[0]?.pid)

      const toxic = yield* Effect.tryPromise(() =>
        proxies[0]!.proxy.addToxic({
          name: 'stall',
          type: 'timeout',
          stream: 'downstream',
          toxicity: 1.0,
          attributes: { timeout: 0 },
        })
      )

      yield* Effect.sleep('1 second')
      yield* Effect.tryPromise(() => toxic.remove())

      const param2 = 2
      const after = yield* Effect.tryPromise(() => db.execute(sql`SELECT pg_backend_pid() AS pid, ${param2} AS p`))
      const pidAfter = Number(after[0]?.pid)
      expect(pidAfter).not.toBe(pidBefore)
    }).pipe(Effect.provide(proxyLayerFor(0, { socketTimeout: Duration.millis(500) }))), { timeout: 10_000 })

  it.scopedLive.fails('Should_HangIndefinitely_When_StockPostgresJsHasNoSocketTimeout', () =>
    Effect.gen(function*() {
      const postgres = yield* Effect.promise(() => import('postgres')).pipe(Effect.map((mod) => mod.default))
      const client = postgres(proxies[1]!.url)

      const param = 1
      yield* Effect.tryPromise(() => client`SELECT pg_backend_pid() AS pid, ${param} AS p`)

      yield* Effect.tryPromise(() =>
        proxies[1]!.proxy.addToxic({
          name: 'stall_control',
          type: 'timeout',
          stream: 'downstream',
          toxicity: 1.0,
          attributes: { timeout: 0 },
        })
      )

      const param2 = 2
      yield* Effect.tryPromise(() => client`SELECT pg_backend_pid() AS pid, ${param2} AS p`)
    }), { timeout: 10_000 })
})
