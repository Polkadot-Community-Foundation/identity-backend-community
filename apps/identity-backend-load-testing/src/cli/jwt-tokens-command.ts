import { FileSystem, HttpClient, HttpClientRequest, HttpClientResponse, Path } from '@effect/platform'
import { PlatformError } from '@effect/platform/Error'
import { get as headersGet } from '@effect/platform/Headers'
import type { HttpClientError } from '@effect/platform/HttpClientError'
import { buildClientProof } from '@identity-backend/people-lite-fixtures'
import {
  Clock,
  Console,
  DateTime,
  Duration,
  Effect,
  Either,
  HashMap,
  Match,
  Option,
  ParseResult,
  Ref,
  Schedule,
  ScheduleDecision,
  ScheduleInterval,
  Schema,
} from 'effect'
import { parseRegisterPayloads, type RegisterEntry } from './parser.js'
import { DEFAULT_FILES, ensureParentDir, readEnvPath } from './paths.js'

export interface JwtTokensArgs {
  readonly baseUrl: string
  readonly in: string
  readonly out: string
  readonly limit: number
}

interface JwtToken {
  who: string
  token: string
}

const TOKEN_BODY = '{}'

const ChallengeSchema = Schema.Struct({ challenge: Schema.String })
const TokenSchema = Schema.Struct({ token: Schema.String })

const TOO_MANY_REQUESTS = 429
const MAX_BACKOFF_MS = 60_000
const DEFAULT_BACKOFF_MS = 1_000
const PERCENT_GRANULARITY = 1
const HEARTBEAT_MS = 30_000
const MAX_DISTINCT_FAILURE_SAMPLES = 5

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

const acceptStatus = (status: number) => status === 200 || status === 201

function retryAfterMs(error: HttpClientError | ParseResult.ParseError, nowMs: number): number | null {
  return Match.valueTags(error, {
    ResponseError: (e) => {
      if (e.response.status !== TOO_MANY_REQUESTS) return null
      const raw = Option.getOrUndefined(headersGet(e.response.headers, 'retry-after'))
      if (raw === undefined || raw.length === 0) return DEFAULT_BACKOFF_MS
      const asNumber = Number(raw)
      if (Number.isFinite(asNumber) && asNumber >= 0) {
        return Math.min(asNumber * 1_000, MAX_BACKOFF_MS)
      }
      const asDate = Date.parse(raw)
      if (Number.isFinite(asDate)) {
        return Math.min(Math.max(0, asDate - nowMs), MAX_BACKOFF_MS)
      }
      return DEFAULT_BACKOFF_MS
    },
    RequestError: () => null,
    ParseError: () => null,
  })
}

function isTooManyRequests(error: HttpClientError | ParseResult.ParseError): boolean {
  return Match.valueTags(error, {
    ResponseError: (e) => e.response.status === TOO_MANY_REQUESTS,
    RequestError: () => false,
    ParseError: () => false,
  })
}

const retryAfterSchedule = Schedule.makeWithState<
  void,
  HttpClientError | ParseResult.ParseError,
  Duration.Duration,
  never
>(
  undefined,
  (now, error, _state) =>
    Effect.sync(() => {
      const delay = retryAfterMs(error, now)
      if (delay === null) {
        return [undefined, Duration.zero, ScheduleDecision.done] as const
      }
      const jitter = 0.9 + Math.random() * 0.2
      const ms = Math.floor(delay * jitter)
      return [
        undefined,
        Duration.millis(ms),
        ScheduleDecision.continueWith(ScheduleInterval.after(now + ms)),
      ] as const
    }),
)

function requestChallenge(
  client: HttpClient.HttpClient,
  baseUrl: string,
): Effect.Effect<Uint8Array, HttpClientError | ParseResult.ParseError, never> {
  return HttpClientRequest.post(`${baseUrl}/api/v1/auth/challenges`).pipe(
    client.execute,
    Effect.flatMap(HttpClientResponse.filterStatus((s) => s === 201)),
    Effect.flatMap(HttpClientResponse.schemaBodyJson(ChallengeSchema)),
    Effect.map((parsed) => new Uint8Array(Buffer.from(parsed.challenge, 'base64'))),
  )
}

