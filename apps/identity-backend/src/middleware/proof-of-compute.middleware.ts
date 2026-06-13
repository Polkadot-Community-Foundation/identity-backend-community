import { buildProblemDetail, type ProblemDetail } from '#root/lib/problem-details.js'
import { SolutionFromHeader } from '#root/proof-of-compute/proof-of-compute-header.acl.js'
import { ProofOfComputeConfig } from '#root/proof-of-compute/proof-of-compute.config.js'
import {
  type GateError,
  MalformedProofHeaderError,
  MissingProofHeaderError,
  type SessionId,
} from '#root/proof-of-compute/proof-of-compute.schema.js'
import { makeSpentPuzzles } from '#root/proof-of-compute/spent-puzzles.store.js'
import { verifyProofOfCompute } from '#root/proof-of-compute/verify-proof-of-compute.executor.js'
import { Cause, Duration, Effect, Either, Exit, Match, Option, Redacted, Ref, Runtime } from 'effect'
import { Schema as S } from 'effect'
import { createMiddleware } from 'hono/factory'

export const PROOF_OF_COMPUTE_HEADER = 'Proof-Of-Compute'

interface ProofOfComputeEnv {
  Variables: {
    pocSessionId?: SessionId
  }
}

const paymentRequired = (error: Exclude<GateError, MalformedProofHeaderError>): ProblemDetail =>
  buildProblemDetail({
    slug: 'payment-required',
    title: 'Payment Required',
    status: 402,
    detail: Match.value(error).pipe(
      Match.tag(
        'PocMissingProofHeader',
        () =>
          'Proof of compute required. Request a puzzle from POST /api/v1/poc/issue and present the solved proof in the Proof-Of-Compute header.',
      ),
      Match.tag('PocChecksumMismatch', () =>
        'The proof checksum does not match; the puzzle was not issued by this server.'),
      Match.tag('PocExpired', () =>
        'The proof of compute puzzle has expired; request a new one.'),
      Match.tag('PocReplayed', () => 'The proof of compute puzzle has already been used.'),
      Match.tag('PocInsufficientDifficulty', () =>
        'The proof of compute solution does not meet the required difficulty.'),
      Match.exhaustive,
    ),
  })

const badRequest = (): ProblemDetail =>
  buildProblemDetail({
    slug: 'bad-request',
    title: 'Bad Request',
    status: 400,
    detail: 'The Proof-Of-Compute header is malformed.',
  })

const decodeHeader = S.decodeUnknownEither(SolutionFromHeader)

export const makeProofOfComputeMiddlewareWithoutDependencies = Effect.gen(function*() {
  const config = yield* ProofOfComputeConfig

  if (config.enabled === false) {
    return createMiddleware<ProofOfComputeEnv>(async (_c, next) => next())
  }

  const state = yield* Ref.make(
    makeSpentPuzzles(Duration.toMillis(config.ttl) + Duration.toMillis(config.clockSkew)),
  )
  const runtime = yield* Effect.runtime<ProofOfComputeConfig>()
  const secret = Redacted.value(config.secret)

  return createMiddleware<ProofOfComputeEnv>(async (c, next) => {
    const header = c.req.header(PROOF_OF_COMPUTE_HEADER)
    if (header === undefined) {
      return c.json(paymentRequired(new MissingProofHeaderError()), 402, { 'Content-Type': 'application/problem+json' })
    }

    const decoded = decodeHeader(header)
    if (Either.isLeft(decoded)) {
      return c.json(badRequest(), 400, {
        'Content-Type': 'application/problem+json',
      })
    }

    const result = await verifyProofOfCompute(state, { solution: decoded.right, secret }).pipe(
      Effect.exit,
      Runtime.runPromise(runtime),
    )

    if (Exit.isSuccess(result)) {
      c.set('pocSessionId', result.value)
      return next()
    }

    const failure = Cause.failureOption(result.cause)
    if (Option.isNone(failure)) {
      throw Cause.squash(result.cause)
    }

    return c.json(paymentRequired(failure.value), 402, { 'Content-Type': 'application/problem+json' })
  })
})

export const makeProofOfComputeMiddleware = makeProofOfComputeMiddlewareWithoutDependencies.pipe(
  Effect.provide(ProofOfComputeConfig.Default),
)
