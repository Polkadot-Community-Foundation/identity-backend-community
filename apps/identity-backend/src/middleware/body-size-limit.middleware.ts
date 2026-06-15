import { buildProblemDetail, type ProblemDetail } from '#root/lib/problem-details.js'
import type { OpenAPIHono } from '@hono/zod-openapi'
import { Effect, Metric } from 'effect'
import type { Context as HonoContext } from 'hono'
import { bodyLimit } from 'hono/body-limit'

const REJECTION_REASON = 'exceeds-cap' as const

export interface BodySizeLimits {
  readonly handshake: number
  readonly catchAll: number
}

export const bodySizeRejections = Metric.counter('app.body_size_rejections_total', {
  description: 'Request body size rejections by route family',
})

export const oversizedBodyProblem = (maxBytes: number): ProblemDetail & { readonly status: 413 } =>
  buildProblemDetail({
    slug: 'payload-too-large',
    title: 'Payload Too Large',
    status: 413,
    detail: `Request body exceeds the maximum allowed size of ${maxBytes} bytes for this endpoint.`,
  })

type RunSync = <A, E>(effect: Effect.Effect<A, E>) => A

export const registerBodySizeLimits = (
  app: Pick<OpenAPIHono, 'use'>,
  runSync: RunSync,
  limits: BodySizeLimits,
): void => {
  const families = [
    { pattern: '/api/v1/auth/*', family: 'attestation', maxBytes: limits.handshake },
    { pattern: '/api/v1/notify/*', family: 'notify', maxBytes: limits.handshake },
    { pattern: '*', family: 'default', maxBytes: limits.catchAll },
  ] as const

  const rejectOversized = (family: string, maxBytes: number) => (c: HonoContext) => {
    runSync(
      Metric.update(
        bodySizeRejections.pipe(
          Metric.tagged('path', family),
          Metric.tagged('reason', REJECTION_REASON),
        ),
        1,
      ).pipe(Effect.catchAllCause(() => Effect.void)),
    )

    return c.json(oversizedBodyProblem(maxBytes), 413, { 'Content-Type': 'application/problem+json' })
  }

  for (const { pattern, family, maxBytes } of families) {
    app.use(pattern, bodyLimit({ maxSize: maxBytes, onError: rejectOversized(family, maxBytes) }))
  }
}
