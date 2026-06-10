import { DEBUG_HEAPDUMP_ENABLED } from '#root/config.js'
import { Effect } from 'effect'
import { Hono } from 'hono'
import { randomUUID } from 'node:crypto'
import { hostname } from 'node:os'

const PROCESS_HOSTNAME = hostname()
const PROCESS_BOOT_ID = randomUUID()
const PROCESS_PID = process.pid
const PROCESS_STARTED_AT = new Date().toISOString()

const makeEnabledRoute = () =>
  new Hono()
    .get('/', (c) => {
      const m = process.memoryUsage()
      return c.json({
        hostname: PROCESS_HOSTNAME,
        bootId: PROCESS_BOOT_ID,
        pid: PROCESS_PID,
        startedAt: PROCESS_STARTED_AT,
        uptimeSeconds: Math.round(process.uptime()),
        rss: m.rss,
        heapTotal: m.heapTotal,
        heapUsed: m.heapUsed,
        external: m.external,
        arrayBuffers: m.arrayBuffers,
      })
    })

const makeDisabledRoute = () => new Hono().get('/', (c) => c.notFound())

export const makeDebugMemoryRoute = Effect.gen(function* makeDebugMemoryRoute() {
  const enabled = yield* DEBUG_HEAPDUMP_ENABLED
  if (!enabled) return makeDisabledRoute()
  return makeEnabledRoute()
})
