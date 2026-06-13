import { createOpenAPIHono } from '#root/lib/problem-details.js'
import { withRouteTimeout } from '#root/lib/route-timeout.js'
import { issueProofOfCompute } from '#root/proof-of-compute/issue-proof-of-compute.executor.js'
import { ProofOfComputeConfig } from '#root/proof-of-compute/proof-of-compute.config.js'
import { createRoute, z } from '@hono/zod-openapi'
import { bridgeSpanContext } from '@identity-backend/observability'
import { Cause, Effect, Exit, Redacted, Runtime } from 'effect'

const PocIssueResponseZod = z.object({
  sessionId: z.string().uuid().describe('Puzzle session identifier'),
  timestamp: z.number().int().describe('Issue time in epoch milliseconds'),
  difficulty: z.number().int().describe('Required leading zero bits of the work hash'),
  checksum: z.string().describe('HMAC-SHA256 checksum binding the puzzle to this server'),
}).openapi({ title: 'ProofOfComputePuzzle' })

const issuePocRoute = createRoute({
  summary: 'Issue Proof-of-Compute Puzzle',
  description: 'Issues a short-lived proof-of-compute puzzle gating unauthenticated requests.',
  method: 'post',
  path: '/issue',
  tags: ['v1'],
  responses: {
    201: {
      content: { 'application/json': { schema: PocIssueResponseZod } },
      description: 'Puzzle issued',
    },
  },
})

export const makeIssuePocRouteWithoutDependencies = Effect.gen(function*() {
  const config = yield* ProofOfComputeConfig
  const runtime = yield* Effect.runtime()

  if (config.enabled === false) {
    return createOpenAPIHono()
  }

  const secret = Redacted.value(config.secret)
  const { difficulty } = config

  return createOpenAPIHono().openapi(issuePocRoute, async (c) => {
    const handler = issueProofOfCompute({ secret, difficulty }).pipe(
      Effect.map((puzzle) =>
        c.json({
          sessionId: puzzle.sessionId,
          timestamp: puzzle.timestamp,
          difficulty: puzzle.difficulty,
          checksum: puzzle.checksum,
        }, 201)
      ),
      Effect.withSpan('v1.poc_issue', { attributes: { 'poc.difficulty': difficulty } }),
    )

    const result = await bridgeSpanContext(handler, c).pipe(
      withRouteTimeout,
      Effect.exit,
      Runtime.runPromise(runtime),
    )

    if (Exit.isFailure(result)) {
      throw Cause.squash(result.cause)
    }

    return result.value
  })
})

export const makeIssuePocRoute = makeIssuePocRouteWithoutDependencies.pipe(
  Effect.provide(ProofOfComputeConfig.Default),
)
