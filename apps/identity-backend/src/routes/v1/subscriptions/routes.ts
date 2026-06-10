import * as config from '#root/config.js'
import { SubscriptionCrudShell } from '#root/features/subscriptions/crud.shell.js'
import { StatementValidationError, type SubscriptionError } from '#root/features/subscriptions/errors.js'
import { PushBroadcastUseCase } from '#root/features/subscriptions/push-broadcast/push-broadcast.use-case.js'
import { SubscriptionRulesShell } from '#root/features/subscriptions/rules.shell.js'
import {
  AddRulesRequestSchema,
  DeleteRulesRequestSchema,
  ReplaceRulesRequestSchema,
} from '#root/features/subscriptions/schema.js'
import {
  DeviceToken,
  PublicKey,
  Subscription,
  SubscriptionId,
  TokenMobile,
  TokenWeb,
} from '#root/features/subscriptions/types.js'
import type { SubscriptionRule } from '#root/features/subscriptions/types.js'
import {
  createOpenAPIHono,
  type ProblemDetail,
  ProblemDetailWithErrorsZod,
  problemResponse,
  type ProblemStatus,
  SMARTBEAR,
} from '#root/lib/problem-details.js'
import { withRouteTimeout } from '#root/lib/route-timeout.js'
import { bridgeSpanContext } from '#root/tracing/bridge-span-context.js'
import { $, createRoute, z } from '@hono/zod-openapi'
import { Cause, Effect, Either, Exit, Match, Redacted, Runtime as Runtime_, Schema as S } from 'effect'
import { Encoding } from 'effect'
import type { Context as HonoContext } from 'hono'
import { fromHex, toHex } from 'polkadot-api/utils'
import {
  AddRulesRequestZod,
  BroadcastRequestZod,
  BroadcastResponseZod,
  CreateSubscriptionRequestZod,
  type CreateSubscriptionRequestZodType,
  DeleteRulesRequestZod,
  DeleteSubscriptionsRequestZod,
  ReplaceRulesRequestZod,
  RulesOperationResponseZod,
  SubscriptionResponseZod,
  VapidPublicKeyResponseZod,
} from './types.js'

const categorizeError = (error: SubscriptionError): ProblemStatus =>
  Match.value(error).pipe(
    Match.tag('SubscriptionNotFoundError', () => ({ status: 404 as const })),
    Match.tag('StatementValidationError', () => ({ status: 422 as const })),
    Match.orElse(() => ({ status: 500 as const })),
  ).status

const isClientError = (error: SubscriptionError): boolean => categorizeError(error) < 500

const toProblemDetail = (error: SubscriptionError): ProblemDetail =>
  Match.value(error).pipe(
    Match.tag('SubscriptionNotFoundError', () =>
      ({
        type: `${SMARTBEAR}/not-found`,
        title: 'Not Found',
        detail: 'Subscription not found.',
        status: 404 as const,
      }) satisfies ProblemDetail),
    Match.tag('StatementValidationError', () =>
      ({
        type: `${SMARTBEAR}/validation-error`,
        title: 'Validation Error',
        detail: 'The request body failed validation.',
        status: 422 as const,
      }) satisfies ProblemDetail),
    Match.orElse(() =>
      ({
        type: `${SMARTBEAR}/server-error`,
        title: 'Server Error',
        detail: 'An unexpected error occurred.',
        status: 500 as const,
      }) satisfies ProblemDetail
    ),
  )

const toRuleResponse = (r: SubscriptionRule) => ({
  id: r.id,
  subscriptionId: r.subscriptionId,
  senderPubkey: toHex(Redacted.value(r.senderPubkey)),
  topic: r.topic,
  createdAt: r.createdAt,
})

type TokenResponse =
  | string
  | {
    readonly endpoint: string
    readonly keys: { readonly p256dh: string; readonly auth: string }
    readonly contentEncoding: 'aes128gcm' | 'aesgcm'
  }
  | null

const toTokenResponse = (token: Subscription['token']): TokenResponse =>
  Match.value(token).pipe(
    Match.tag('Mobile', (t): TokenResponse => Redacted.value(t.token)),
    Match.tag('Web', (t): TokenResponse => ({
      endpoint: t.endpoint,
      keys: { p256dh: t.p256dh, auth: t.auth },
      contentEncoding: t.contentEncoding,
    })),
    Match.tag('Invalidated', (): TokenResponse => null),
    Match.exhaustive,
  )

