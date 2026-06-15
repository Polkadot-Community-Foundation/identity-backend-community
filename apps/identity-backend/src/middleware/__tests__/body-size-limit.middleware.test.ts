import { createOpenAPIHono, ProblemDetailZod, problemTypeUrl } from '#root/lib/problem-details.js'
import { bodySizeRejections, registerBodySizeLimits } from '#root/middleware/body-size-limit.middleware.js'
import { it } from '@effect/vitest'
import { Effect, Metric, Runtime } from 'effect'
import { describe, expect } from 'vitest'

const HANDSHAKE_CAP = 64
const CATCH_ALL_CAP = 128

const AUTH_PATH = '/api/v1/auth/app-attest/attestations'
const NOTIFY_PATH = '/api/v1/notify/send'
const OTHER_PATH = '/api/v1/usernames/check'

const gatedApp = Effect.gen(function*() {
  const runSync = Runtime.runSync(yield* Effect.runtime())
  const reached = { auth: 0, notify: 0, other: 0 }

  const app = createOpenAPIHono()
  registerBodySizeLimits(app, runSync, { handshake: HANDSHAKE_CAP, catchAll: CATCH_ALL_CAP })

  app.post(AUTH_PATH, (c) => {
    reached.auth += 1
    return c.json({ ok: true }, 200)
  })
  app.post(NOTIFY_PATH, (c) => {
    reached.notify += 1
    return c.json({ ok: true }, 200)
  })
  app.post(OTHER_PATH, (c) => {
    reached.other += 1
    return c.json({ ok: true }, 200)
  })

  return { app, reached }
})

const post = (
  app: { request: (path: string, init: RequestInit) => Response | Promise<Response> },
  path: string,
  body: BodyInit,
  headers: Record<string, string> = {},
) => Effect.promise(() => Promise.resolve(app.request(path, { method: 'POST', body, headers })))

const attestationRejections = bodySizeRejections.pipe(
  Metric.tagged('path', 'attestation'),
  Metric.tagged('reason', 'exceeds-cap'),
)

describe('registerBodySizeLimits', () => {
  it.effect('Should_RejectWith413ProblemDetail_When_HandshakeBodyExceedsCap', () =>
    Effect.gen(function*() {
      const { app, reached } = yield* gatedApp

      const res = yield* post(app, AUTH_PATH, 'a'.repeat(HANDSHAKE_CAP + 1))
      const body = yield* Effect.promise(() => res.json())

      expect(res.status).toBe(413)
      expect(res.headers.get('content-type')).toContain('application/problem+json')
      expect(body).toEqual(expect.schemaMatching(ProblemDetailZod))
      expect(body.type).toBe(problemTypeUrl('payload-too-large'))
      expect(body.status).toBe(413)
      expect(reached.auth).toBe(0)
    }))

  it.effect('Should_ReachHandler_When_HandshakeBodyIsExactlyAtCap', () =>
    Effect.gen(function*() {
      const { app, reached } = yield* gatedApp

      const res = yield* post(app, AUTH_PATH, 'a'.repeat(HANDSHAKE_CAP))

      expect(res.status).toBe(200)
      expect(reached.auth).toBe(1)
    }))

  it.effect('Should_Reject_When_HandshakeBodyIsOneByteOverCap', () =>
    Effect.gen(function*() {
      const { app, reached } = yield* gatedApp

      const atCap = yield* post(app, AUTH_PATH, 'a'.repeat(HANDSHAKE_CAP))
      const overByOne = yield* post(app, AUTH_PATH, 'a'.repeat(HANDSHAKE_CAP + 1))

      expect(atCap.status).toBe(200)
      expect(overByOne.status).toBe(413)
      expect(reached.auth).toBe(1)
    }))

  it.effect('Should_RejectNotifyAtHandshakeCap_When_BodyExceedsIt', () =>
    Effect.gen(function*() {
      const { app, reached } = yield* gatedApp

      const res = yield* post(app, NOTIFY_PATH, 'a'.repeat(HANDSHAKE_CAP + 1))

      expect(res.status).toBe(413)
      expect(reached.notify).toBe(0)
    }))

  it.effect('Should_ApplyCatchAllCap_When_PathHasNoTighterFamily', () =>
    Effect.gen(function*() {
      const { app, reached } = yield* gatedApp

      const underCatchAll = yield* post(app, OTHER_PATH, 'a'.repeat(HANDSHAKE_CAP + 1))
      const overCatchAll = yield* post(app, OTHER_PATH, 'a'.repeat(CATCH_ALL_CAP + 1))

      expect(underCatchAll.status).toBe(200)
      expect(overCatchAll.status).toBe(413)
      expect(reached.other).toBe(1)
    }))

  it.effect('Should_RejectViaContentLengthFastPath_When_HeaderExceedsCap', () =>
    Effect.gen(function*() {
      const { app, reached } = yield* gatedApp

      const res = yield* post(app, AUTH_PATH, 'a'.repeat(HANDSHAKE_CAP + 1), {
        'content-length': String(HANDSHAKE_CAP + 1),
      })

      expect(res.status).toBe(413)
      expect(reached.auth).toBe(0)
    }))

  it.effect('Should_IncrementRejectionMetric_When_BodyExceedsCap', () =>
    Effect.gen(function*() {
      const { app } = yield* gatedApp

      const before = yield* Metric.value(attestationRejections)
      yield* post(app, AUTH_PATH, 'a'.repeat(HANDSHAKE_CAP + 1))
      const after = yield* Metric.value(attestationRejections)

      expect(after.count - before.count).toBe(1)
    }))
})
