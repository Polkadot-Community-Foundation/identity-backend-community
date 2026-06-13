import { TokenBucketRateLimiter } from '#root/infrastructure/token-bucket-rate-limiter.service.js'
import { buildProblemDetail } from '#root/lib/problem-details.js'
import { GetConnInfo } from '#root/middleware/logger.js'
import { Config, Effect, Match, Metric, Option, Runtime } from 'effect'
import type { Context, MiddlewareHandler } from 'hono'
import { createMiddleware } from 'hono/factory'

const SECONDS_PER_MINUTE = 60
const UNKNOWN_IP = 'unknown'

type RateLimitProfile = 'shared-nat' | 'global'
type KeyStrategy = 'per-jwt' | 'per-ip-in-global' | 'jwt-or-ip-in-global'

interface RateLimitEnv {
  Variables: {
    jwtSub?: string
  }
}

interface ResolvedClass {
  readonly className: string
  readonly strategy: KeyStrategy
  readonly retryAfterSeconds: number
  readonly config: TokenBucketRateLimiter.TryConsumeConfig
}

export const perInstanceCapacity = (input: {
  readonly overallPerMinute: number
  readonly podDivisor: number
}): TokenBucketRateLimiter.TryConsumeConfig => {
  const bucketSize = Math.ceil(input.overallPerMinute / input.podDivisor)
  return { bucketSize, tokensPerSec: bucketSize / SECONDS_PER_MINUTE }
}

export const rateLimitDecisions = Metric.counter('app.rate_limit.decisions', {
  description: 'Rate-limit decisions by class and outcome',
})

export const outcomeLabel = (allowed: boolean): 'allowed' | 'blocked' =>
  Match.value(allowed).pipe(
    Match.when(true, () => 'allowed' as const),
    Match.when(false, () => 'blocked' as const),
    Match.exhaustive,
  )

const recordDecision = (className: string, allowed: boolean) =>
  Metric.update(
    rateLimitDecisions.pipe(
      Metric.tagged('class', className),
      Metric.tagged('outcome', outcomeLabel(allowed)),
    ),
    1,
  )

const jwtKey = (
  className: string,
  jwtSub: string,
  ip: string,
): readonly string[] => [className, 'jwt', jwtSub, 'ip', ip]
const ipKey = (className: string, ip: string): readonly string[] => [className, 'ip', ip]

export const selectFingerprint = (input: {
  readonly className: string
  readonly strategy: KeyStrategy
  readonly profile: RateLimitProfile
  readonly jwtSub: Option.Option<string>
  readonly ip: string
}): Option.Option<readonly string[]> => {
  const ipWhenGlobal = Match.value(input.profile).pipe(
    Match.when('global', () => Option.some(ipKey(input.className, input.ip))),
    Match.when('shared-nat', () => Option.none<readonly string[]>()),
    Match.exhaustive,
  )
  return Match.value(input.strategy).pipe(
    Match.when('per-jwt', () => Option.map(input.jwtSub, (jwtSub) => jwtKey(input.className, jwtSub, input.ip))),
    Match.when('per-ip-in-global', () => ipWhenGlobal),
    Match.when(
      'jwt-or-ip-in-global',
      () =>
        Option.match(input.jwtSub, {
          onNone: () => ipWhenGlobal,
          onSome: (jwtSub) => Option.some(jwtKey(input.className, jwtSub, input.ip)),
        }),
    ),
    Match.exhaustive,
  )
}

const presentString = (value: string | undefined): Option.Option<string> =>
  Option.fromNullable(value).pipe(
    Option.map((raw) => raw.trim()),
    Option.filter((trimmed) => trimmed.length > 0),
  )

const firstForwardedHop = (xForwardedFor: string | undefined): Option.Option<string> =>
  Option.fromNullable(xForwardedFor).pipe(
    Option.flatMap((header) => presentString(header.split(',')[0])),
  )

export const extractClientIp = (input: {
  readonly cfConnectingIp: string | undefined
  readonly xForwardedFor: string | undefined
  readonly fallback: string
}): string =>
  presentString(input.cfConnectingIp).pipe(
    Option.orElse(() => firstForwardedHop(input.xForwardedFor)),
    Option.getOrElse(() => input.fallback),
  )

const tooManyRequests = (c: Context, retryAfterSeconds: number) =>
  c.json(
    buildProblemDetail({
      slug: 'too-many-requests',
      title: 'Too Many Requests',
      status: 429,
      detail: `Rate limit exceeded. Please retry after ${retryAfterSeconds} seconds.`,
    }),
    429,
    { 'Content-Type': 'application/problem+json', 'Retry-After': String(retryAfterSeconds) },
  )

export const makeRateLimit = Effect.gen(function*() {
  const limiter = yield* TokenBucketRateLimiter
  const getConnInfo = yield* GetConnInfo
  const runtime = yield* Effect.runtime()

  const cfg = yield* Effect.promise(() => import('#root/config.js'))
  const limits = yield* Config.all({
    profile: cfg.RATE_LIMIT_PROFILE,
    podDivisor: cfg.RATE_LIMIT_POD_DIVISOR,
    authActions: cfg.RATE_LIMIT_AUTH_ACTIONS,
    registration: cfg.RATE_LIMIT_REGISTRATION,
    publicReads: cfg.RATE_LIMIT_PUBLIC_READS,
  })

  const klass = (
    className: string,
    overallPerMinute: number,
    strategy: KeyStrategy,
    retryAfterSeconds: number,
  ): ResolvedClass => ({
    className,
    strategy,
    retryAfterSeconds,
    config: perInstanceCapacity({ overallPerMinute, podDivisor: limits.podDivisor }),
  })

  const makeHandler = (resolved: ResolvedClass): MiddlewareHandler<RateLimitEnv> =>
    createMiddleware<RateLimitEnv>(async (c, next) => {
      const ip = extractClientIp({
        cfConnectingIp: c.req.header('cf-connecting-ip'),
        xForwardedFor: c.req.header('x-forwarded-for'),
        fallback: getConnInfo(c).remote.address ?? UNKNOWN_IP,
      })

      const fingerprint = selectFingerprint({
        className: resolved.className,
        strategy: resolved.strategy,
        profile: limits.profile,
        jwtSub: Option.fromNullable(c.get('jwtSub')),
        ip,
      })

      return Option.match(fingerprint, {
        onNone: () => next(),
        onSome: async (consumeKey) => {
          const allowed = await limiter.tryConsume(consumeKey, resolved.config).pipe(
            Effect.tap((ok) => recordDecision(resolved.className, ok)),
            Runtime.runPromise(runtime),
          )
          return Match.value(allowed).pipe(
            Match.when(true, () => next()),
            Match.when(false, () => tooManyRequests(c, resolved.retryAfterSeconds)),
            Match.exhaustive,
          )
        },
      })
    })

  return {
    authActions: makeHandler(klass('auth-actions', limits.authActions, 'per-jwt', 60)),
    registration: makeHandler(klass('registration', limits.registration, 'per-jwt', 60)),
    publicReads: makeHandler(klass('public-reads', limits.publicReads, 'per-ip-in-global', 30)),
    search: makeHandler(klass('search', limits.authActions, 'jwt-or-ip-in-global', 60)),
  }
})
