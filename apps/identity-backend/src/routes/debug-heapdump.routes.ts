import {
  DEBUG_HEAPDUMP_COOLDOWN_SECONDS,
  DEBUG_HEAPDUMP_ENABLED,
  DEBUG_PASSWORD,
  DEBUG_USERNAME,
} from '#root/config.js'
import { Clock, Config, Effect, Redacted, Runtime } from 'effect'
import { Hono } from 'hono'
import { basicAuth } from 'hono/basic-auth'
import { stream } from 'hono/streaming'
import { randomUUID } from 'node:crypto'
import { hostname } from 'node:os'

const SAFE_LABEL = /^[a-zA-Z0-9_-]{1,64}$/

const PROCESS_HOSTNAME = hostname()
const PROCESS_BOOT_ID = randomUUID()
const PROCESS_PID = process.pid
const PROCESS_STARTED_AT = new Date().toISOString()

let inFlight = false
let lastCompletedAt = 0

const makeEnabledRoute = (
  auth: { username: string; password: string },
  cooldownMs: number,
  getHeapSnapshot: () => NodeJS.ReadableStream,
  nowMillis: () => number,
) =>
  new Hono()
    .use(basicAuth(auth))
    .get('/', (c) => {
      c.header('X-Heapdump-Hostname', PROCESS_HOSTNAME)
      c.header('X-Heapdump-Boot-Id', PROCESS_BOOT_ID)
      c.header('X-Heapdump-Pid', String(PROCESS_PID))
      c.header('X-Heapdump-Started-At', PROCESS_STARTED_AT)

      const label = c.req.query('label') ?? 'snap'
      if (!SAFE_LABEL.test(label)) {
        return c.json({ error: 'invalid label; allowed: [a-zA-Z0-9_-]{1,64}' }, 400)
      }

      const now = nowMillis()
      const sinceLast = now - lastCompletedAt
      if (sinceLast < cooldownMs) {
        const retryAfter = Math.ceil((cooldownMs - sinceLast) / 1000)
        c.header('Retry-After', String(retryAfter))
        return c.json({ error: 'cooldown active', retryAfterSeconds: retryAfter }, 429)
      }

      if (inFlight) {
        return c.json({ error: 'a heap snapshot is already being generated' }, 429)
      }
      inFlight = true

      const filename = `${PROCESS_HOSTNAME}-${PROCESS_BOOT_ID}-${now}-${label}.heapsnapshot`
      c.header('Content-Type', 'application/json')
      c.header('Content-Disposition', `attachment; filename="${filename}"`)

      return stream(c, async (s) => {
        try {
          for await (const chunk of getHeapSnapshot()) {
            await s.write(chunk)
          }
          lastCompletedAt = nowMillis()
        } finally {
          inFlight = false
        }
      })
    })

const makeDisabledRoute = () => new Hono().get('/', (c) => c.notFound())

export const makeDebugHeapdumpRoute = Effect.gen(function* makeDebugHeapdumpRoute() {
  const enabled = yield* DEBUG_HEAPDUMP_ENABLED
  if (!enabled) return makeDisabledRoute()
  const [username, password, cooldownSec] = yield* Config.all([
    DEBUG_USERNAME,
    DEBUG_PASSWORD,
    DEBUG_HEAPDUMP_COOLDOWN_SECONDS,
  ])
  const { getHeapSnapshot } = yield* Effect.promise(() => import('node:v8'))
  const runtime = yield* Effect.runtime<never>()
  const nowMillis = (): number => Runtime.runSync(runtime)(Clock.currentTimeMillis)
  return makeEnabledRoute(
    { username, password: Redacted.value(password) },
    cooldownSec * 1000,
    getHeapSnapshot,
    nowMillis,
  )
})
