import {
  buildProblemDetail,
  createOpenAPIHono,
  type ProblemDetail,
  ProblemDetailWithErrorsZod,
  problemResponse,
  SMARTBEAR,
} from '#root/lib/problem-details.js'
import { withRouteTimeout } from '#root/lib/route-timeout.js'
import { bridgeSpanContext } from '#root/tracing/bridge-span-context.js'
import {
  ClaimCommand,
  ClaimUsernameExecutor,
  ClaimUsernameExecutorDeps,
} from '#root/username-registration/registration-queue/claim.executor.js'
import { type ClaimDecision, VoucherKey } from '#root/username-registration/registration-queue/claim.schema.js'
import { CandidateAccountId } from '#root/username-registration/registration-queue/entry.schema.js'
import { estimatedIterationsRemaining } from '#root/username-registration/registration-queue/priority-group.js'
import { RegistrationQueueStatusConfig } from '#root/username-registration/registration-queue/queue-status.config.js'
import { findEntryByCandidate, getQueuePosition } from '#root/username-registration/registration-queue/store.js'
import type { HttpBindings } from '@hono/node-server'
import { createRoute, z } from '@hono/zod-openapi'
import { DB } from '@identity-backend/db'
import { Ss58StringFromHex } from '@identity-backend/substrate-schema'
import type { SpanContext } from '@opentelemetry/api'
import { Match, Option as O } from 'effect'
import { Cause, Effect, Exit, Runtime, Schema as S } from 'effect'

const ANDROID_DEVICE_TOKEN_HEADER = 'Device-Token-Android' as const

const EnterQueueV1Request = z.object({
  username: z.string()
    .min(1)
    .max(32)
    .openapi({
      description: 'Base username to claim.',
      examples: ['alice'],
    }),
  lifetimePoUDVoucher: z.string()
    .min(1)
    .optional()
    .openapi({
      description: 'Optional lifetime proof-of-unique-device voucher key granting an instant claim.',
    }),
}).openapi({
  title: 'EnterQueueV1Request',
})

const RegistrationOutcome = z.enum(['QUEUED', 'INSTANT', 'PAYMENT_REQUIRED'])

const EnterQueueV1Response = z.object({
  registrationOutcome: RegistrationOutcome,
  queuePosition: z.number().nullable(),
  paymentAddress: z.string().optional(),
  amountRequired: z.string().optional(),
}).openapi({
  title: 'EnterQueueV1Response',
})

const QueueStatusV1Response = z.object({
  registrationOutcome: RegistrationOutcome,
  queuePosition: z.number(),
  group: z.number(),
  estimatedIterationsRemaining: z.number(),
}).openapi({
  title: 'QueueStatusV1Response',
})

class InvalidJwtSubjectError extends S.TaggedError<InvalidJwtSubjectError>()('InvalidJwtSubjectError', {}) {}

const candidateAccountIdFromJwt = (jwtSub: string) =>
  S.decode(S.compose(Ss58StringFromHex, CandidateAccountId))(jwtSub).pipe(
    Effect.catchTag('ParseError', () => Effect.fail(new InvalidJwtSubjectError({}))),
  )

type ClaimResponseBody = {
  readonly registrationOutcome: 'INSTANT' | 'QUEUED' | 'PAYMENT_REQUIRED'
  readonly queuePosition: number | null
  readonly paymentAddress?: string
  readonly amountRequired?: string
}

const claimResponseBody = (decision: ClaimDecision, queuePosition: number | null): ClaimResponseBody =>
  Match.value(decision).pipe(
    Match.tag('ClaimInstant', (): ClaimResponseBody => ({ registrationOutcome: 'INSTANT', queuePosition: null })),
    Match.tag('ClaimQueued', (): ClaimResponseBody => ({ registrationOutcome: 'QUEUED', queuePosition })),
    Match.tag('ClaimPaymentRequired', (d): ClaimResponseBody => ({
      registrationOutcome: 'PAYMENT_REQUIRED',
      queuePosition: null,
      paymentAddress: d.paymentAddress,
      amountRequired: d.amountRequired.toString(),
    })),
    Match.exhaustive,
  )

