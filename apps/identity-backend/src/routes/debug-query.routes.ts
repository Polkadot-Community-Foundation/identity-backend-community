import { DEBUG_PASSWORD, DEBUG_SQL_ENABLED, DEBUG_USERNAME } from '#root/config.js'
import { DB } from '#root/db/drizzle.js'
import { effectValidator } from '#root/lib/effect-validator.js'
import { sql } from 'drizzle-orm'
import {
  Clock,
  Config,
  Context,
  Duration,
  Effect,
  MutableHashMap,
  Option,
  Redacted,
  Runtime,
  Schema as S,
} from 'effect'
import { Hono } from 'hono'
import { basicAuth } from 'hono/basic-auth'

const DebugQueryBody = S.Struct({
  query: S.NonEmptyTrimmedString,
})

export class DebugQueryConfig extends Context.Reference<DebugQueryConfig>()(
  'DebugQueryConfig',
  {
    defaultValue: () => ({
      rateLimitWindow: Duration.seconds(5),
      rateLimitMax: 6,
      statementTimeout: Duration.seconds(5),
    }),
  },
) {}

export const makeDebugQueryRoute = Effect.gen(function*() {
  const enabled = yield* DEBUG_SQL_ENABLED
  if (!enabled) return new Hono().post('/', (c) => c.notFound())

  const db = yield* DB
  const config = yield* DebugQueryConfig
  const [username, password] = yield* Config.all([DEBUG_USERNAME, DEBUG_PASSWORD])
  const runtime = yield* Effect.runtime<never>()
  const nowMillis = (): number => Runtime.runSync(runtime)(Clock.currentTimeMillis)

  const windowMs = Duration.toMillis(config.rateLimitWindow)
  const timeoutSeconds = Duration.toSeconds(config.statementTimeout)
  const ipHits = MutableHashMap.empty<string, number[]>()

  const isRateLimited = (ip: string): boolean => {
    const now = nowMillis()
    const hits = Option.getOrElse(MutableHashMap.get(ipHits, ip), (): number[] => [])
    const recent = hits.filter((t) => now - t < windowMs)
    recent.push(now)
    MutableHashMap.set(ipHits, ip, recent)
    return recent.length > config.rateLimitMax
  }

  return new Hono()
    .use(basicAuth({ username, password: Redacted.value(password) }))
    .post('/', effectValidator('json', DebugQueryBody), async (c) => {
      const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
      if (isRateLimited(ip)) {
        return c.json({ error: 'rate limit exceeded' }, 429)
      }

      const { query } = c.req.valid('json')

      try {
        const rows = await db.transaction(async (tx) => {
          await tx.execute(sql.raw('SET TRANSACTION READ ONLY'))
          await tx.execute(sql.raw(`SET LOCAL statement_timeout = '${timeoutSeconds}s'`))
          return tx.execute(sql.raw(query))
        })
        return c.json({ rows })
      } catch (err) {
        return c.json({ error: err instanceof Error ? err.message : 'query execution failed' }, 500)
      }
    })
})
