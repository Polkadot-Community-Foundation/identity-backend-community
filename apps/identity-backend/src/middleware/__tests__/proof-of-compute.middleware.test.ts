import {
  makeProofOfComputeMiddlewareWithoutDependencies,
  PROOF_OF_COMPUTE_HEADER,
} from '#root/middleware/proof-of-compute.middleware.js'
import { SolutionFromHeader } from '#root/proof-of-compute/proof-of-compute-header.acl.js'
import { ProofOfComputeConfig } from '#root/proof-of-compute/proof-of-compute.config.js'
import { ChecksumPreimage, SessionId, Solution, WorkPreimage } from '#root/proof-of-compute/proof-of-compute.schema.js'
import { hmac } from '@noble/hashes/hmac.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { Duration, Effect, Layer, Redacted, Schema as S } from 'effect'
import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'
import { describe, expect, it } from 'vitest'

const SECRET = 'poc-test-secret'
const secretBytes = new TextEncoder().encode(SECRET)
const DIFFICULTY = 4

const configLayer = Layer.succeed(ProofOfComputeConfig, {
  enabled: true,
  secret: Redacted.make(secretBytes),
  ttl: Duration.seconds(5),
  clockSkew: Duration.seconds(2),
  difficulty: DIFFICULTY,
})

const buildMiddleware = (): Promise<MiddlewareHandler> =>
  Effect.runPromise(
    makeProofOfComputeMiddlewareWithoutDependencies.pipe(
      Effect.provide(configLayer),
    ),
  )

const checksumPreimage = S.decodeSync(ChecksumPreimage)
const workPreimage = S.decodeSync(WorkPreimage)

const leadingZeroBits = (sessionId: SessionId, timestamp: number, counter: number): number => {
  const digest = sha256(workPreimage({ sessionId, timestamp, counter }))
  return Math.clz32(new DataView(digest.buffer, digest.byteOffset, 4).getUint32(0, false))
}

const headerFor = (sessionId: SessionId, checksumSecret: Uint8Array, timestamp = Date.now()): string => {
  const checksum = bytesToHex(
    hmac(sha256, checksumSecret, checksumPreimage({ sessionId, timestamp, difficulty: DIFFICULTY })),
  )
  let counter = 0
  while (leadingZeroBits(sessionId, timestamp, counter) < DIFFICULTY) {
    counter += 1
  }
  return S.encodeSync(SolutionFromHeader)(
    Solution.make({ sessionId, timestamp, difficulty: DIFFICULTY, counter, checksum }),
  )
}

const validHeader = (timestamp = Date.now()): string =>
  headerFor(SessionId.make(crypto.randomUUID()), secretBytes, timestamp)

const gatedApp = (middleware: MiddlewareHandler) => {
  const app = new Hono()
  return app.use('/search', middleware).get('/search', (c) => c.json({ ok: true }))
}

describe('proofOfComputeMiddleware', () => {
  it('Should_PassThrough_When_ValidProofPresented', async () => {
    const app = gatedApp(await buildMiddleware())
    const res = await app.request('/search', { headers: { [PROOF_OF_COMPUTE_HEADER]: validHeader() } })
    expect(res.status).toBe(200)
  })

  it('Should_Return402PaymentRequired_When_HeaderMissing', async () => {
    const app = gatedApp(await buildMiddleware())
    const res = await app.request('/search')
    expect(res.status).toBe(402)
    const body = await res.json()
    expect(body.status).toBe(402)
    expect(body.type).toContain('payment-required')
  })

  it('Should_Return400_When_HeaderMalformed', async () => {
    const app = gatedApp(await buildMiddleware())
    const res = await app.request('/search', { headers: { [PROOF_OF_COMPUTE_HEADER]: 'garbage!!' } })
    expect(res.status).toBe(400)
  })

  it('Should_Return402_When_ProofReplayed', async () => {
    const app = gatedApp(await buildMiddleware())
    const header = validHeader()
    const first = await app.request('/search', { headers: { [PROOF_OF_COMPUTE_HEADER]: header } })
    const second = await app.request('/search', { headers: { [PROOF_OF_COMPUTE_HEADER]: header } })
    expect(first.status).toBe(200)
    expect(second.status).toBe(402)
  })

  it('Should_NotConsumeSession_When_ProofInvalid', async () => {
    const app = gatedApp(await buildMiddleware())
    const sessionId = SessionId.make(crypto.randomUUID())
    const timestamp = Date.now()
    const invalid = headerFor(sessionId, new TextEncoder().encode('wrong-secret'), timestamp)
    const valid = headerFor(sessionId, secretBytes, timestamp)
    const rejected = await app.request('/search', { headers: { [PROOF_OF_COMPUTE_HEADER]: invalid } })
    const accepted = await app.request('/search', { headers: { [PROOF_OF_COMPUTE_HEADER]: valid } })
    expect(rejected.status).toBe(402)
    expect(accepted.status).toBe(200)
  })
})
