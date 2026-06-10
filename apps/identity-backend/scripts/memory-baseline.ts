import { BunRuntime } from '@effect/platform-bun'
import { layerWebSocketConstructor } from '@effect/platform-bun/BunSocket'
import { PolkadotClient } from '@identity-backend/json-rpc'
import { Console, Duration, Effect, Layer, Schedule } from 'effect'

const fmt = (n: number) => `${(n / 1024 / 1024).toFixed(1).padStart(7)} MiB`

const sample = (label: string) =>
  Effect.sync(() => {
    const m = process.memoryUsage()
    const uptime = process.uptime()
    console.log(
      `[${uptime.toFixed(1).padStart(7)}s] ${label.padEnd(28)} ` +
        `rss=${fmt(m.rss)}  heap=${fmt(m.heapUsed)}  ext=${fmt(m.external)}  arr=${fmt(m.arrayBuffers)}`,
    )
  })

const program = Effect.gen(function*() {
  yield* sample('cold start')

  const descriptors = yield* Effect.promise(() => import('@identity-backend/descriptors'))
  yield* sample('after descriptor import')

  const endpoint = Bun.env.PEOPLE_RPC_ENDPOINT ?? 'wss://paseo-people-next-rpc.polkadot.io'
  yield* Console.log(`Connecting to ${endpoint}`)

  const client = yield* PolkadotClient.make({
    endpoints: [endpoint],
    heartbeatTimeout: 30_000,
    network: process.env.PEOPLE_NETWORK ?? 'paseo',
    chain: 'people',
  })
  yield* sample('after client created')

  const typedApi = client.getTypedApi(descriptors.pop_testnet)
  yield* sample('after typed api bound')

  const _ = typedApi

  const subscription = client.finalizedBlock$.subscribe({
    next: () => {},
    error: (err) => console.error('subscription error', err),
  })
  yield* Effect.addFinalizer(() => Effect.sync(() => subscription.unsubscribe()))
  yield* sample('subscription active')

  const { Hono } = yield* Effect.promise(() => import('hono'))
  yield* sample('after hono import')

  const app = new Hono()
    .get('/', (c) => c.text('ok'))
    .get('/healthcheck', (c) => c.json({ ok: true }))
    .get('/mem', (c) => c.json(process.memoryUsage()))

  const port = Number(Bun.env.PORT ?? 3001)
  const server = yield* Effect.acquireRelease(
    Effect.sync(() => Bun.serve({ port, fetch: app.fetch })),
    (s) => Effect.sync(() => s.stop()),
  )
  yield* Console.log(`Server listening on ${server.url}`)
  yield* sample('after server listening')

  yield* sample('steady-state').pipe(
    Effect.repeat(Schedule.spaced(Duration.seconds(5))),
  )
})

const layer = Layer.scopedDiscard(program).pipe(
  Layer.provide(layerWebSocketConstructor),
)

BunRuntime.runMain(Layer.launch(layer))