function acquireTokenWithBackoff(
  client: HttpClient.HttpClient,
  baseUrl: string,
  entry: RegisterEntry,
  retryCounter: Ref.Ref<number>,
): Effect.Effect<string, HttpClientError | ParseResult.ParseError, never> {
  return Effect.gen(function*() {
    const challenge = yield* requestChallenge(client, baseUrl)
    const { clientId, proof } = buildClientProof({
      mnemonic: entry.mnemonic,
      challenge,
      body: new TextEncoder().encode(TOKEN_BODY),
    })

    const request = HttpClientRequest.post(`${baseUrl}/api/v1/auth/token`).pipe(
      HttpClientRequest.setHeader('Content-Type', 'application/json'),
      HttpClientRequest.setHeader('Auth-ClientId', toBase64(clientId)),
      HttpClientRequest.setHeader('Auth-ClientProof', toBase64(proof)),
      HttpClientRequest.setHeader('Auth-Challenge', toBase64(challenge)),
      HttpClientRequest.bodyText(TOKEN_BODY),
    )

    const response = yield* client.execute(request)
    const filtered = yield* HttpClientResponse.filterStatus(acceptStatus)(response)
    const parsed = yield* HttpClientResponse.schemaBodyJson(TokenSchema)(filtered)
    return parsed.token
  }).pipe(
    Effect.tapError((error: HttpClientError | ParseResult.ParseError) =>
      isTooManyRequests(error)
        ? Ref.update(retryCounter, (n) => n + 1)
        : Effect.void
    ),
    Effect.retry(retryAfterSchedule),
  )
}

function jsonEntry(entry: JwtToken): string {
  return `${JSON.stringify(entry)}\n`
}

interface ProgressState {
  lastPct: number
  lastLogMs: number
}

function shouldLogProgress(state: ProgressState, completed: number, total: number, nowMs: number): boolean {
  if (total <= 0) return false
  const pct = Math.floor((completed * 100) / total)
  if (pct >= 100) return pct !== state.lastPct
  if (pct > state.lastPct && pct % PERCENT_GRANULARITY === 0) return true
  if (pct === state.lastPct && nowMs - state.lastLogMs >= HEARTBEAT_MS) return true
  return false
}

function formatProgress(
  completed: number,
  total: number,
  retries: number,
  failures: number,
  startedAt: number,
  nowMs: number,
): string {
  const pct = total > 0 ? Math.floor((completed * 100) / total) : 0
  const elapsedSec = Math.max(0.001, (nowMs - startedAt) / 1_000)
  const rate = completed / elapsedSec
  const etaSec = rate > 0 ? Math.max(0, Math.floor((total - completed) / rate)) : 0
  return (
    `  ${pct}% (${completed}/${total}) ` +
    `— ${rate.toFixed(1)}/s, retries=${retries}, failures=${failures}, ` +
    `eta=${etaSec}s`
  )
}

export function makeJwtTokensHandler(
  args: JwtTokensArgs,
): Effect.Effect<
  void,
  PlatformError | HttpClientError | ParseResult.ParseError,
  FileSystem.FileSystem | Path.Path | HttpClient.HttpClient