const enterQueueRoute = createRoute({
  summary: 'Enter Registration Queue',
  description: 'Join the free username registration queue. One entry per account.',
  method: 'post',
  path: '/',
  tags: ['v1'],
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: EnterQueueV1Request,
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: EnterQueueV1Response,
        },
      },
      description: 'Claim resolved — queued, instant, or payment required',
    },
    400: { ...problemResponse(ProblemDetailWithErrorsZod), description: 'Bad Request' },
    409: { ...problemResponse(), description: 'Conflict — already in queue or queue full' },
  },
})

const getQueueStatusRoute = createRoute({
  summary: 'Get Queue Status',
  description: 'Get the current queue status for the authenticated account.',
  method: 'get',
  path: '/queue',
  tags: ['v1'],
  security: [{ bearerAuth: [] }],
  request: {},
  responses: {
    200: {
      content: {
        'application/json': {
          schema: QueueStatusV1Response,
        },
      },
      description: 'Queue status retrieved',
    },
    400: { ...problemResponse(), description: 'Bad Request' },
    404: { ...problemResponse(), description: 'Not Found' },
  },
})

interface JwtEnv {
  Variables: {
    jwtSub: string
    jwtAppFromOfficialStore?: boolean
  }
}

export const makeRegistrationQueueRoute = Effect.gen(function*() {
  const { network, slotCount } = yield* RegistrationQueueStatusConfig
  const runtime = yield* Effect.runtime<DB | ClaimUsernameExecutorDeps>()

  return createOpenAPIHono<JwtEnv & { Bindings: HttpBindings; Variables: { spanContext?: SpanContext } }>()
    .openapi(
      enterQueueRoute,
      async (c) => {
        const { username, lifetimePoUDVoucher } = c.req.valid('json')
        const deviceTokenHeader = c.req.header(ANDROID_DEVICE_TOKEN_HEADER)
        const appFromOfficialStore = c.var.jwtAppFromOfficialStore ?? false

        const handler = Effect.gen(function*() {
          const candidateAccountId = yield* candidateAccountIdFromJwt(c.var.jwtSub)
          const voucherKey = yield* O.match(O.fromNullable(lifetimePoUDVoucher), {
            onNone: () => Effect.succeed(O.none<VoucherKey>()),
            onSome: (raw) => S.decode(VoucherKey)(raw).pipe(Effect.orDie, Effect.map(O.some)),
          })
          const command = new ClaimCommand({
            username,
            candidateAccountId,
            voucherKey,
            deviceToken: O.fromNullable(deviceTokenHeader),
            appFromOfficialStore,
          })

          const { decision, queuePosition } = yield* ClaimUsernameExecutor(command)
          return c.json(claimResponseBody(decision, queuePosition), 200)
        }).pipe(
          Effect.withSpan('v1.enter_registration_queue'),
        )

        const result = await bridgeSpanContext(handler, c).pipe(
          Effect.catchTag('VoucherAlreadyUsedError', () =>
            Effect.succeed(c.json(
              buildProblemDetail({
                slug: 'business-rule-violation',
                title: 'Voucher Already Used',
                detail: 'The lifetime proof-of-unique-device voucher has already been redeemed.',
                status: 400,
              }) satisfies ProblemDetail,
              400,
              { 'Content-Type': 'application/problem+json' },
            ))),
          Effect.catchTag('VoucherNotFoundError', () =>
            Effect.succeed(c.json(
              buildProblemDetail({
                slug: 'bad-request',
                title: 'Voucher Not Found',
                detail: 'No lifetime proof-of-unique-device voucher matches the supplied key.',
                status: 400,
              }) satisfies ProblemDetail,
              400,
              { 'Content-Type': 'application/problem+json' },
            ))),
          Effect.catchTag('WrongClaimDataError', () =>
            Effect.succeed(c.json(
              buildProblemDetail({
                slug: 'bad-request',
                title: 'Wrong Claim Data',
                detail: 'A claim requires either a lifetime voucher or a device token.',
                status: 400,
              }) satisfies ProblemDetail,
              400,
              { 'Content-Type': 'application/problem+json' },
            ))),
          Effect.catchTag('MalformedDeviceTokenError', () =>
            Effect.succeed(c.json(
              buildProblemDetail({
                slug: 'bad-request',
                title: 'Malformed Device Token',
                detail: 'Device-Token-Android must be Base64URL-encoded JSON with androidId and widevineId.',
                status: 400,
              }) satisfies ProblemDetail,
              400,
              { 'Content-Type': 'application/problem+json' },
            ))),
          Effect.catchTag('QueueFullError', (err) =>
            Effect.succeed(c.json(
              {
                type: `${SMARTBEAR}/business-rule-violation`,
                title: 'Queue Full',
                detail: `Queue is full (capacity: ${err.capacity}). Please try again later.`,
                status: 409,
              } satisfies ProblemDetail,
              409,
              { 'Content-Type': 'application/problem+json' },
            ))),
          Effect.catchTag('AlreadyInQueueError', () =>
            Effect.succeed(c.json(
              {
                type: `${SMARTBEAR}/already-exists`,
                title: 'Already In Queue',
                detail: 'You already have an entry in the queue.',
                status: 409,
              } satisfies ProblemDetail,
              409,
              { 'Content-Type': 'application/problem+json' },
            ))),
          Effect.catchTag('InvalidJwtSubjectError', () =>
            Effect.succeed(c.json(
              {
                type: `${SMARTBEAR}/invalid-request-header-format`,
                title: 'Invalid JWT Subject',
                detail: 'The JWT subject must be a valid hex-encoded public key.',
                status: 400,
              } satisfies ProblemDetail,
              400,
              { 'Content-Type': 'application/problem+json' },
            ))),
          withRouteTimeout,
          Effect.exit,
          Runtime.runPromise(runtime),
        )

        if (Exit.isFailure(result)) {
          throw Cause.squash(result.cause)
        }

        return result.value
      },
    )
    .openapi(
      getQueueStatusRoute,
      async (c) => {
        const handler = Effect.gen(function*() {
          const candidateAccountId = yield* candidateAccountIdFromJwt(c.var.jwtSub)
          const entry = yield* findEntryByCandidate(candidateAccountId, network)

          if (!entry) {
            return c.json(
              {
                type: `${SMARTBEAR}/not-found`,
                title: 'Not Found',
                detail: 'No queue entry found for this account.',
                status: 404,
              } satisfies ProblemDetail,
              404,
              { 'Content-Type': 'application/problem+json' },
            )
          }

          const position = yield* getQueuePosition(entry.id)
          const pos = yield* O.match(position, {
            onNone: () => Effect.die('Queue entry exists but position not found'),
            onSome: (v) => Effect.succeed(v),
          })

          return c.json({
            registrationOutcome: 'QUEUED' as const,
            queuePosition: pos,
            group: entry.priorityGroup,
            estimatedIterationsRemaining: estimatedIterationsRemaining(pos, slotCount),
          }, 200)
        }).pipe(
          Effect.withSpan('v1.get_queue_status'),
        )

        const result = await bridgeSpanContext(handler, c).pipe(
          Effect.catchTag('InvalidJwtSubjectError', () =>
            Effect.succeed(c.json(
              {
                type: `${SMARTBEAR}/invalid-request-header-format`,
                title: 'Invalid JWT Subject',
                detail: 'The JWT subject must be a valid hex-encoded public key.',
                status: 400,
              } satisfies ProblemDetail,
              400,
              { 'Content-Type': 'application/problem+json' },
            ))),
          withRouteTimeout,
          Effect.exit,
          Runtime.runPromise(runtime),
        )

        if (Exit.isFailure(result)) {
          throw Cause.squash(result.cause)
        }

        return result.value
      },
    )
})