const toTokenType = (token: Subscription['token']): 'mobile' | 'web' | null =>
  Match.value(token).pipe(
    Match.tag('Mobile', (): 'mobile' => 'mobile'),
    Match.tag('Web', (): 'web' => 'web'),
    Match.tag('Invalidated', () => null),
    Match.exhaustive,
  )

const toUpsertToken = (body: CreateSubscriptionRequestZodType): TokenMobile | TokenWeb =>
  body.notificationType === 'web'
    ? TokenWeb.make({
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
      contentEncoding: body.contentEncoding,
    })
    : TokenMobile.make({ token: Redacted.make(DeviceToken.make(body.token)) })

const toSubscriptionResponse = (sub: Subscription, rules: readonly SubscriptionRule[]) => ({
  id: sub.id.toString(),
  notificationType: sub.notificationType,
  token: toTokenResponse(sub.token),
  token_type: toTokenType(sub.token),
  rules: rules.map(toRuleResponse),
  createdAt: sub.createdAt.toString(),
  updatedAt: String(sub.updatedAt),
})

const transformRulesToDomain = (
  body: { rules: { senderPubkey: string; topic: string }[] },
) => ({
  rules: body.rules.map((r) => ({
    senderPubkey: PublicKey.make(fromHex(r.senderPubkey)),
    topic: r.topic,
  })),
})

const handleFailure = <T>(result: Exit.Exit<Either.Either<T, SubscriptionError>>, c: HonoContext): T => {
  if (!Exit.isSuccess(result)) throw Cause.squash(result.cause)

  const either = result.value
  if (Either.isLeft(either)) {
    const error = either.left
    if (isClientError(error)) {
      const problem = toProblemDetail(error)
      return c.json(problem, problem.status, { 'Content-Type': 'application/problem+json' }) as T
    }

    throw error
  }

  return either.right
}

const postRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['v1'],
  summary: 'Create subscription',
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: CreateSubscriptionRequestZod } },
    },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: SubscriptionResponseZod } },
      description: 'Subscription created',
    },
    200: {
      content: { 'application/json': { schema: SubscriptionResponseZod } },
      description: 'Subscription updated',
    },
    400: { ...problemResponse(ProblemDetailWithErrorsZod), description: 'Bad Request' },
    401: { ...problemResponse(), description: 'Unauthorized' },
    500: { ...problemResponse(), description: 'Internal Server Error' },
  },
})

const getRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['v1'],
  summary: 'List subscriptions',
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      content: {
        'application/json': { schema: z.array(SubscriptionResponseZod) },
      },
      description: 'List of subscriptions for the authenticated client',
    },
    401: { ...problemResponse(), description: 'Unauthorized' },
    500: { ...problemResponse(), description: 'Internal Server Error' },
  },
})

const deleteRoute = createRoute({
  method: 'delete',
  path: '/',
  tags: ['v1'],
  summary: 'Delete subscriptions',
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: DeleteSubscriptionsRequestZod } },
    },
  },
  responses: {
    204: { description: 'Subscriptions deleted' },
    401: { ...problemResponse(), description: 'Unauthorized' },
    404: { ...problemResponse(), description: 'Subscription not found' },
    500: { ...problemResponse(), description: 'Internal Server Error' },
  },
})

const addRulesRoute = createRoute({
  method: 'post',
  path: '/rules',
  tags: ['v1'],
  summary: 'Add rules to subscription',
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: AddRulesRequestZod } },
    },
  },
  responses: {
    201: { content: { 'application/json': { schema: RulesOperationResponseZod } }, description: 'Rules added' },
    401: { ...problemResponse(), description: 'Unauthorized' },
    404: { ...problemResponse(), description: 'Subscription not found' },
    422: { ...problemResponse(), description: 'Validation Error' },
    500: { ...problemResponse(), description: 'Internal Server Error' },
  },
})

const deleteRulesRoute = createRoute({
  method: 'delete',
  path: '/rules',
  tags: ['v1'],
  summary: 'Remove specific rules from subscription',
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: DeleteRulesRequestZod } },
    },
  },
  responses: {
    200: { content: { 'application/json': { schema: RulesOperationResponseZod } }, description: 'Rules removed' },
    401: { ...problemResponse(), description: 'Unauthorized' },
    404: { ...problemResponse(), description: 'Subscription not found' },
    422: { ...problemResponse(), description: 'Validation Error' },
    500: { ...problemResponse(), description: 'Internal Server Error' },
  },
})