> {
  return Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const client = yield* HttpClient.HttpClient

    const inPath = readEnvPath(process.env, 'REGISTER_PAYLOADS', args.in || DEFAULT_FILES.registerPayloads)
    const outPath = readEnvPath(process.env, 'JWT_TOKENS', args.out || DEFAULT_FILES.jwtTokens)
    const baseUrl = args.baseUrl.trim().replace(/\/$/, '')

    yield* ensureParentDir(outPath)

    const inText = yield* fs.readFileString(inPath)
    const all = parseRegisterPayloads(inText)
    const selected = args.limit > 0 ? all.slice(0, args.limit) : all

    yield* Console.log(
      `Acquiring ${selected.length} JWTs from ${baseUrl} (attestation must be disabled on the target)...`,
    )

    const completedRef = yield* Ref.make(0)
    const retriesRef = yield* Ref.make(0)
    const failuresRef = yield* Ref.make(0)
    const progressRef = yield* Ref.make<ProgressState>({ lastPct: 0, lastLogMs: 0 })
    const tokensRef = yield* Ref.make<ReadonlyArray<JwtToken>>([])
    const failureSamplesRef = yield* Ref.make<HashMap.HashMap<string, number>>(HashMap.empty())
    const distinctLoggedRef = yield* Ref.make(0)

    const sampleFailure = (message: string): Effect.Effect<number, never, never> =>
      Ref.modify(failureSamplesRef, (map) => {
        const count = Option.getOrElse(HashMap.get(map, message), () => 0)
        return [count, HashMap.set(map, message, count + 1)]
      })

    const tmpPath = `${outPath}.${process.pid}.${DateTime.unsafeNow().epochMillis}.partial`
    yield* fs.writeFileString(tmpPath, '')

    const startedAt = yield* Clock.currentTimeMillis

    const writeEntry = (entry: JwtToken): Effect.Effect<void, PlatformError, FileSystem.FileSystem> =>
      fs.writeFileString(tmpPath, jsonEntry(entry), { flag: 'a' })

    const logProgress = (): Effect.Effect<void, never, never> =>
      Effect.gen(function*() {
        const completed = yield* Ref.get(completedRef)
        const retries = yield* Ref.get(retriesRef)
        const failures = yield* Ref.get(failuresRef)
        const state = yield* Ref.get(progressRef)
        const nowMs = yield* Clock.currentTimeMillis
        if (!shouldLogProgress(state, completed, selected.length, nowMs)) return
        const pct = selected.length > 0 ? Math.floor((completed * 100) / selected.length) : 0
        yield* Ref.set(progressRef, { lastPct: pct, lastLogMs: nowMs })
        yield* Console.log(formatProgress(completed, selected.length, retries, failures, startedAt, nowMs))
      })

    yield* Effect.forEach(
      selected,
      (entry) =>
        Effect.gen(function*() {
          const result = yield* Effect.either(acquireTokenWithBackoff(client, baseUrl, entry, retriesRef))
          if (Either.isRight(result)) {
            const token: JwtToken = { who: entry.who, token: result.right }
            yield* writeEntry(token)
            yield* Ref.update(tokensRef, (xs) => [...xs, token])
            yield* Ref.update(completedRef, (n) => n + 1)
            yield* logProgress()
          } else {
            const message = String(result.left)
            const previousCount = yield* sampleFailure(message)
            const distinctLogged = yield* Ref.get(distinctLoggedRef)
            if (previousCount === 0 && distinctLogged < MAX_DISTINCT_FAILURE_SAMPLES) {
              yield* Ref.update(distinctLoggedRef, (n) => n + 1)
              yield* Console.error(
                `  failed to acquire JWT for ${entry.who}: ${message}`,
              )
            }
            yield* Ref.update(failuresRef, (n) => n + 1)
            yield* Ref.update(completedRef, (n) => n + 1)
            yield* logProgress()
          }
        }),
      { concurrency: 'unbounded', discard: true },
    )

    const tokens = yield* Ref.get(tokensRef)
    const failures = yield* Ref.get(failuresRef)
    const retries = yield* Ref.get(retriesRef)
    const completed = yield* Ref.get(completedRef)
    const nowMs = yield* Clock.currentTimeMillis
    const elapsedMs = nowMs - startedAt
    const rate = completed > 0 ? (completed / Math.max(1, elapsedMs)) * 1_000 : 0

    yield* Console.log(
      `  done in ${(elapsedMs / 1_000).toFixed(1)}s — acquired ${tokens.length}, ` +
        `failures=${failures}, retries=${retries}, ${rate.toFixed(1)}/s`,
    )

    if (failures > 0) {
      const samples = yield* Ref.get(failureSamplesRef)
      const distinctKinds = HashMap.size(samples)
      const suppressed = distinctKinds - MAX_DISTINCT_FAILURE_SAMPLES
      if (suppressed > 0) {
        yield* Console.error(
          `  ${failures} total failures across ${distinctKinds} distinct error kinds; ${suppressed} kinds suppressed`,
        )
      }
    }

    if (tokens.length === 0) {
      yield* fs.remove(tmpPath).pipe(Effect.ignoreLogged)
      return yield* Effect.dieMessage(
        `No JWTs acquired from ${baseUrl} — the input payloads file is empty or all exchanges failed`,
      )
    }

    const payload = `${JSON.stringify({ count: tokens.length, tokens }, null, 2)}\n`
    yield* fs.writeFileString(outPath, payload)
    yield* fs.remove(tmpPath).pipe(Effect.ignoreLogged)
    yield* Console.log(`wrote ${outPath} — ${tokens.length} JWTs`)
  })
}
