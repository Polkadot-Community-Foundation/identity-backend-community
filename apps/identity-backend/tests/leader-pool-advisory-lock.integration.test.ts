import {
  LeaderElectionDb,
  LeaderElectionDbConfig,
  LeaderElectionDbLiveWithoutDependencies,
} from '#root/leader-election/pool.js'
import { it } from '@effect/vitest'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { Duration, Effect, Layer, pipe, Redacted } from 'effect'
import { GenericContainer, Network, type StartedNetwork, type StartedTestContainer, Wait } from 'testcontainers'
import type { Toxiproxy } from 'toxiproxy-node-client'
import { afterAll, beforeAll, describe, expect, vi } from 'vitest'

const PG_ALIAS = 'pg'
const TOXIPROXY_API_PORT = 8474
const PROXY_PORT_BASE = 16_000

let network: StartedNetwork
let pgContainer: StartedPostgreSqlContainer
let toxiproxyContainer: StartedTestContainer
let toxiClient: Toxiproxy
const proxies: Array<{ proxy: Awaited<ReturnType<Toxiproxy['createProxy']>>; url: string }> = []

beforeAll(async () => {
  network = await new Network().start()

  pgContainer = await new PostgreSqlContainer('postgres:18-alpine')
    .withNetwork(network)
    .withNetworkAliases(PG_ALIAS)
    .start()

  const proxyCount = 1
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
      name: `leader_pg_${i}`,
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

const leaderLayerFor = (index: number, overrides?: Partial<LeaderElectionDbConfig['Type']>) =>
  pipe(
    LeaderElectionDbLiveWithoutDependencies,
    Layer.provide(Layer.succeed(LeaderElectionDbConfig, {
      databaseUrl: Redacted.make(proxies[index]!.url),
      maxConnections: 5,
      idleTimeout: Duration.seconds(30),
      connectTimeout: Duration.seconds(12),
      keepalivesIdle: Duration.seconds(10),
      ...overrides,
    })),
  )

describe('Leader Election Pool — advisory lock resilience', () => {
  it.scopedLive('Should_LoseAdvisoryLock_When_ProxyKillsTcpConnection', () =>
    Effect.gen(function*() {
      const client = yield* LeaderElectionDb

      yield* client`SELECT pg_advisory_lock(33333)`

      const postgres = yield* Effect.promise(() => import('postgres')).pipe(Effect.map((mod) => mod.default))
      const observer = postgres(pgContainer.getConnectionUri())

      const beforeRows = yield* Effect.tryPromise(() => observer`SELECT pg_try_advisory_lock(33333) AS acquired`)
      expect(beforeRows[0]?.acquired).toBe(false)

      yield* Effect.tryPromise(() =>
        proxies[0]!.proxy.update({
          enabled: false,
          listen: proxies[0]!.proxy.listen,
          upstream: proxies[0]!.proxy.upstream,
        })
      )

      yield* Effect.promise(() =>
        vi.waitFor(async () => {
          const rows = await observer`SELECT pg_try_advisory_lock(33333) AS acquired`
          expect(rows[0]?.acquired).toBe(true)
        }, { interval: 200, timeout: 8_000 })
      )

      yield* Effect.tryPromise(() =>
        proxies[0]!.proxy.update({
          enabled: true,
          listen: proxies[0]!.proxy.listen,
          upstream: proxies[0]!.proxy.upstream,
        })
      )

      yield* Effect.tryPromise(() => observer`SELECT pg_advisory_unlock_all()`)
      yield* Effect.tryPromise(() => observer.end())
    }).pipe(Effect.provide(leaderLayerFor(0))), { timeout: 10_000 })
})