const vapidRoute = createRoute({
  method: 'get',
  path: '/vapid-public-key',
  tags: ['v1'],
  summary: 'Get the VAPID public key for browser Web Push subscription',
  responses: {
    200: {
      content: { 'application/json': { schema: VapidPublicKeyResponseZod } },
      description: 'VAPID public key and subject',
    },
  },
})

const broadcastRoute = createRoute({
  method: 'post',
  path: '/broadcast',
  tags: ['v1'],
  summary: 'Broadcast a push notification to matching subscriptions',
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: BroadcastRequestZod } },
    },
  },
  responses: {
    200: { content: { 'application/json': { schema: BroadcastResponseZod } }, description: 'Broadcast accepted' },
    400: { ...problemResponse(ProblemDetailWithErrorsZod), description: 'Bad Request' },
    401: { ...problemResponse(), description: 'Unauthorized' },
    403: { ...problemResponse(), description: 'Forbidden' },
    500: { ...problemResponse(), description: 'Internal Server Error' },
  },
})

const replaceRulesRoute = createRoute({
  method: 'put',
  path: '/rules',
  tags: ['v1'],
  summary: 'Atomically replace all rules in subscription',
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: ReplaceRulesRequestZod } },
    },
  },
  responses: {
    204: { description: 'Rules replaced' },
    401: { ...problemResponse(), description: 'Unauthorized' },
    404: { ...problemResponse(), description: 'Subscription not found' },
    422: { ...problemResponse(), description: 'Validation Error' },
    500: { ...problemResponse(), description: 'Internal Server Error' },
  },
})

interface JwtEnv {
  Variables: {
    jwtSub: string
  }
}

export const makeSubscriptionPublicRoutes = Effect.fnUntraced(function*() {
  const vapidPublicKey = Encoding.encodeBase64Url(
    (yield* config.WEB_PUSH_VAPID_KEYPAIR).publicKey,
  )
  const subject = yield* config.WEB_PUSH_VAPID_SUBJECT

  return $(createOpenAPIHono()).openapi(vapidRoute, (c) => c.json({ vapid_public_key: vapidPublicKey, subject }, 200))
})

export const makeSubscriptionRouteWithoutDependencies = Effect.gen(function*() {
  const crud = yield* SubscriptionCrudShell
  const rules = yield* SubscriptionRulesShell
  const broadcast = yield* PushBroadcastUseCase
  const runtime = yield* Effect.runtime()

  return $(createOpenAPIHono<JwtEnv>())
    .openapi(postRoute, async (c) => {
      const jwtSub = c.var.jwtSub
      const body = c.req.valid('json')

      const result = await bridgeSpanContext(
        Effect.gen(function*() {
          const { created, subscription } = yield* crud.upsert(
            jwtSub,
            body.notificationType,
            toUpsertToken(body),
          )
          const subRules = yield* rules.getRules(subscription.id)
          return { created, response: toSubscriptionResponse(subscription, subRules) }
        }),
        c,
      ).pipe(
        Effect.withSpan('v1.create_subscription'),
        Effect.map(({ created, response }) => c.json(response, created ? 201 : 200)),
        Effect.either,
        withRouteTimeout,
        Effect.exit,
        Runtime_.runPromise(runtime),
      )

      return handleFailure(result, c)
    })
    .openapi(getRoute, async (c) => {
      const jwtSub = c.var.jwtSub

      const result = await bridgeSpanContext(
        Effect.gen(function*() {
          const subs = yield* crud.getAll(jwtSub)
          return yield* Effect.forEach(subs, (sub) =>
            Effect.gen(function*() {
              const subRules = yield* rules.getRules(sub.id)
              return toSubscriptionResponse(sub, subRules)
            }))
        }),
        c,
      ).pipe(
        Effect.withSpan('v1.list_subscriptions'),
        Effect.map((value) => c.json(value, 200)),
        Effect.either,
        withRouteTimeout,
        Effect.exit,
        Runtime_.runPromise(runtime),
      )

      return handleFailure(result, c)
    })
    .openapi(deleteRoute, async (c) => {
      const jwtSub = c.var.jwtSub
      const { subscription_ids } = c.req.valid('json')

      const result = await bridgeSpanContext(
        Effect.forEach(
          subscription_ids,
          (id) => crud.remove(jwtSub, SubscriptionId.make(id)).pipe(Effect.ignore),
        ),
        c,
      ).pipe(
        Effect.withSpan('v1.delete_subscriptions'),
        Effect.as(c.body(null, 204)),
        Effect.either,
        withRouteTimeout,
        Effect.exit,
        Runtime_.runPromise(runtime),
      )

      return handleFailure(result, c)
    })
    .openapi(broadcastRoute, async (c) => {
      const body = c.req.valid('json')

      const result = await bridgeSpanContext(
        broadcast.execute({
          signer: body.signer,
          topics: body.topics,
          content: body.content.deeplink === undefined
            ? { title: body.content.title, body: body.content.body }
            : { title: body.content.title, body: body.content.body, deeplink: body.content.deeplink },
        }),
        c,
      ).pipe(
        Effect.withSpan('v1.broadcast_subscription_push'),
        Effect.map(({ messageHash, delivered }) => c.json({ message_hash: messageHash, delivered }, 200)),
        Effect.either,
        withRouteTimeout,
        Effect.exit,
        Runtime_.runPromise(runtime),
      )

      return handleFailure(result, c)
    })
    .openapi(addRulesRoute, async (c) => {
      const jwtSub = c.var.jwtSub
      const body = c.req.valid('json')
      const subscriptionId = SubscriptionId.make(body.subscription_id)

      const result = await bridgeSpanContext(
        Effect.gen(function*() {
          const decodedBody = yield* S.decodeUnknown(AddRulesRequestSchema)(transformRulesToDomain(body)).pipe(
            Effect.mapError((error) => new StatementValidationError({ cause: error })),
          )
          return yield* rules.addRules(jwtSub, subscriptionId, decodedBody)
        }),
        c,
      ).pipe(
        Effect.withSpan('v1.add_subscription_rules'),
        Effect.map((value) => c.json(value, 201)),
        Effect.either,
        withRouteTimeout,
        Effect.exit,
        Runtime_.runPromise(runtime),
      )

      return handleFailure(result, c)
    })
    .openapi(deleteRulesRoute, async (c) => {
      const jwtSub = c.var.jwtSub
      const body = c.req.valid('json')
      const subscriptionId = SubscriptionId.make(body.subscription_id)

      const result = await bridgeSpanContext(
        Effect.gen(function*() {
          const decodedBody = yield* S.decodeUnknown(DeleteRulesRequestSchema)(transformRulesToDomain(body)).pipe(
            Effect.mapError((error) => new StatementValidationError({ cause: error })),
          )
          return yield* rules.deleteRules(jwtSub, subscriptionId, decodedBody)
        }),
        c,
      ).pipe(
        Effect.withSpan('v1.delete_subscription_rules'),
        Effect.map((value) => c.json(value, 200)),
        Effect.either,
        withRouteTimeout,
        Effect.exit,
        Runtime_.runPromise(runtime),
      )

      return handleFailure(result, c)
    })
    .openapi(replaceRulesRoute, async (c) => {
      const jwtSub = c.var.jwtSub
      const body = c.req.valid('json')
      const subscriptionId = SubscriptionId.make(body.subscription_id)

      const result = await bridgeSpanContext(
        Effect.gen(function*() {
          const decodedBody = yield* S.decodeUnknown(ReplaceRulesRequestSchema)(transformRulesToDomain(body)).pipe(
            Effect.mapError((error) => new StatementValidationError({ cause: error })),
          )
          return yield* rules.replaceRules(jwtSub, subscriptionId, decodedBody)
        }),
        c,
      ).pipe(
        Effect.withSpan('v1.replace_subscription_rules'),
        Effect.as(c.body(null, 204)),
        Effect.either,
        withRouteTimeout,
        Effect.exit,
        Runtime_.runPromise(runtime),
      )

      return handleFailure(result, c)
    })
})

export const makeSubscriptionRoutes = Effect.fn('v1.make_subscription_routes')(() =>
  makeSubscriptionRouteWithoutDependencies
)
