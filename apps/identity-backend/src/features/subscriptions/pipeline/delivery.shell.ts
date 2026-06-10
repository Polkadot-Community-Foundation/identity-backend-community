import { DB, schema } from '#root/db/mod.js'
import { APNService } from '#root/infrastructure/adapters/notifications/apn/index.js'
import { FCMPushService } from '#root/infrastructure/adapters/notifications/fcm/index.js'
import { WebPushService } from '#root/infrastructure/adapters/notifications/web/web-push.service.js'
import { toShortSs58Address } from '#root/lib/ss58.js'
import { delivery } from '@identity-backend/mobile-push-notifications'
import {
  type NotifyType,
  type PushNotificationRequest,
  PushNotificationServiceError,
  PushNotificationTokenInvalidError,
  type PushNotificationValidationError,
  StatementPushRequest,
  type TokenInvalidReason,
} from '@identity-backend/mobile-push-notifications'
import { and, eq } from 'drizzle-orm'
import { Context, Effect, Either, Layer, Match, Metric, Option, Redacted } from 'effect'
import { toHex } from 'polkadot-api/utils'
import { PushDeliveryFailed } from '../errors.js'
import { pushDeliveryCounter, pushDeliveryLatencyHistogram, SpanAttributes } from '../telemetry.js'
import type {
  DeliveryPlan,
  PublicKey,
  StatementHash,
  Subscription,
  SubscriptionId,
  SubscriptionRule,
  SubscriptionToken,
  Topic,
} from '../types.js'
import { type DeliveryChannel } from '../types.js'
import { computeNewRateState, DEFAULT_RATE_LIMIT_CONFIG } from './rate-limit.js'

interface DeliverPlanOptions {
  readonly plan: DeliveryPlan
  readonly subscription: Subscription
  readonly rule: SubscriptionRule
  readonly statementHash: StatementHash
  readonly statementData: string
  // Structured form of `statementData` for web push, which delivers JSON natively
  // and must not double-encode. When null, web push sends `content: null`.
  readonly content: Record<string, unknown> | null
  readonly senderPubkey: Redacted.Redacted<PublicKey>
  readonly topic: Topic
  readonly rateState: { readonly windowStart: Date; readonly notificationCount: number } | undefined
  readonly now: number
}

interface RecordOutcomeOptions {
  readonly plan: DeliveryPlan
  readonly statementHash: StatementHash
  readonly senderPubkey: Redacted.Redacted<PublicKey>
  readonly topic: Topic
  readonly notifyType: string
  readonly channel: DeliveryChannel
}

type SendPushSdkError =
  | PushNotificationValidationError
  | PushNotificationServiceError
  | PushNotificationTokenInvalidError

type SendPushFailure = SendPushSdkError | PushDeliveryFailed

type FailureClassification =
  | {
    readonly kind: 'terminal_token'
    readonly retryable: false
    readonly reason: TokenInvalidReason
    readonly providerCode: string | undefined
  }
  | {
    readonly kind: 'validation'
    readonly retryable: false
    readonly reason: 'validation_error' | 'vapid_not_configured'
  }
  | {
    readonly kind: 'transient'
    readonly retryable: true
    readonly reason: string
  }

const classifyFailure = (error: SendPushFailure): FailureClassification =>
  Match.value(error).pipe(
    Match.tag('PushNotificationTokenInvalidError', (e): FailureClassification => ({
      kind: 'terminal_token',
      retryable: false,
      reason: e.reason,
      providerCode: e.providerCode,
    })),
    Match.tag('PushNotificationValidationError', (): FailureClassification => ({
      kind: 'validation',
      retryable: false,
      reason: 'validation_error',
    })),
    Match.tag('PushNotificationServiceError', (): FailureClassification => ({
      kind: 'transient',
      retryable: true,
      reason: 'service_error',
    })),
    Match.tag('PushDeliveryFailed', (e): FailureClassification => {
      if (e.reason === 'vapid_not_configured') {
        return { kind: 'validation', retryable: false, reason: 'vapid_not_configured' }
      }
      return { kind: 'transient', retryable: true, reason: e.reason }
    }),
    Match.exhaustive,
  )

type ActiveSubscriptionToken =
  | Extract<SubscriptionToken, { readonly _tag: 'Mobile' }>
  | Extract<SubscriptionToken, { readonly _tag: 'Web' }>

const make = Effect.gen(function*() {
  const db = yield* DB
  const apnService = yield* APNService
  const fcmService = yield* FCMPushService

  const updateRateLimit = (opts: {
    readonly clientId: string
    readonly senderPubkey: Redacted.Redacted<PublicKey>
    readonly currentWindowStart: Date | undefined
    readonly currentCount: number
    readonly now: number
  }) =>
    Effect.gen(function*() {
      const rateState = {
        windowStart: opts.currentWindowStart ?? new Date(0),
        notificationCount: opts.currentCount,
      }
      const newState = computeNewRateState(rateState, new Date(opts.now), DEFAULT_RATE_LIMIT_CONFIG)
      yield* Effect.tryPromise(() =>
        db
          .insert(schema.rateLimit)
          .values({
            senderPubkey: toHex(Redacted.value(opts.senderPubkey)),
            clientId: opts.clientId,
            windowStart: newState.windowStart,
            notificationCount: newState.notificationCount,
          })
          .onConflictDoUpdate({
            target: [schema.rateLimit.senderPubkey, schema.rateLimit.clientId],
            set: {
              windowStart: newState.windowStart,
              notificationCount: newState.notificationCount,
            },
          })
      ).pipe(Effect.orDie)
    })

  const sendMobilePush = (
    token: Extract<SubscriptionToken, { readonly _tag: 'Mobile' }>,
    channel: Exclude<DeliveryChannel, 'web_push'>,
    notificationType: NotifyType,
    payload: {
      readonly statementHash: StatementHash
      readonly statementData: string | null
      readonly senderPubkey: Redacted.Redacted<PublicKey>
      readonly topic: Topic
      readonly truncated: boolean
    },
  ) => {
    const req: PushNotificationRequest = new StatementPushRequest({
      deviceToken: token.token,
      pushId: payload.statementHash,
      message: payload.statementData,
      topic: payload.topic,
      senderPubkey: toHex(Redacted.value(payload.senderPubkey)),
      truncated: payload.truncated,
      voip: channel === 'voip_apns',
      notificationType,
    })
    return channel === 'fcm' ? fcmService.send(req) : apnService.send(req)
  }

  const sendWebPush = (
    token: Extract<SubscriptionToken, { readonly _tag: 'Web' }>,
    payload: {
      readonly senderPubkey: Redacted.Redacted<PublicKey>
      readonly topic: Topic
      readonly content: Record<string, unknown> | null
    },
  ) =>
    Effect.gen(function*() {
      const webPushSvc = yield* Effect.serviceOption(WebPushService)
      if (Option.isNone(webPushSvc)) {
        return yield* Effect.fail(
          PushDeliveryFailed.make({ deliveryChannel: 'web_push', reason: 'vapid_not_configured' }),
        )
      }

      return yield* webPushSvc.value.send(
        {
          endpoint: token.endpoint,
          p256dh: token.p256dh,
          auth: token.auth,
          contentEncoding: token.contentEncoding,
        },
        {
          signer: Redacted.value(payload.senderPubkey),
          topic: payload.topic,
          content: payload.content,
        },
      ).pipe(
        Effect.catchTag('WebPushTerminalError', (error) =>
          Effect.fail(
            new PushNotificationTokenInvalidError({
              platform: 'web',
              reason: 'token_unregistered',
              cause: error.cause,
            }),
          )),
        Effect.catchTag('WebPushDeliveryError', (error) =>
          Effect.fail(PushNotificationServiceError.make({ cause: error.cause }))),
      )
    })

  const sendPush = Effect.fn('send_push')(
    function*(opts: {
      readonly token: ActiveSubscriptionToken
      readonly channel: DeliveryChannel
      readonly notificationType: NotifyType
      readonly payload: {
        readonly statementHash: StatementHash
        readonly statementData: string | null
        readonly content: Record<string, unknown> | null
        readonly senderPubkey: Redacted.Redacted<PublicKey>
        readonly topic: Topic
        readonly truncated: boolean
      }
    }) {
      const push = Match.value(opts.token).pipe(
        Match.tag('Mobile', (t) => {
          if (opts.channel === 'web_push') {
            return Effect.fail(
              PushDeliveryFailed.make({ deliveryChannel: 'web_push', reason: 'mobile_token_on_web_channel' }),
            )
          }
          return sendMobilePush(t, opts.channel, opts.notificationType, opts.payload)
        }),
        Match.tag('Web', (t) => {
          if (opts.channel !== 'web_push') {
            return Effect.fail(
              PushDeliveryFailed.make({ deliveryChannel: opts.channel, reason: 'web_token_on_mobile_channel' }),
            )
          }
          return sendWebPush(t, {
            senderPubkey: opts.payload.senderPubkey,
            topic: opts.payload.topic,
            content: opts.payload.content,
          }).pipe(Effect.map(() => ({ success: true, failed: 0 } as const)))
        }),
        Match.exhaustive,
      )

      return yield* push
    },
  )

  const recordSuccess = (opts: RecordOutcomeOptions) =>
    // ON CONFLICT DO NOTHING relies on push_record_subscription_statement_unique_idx
    // to make the SELECT-then-INSERT dedup in BroadcastShell race-safe — a concurrent
    // broadcast that lost the race silently no-ops here instead of erroring.
    Effect.tryPromise(() =>
      db.insert(schema.pushRecord).values({
        subscriptionId: opts.plan.subscriptionId,
        statementHash: opts.statementHash,
        senderPubkey: toHex(Redacted.value(opts.senderPubkey)),
        topic: opts.topic,
        notifyType: opts.notifyType,
        deliveryChannel: opts.channel,
      }).onConflictDoNothing({
        target: [schema.pushRecord.subscriptionId, schema.pushRecord.statementHash],
      })
    ).pipe(Effect.orDie)

  const recordFailure = (opts: RecordOutcomeOptions & { readonly classification: FailureClassification }) =>
    Effect.gen(function*() {
      const span = yield* Effect.currentSpan.pipe(Effect.orElse(() => Effect.succeed(null)))

      yield* Effect.tryPromise(() =>
        db.insert(schema.failedPushRecord).values({
          subscriptionId: opts.plan.subscriptionId,
          statementHash: opts.statementHash,
          senderPubkey: toHex(Redacted.value(opts.senderPubkey)),
          topic: opts.topic,
          notifyType: opts.notifyType,
          deliveryChannel: opts.channel,
          traceId: span?.traceId ?? null,
          spanId: span?.spanId ?? null,
          retryable: opts.classification.retryable,
        })
      ).pipe(Effect.orDie)
    })

  const recordFailureAndClearToken = (
    opts:
      & RecordOutcomeOptions
      & {
        readonly classification: FailureClassification
        readonly subscriptionId: SubscriptionId
        readonly token: ActiveSubscriptionToken
      },
  ) =>
    Effect.gen(function*() {
      const span = yield* Effect.currentSpan.pipe(Effect.orElse(() => Effect.succeed(null)))
      const now = new Date(yield* Effect.clockWith((clock) => clock.currentTimeMillis))

      // CAS-style guard: only null the columns if the variant's discriminating
      // identifier still matches the one we attempted with — protects against
      // a concurrent re-subscribe writing a new token between send and clear.
      const guard = Match.value(opts.token).pipe(
        Match.tag('Mobile', (t) => eq(schema.pushSubscription.token, Redacted.value(t.token))),
        Match.tag('Web', (t) => eq(schema.pushSubscription.endpoint, t.endpoint)),
        Match.exhaustive,
      )

      yield* Effect.tryPromise(() =>
        db.transaction(async (tx) => {
          await tx.insert(schema.failedPushRecord).values({
            subscriptionId: opts.plan.subscriptionId,
            statementHash: opts.statementHash,
            senderPubkey: toHex(Redacted.value(opts.senderPubkey)),
            topic: opts.topic,
            notifyType: opts.notifyType,
            deliveryChannel: opts.channel,
            traceId: span?.traceId ?? null,
            spanId: span?.spanId ?? null,
            retryable: opts.classification.retryable,
          })
          await tx.update(schema.pushSubscription)
            .set({
              token: null,
              endpoint: null,
              p256dhKey: null,
              authKey: null,
              contentEncoding: null,
              updatedAt: now,
            })
            .where(and(eq(schema.pushSubscription.id, opts.subscriptionId), guard))
        })
      ).pipe(Effect.orDie)
    })

  const deliverPlan = Effect.fn('deliver_plan')(
    (opts: DeliverPlanOptions) =>
      Effect.gen(function*() {
        const channel = delivery.selectChannel(opts.subscription.notificationType)

        yield* Effect.annotateCurrentSpan({
          [SpanAttributes.SUBSCRIPTION_ID]: opts.plan.subscriptionId,
          [SpanAttributes.DELIVERY_CHANNEL]: channel,
        })

        yield* Effect.annotateLogsScoped({
          [SpanAttributes.SUBSCRIPTION_ID]: opts.plan.subscriptionId,
          [SpanAttributes.DELIVERY_CHANNEL]: channel,
        })

        const { data: fitData, truncated } = delivery.fitPayloadData(opts.statementData, {
          notifyType: opts.subscription.notificationType,
        })
        const payload = {
          statementHash: opts.statementHash,
          statementData: fitData,
          senderPubkey: opts.senderPubkey,
          topic: opts.topic,
          truncated,
        }
        yield* Effect.logDebug('Push payload prepared', {
          'sender.pubkey': toShortSs58Address(opts.senderPubkey),
        })
        const outcomeBase: RecordOutcomeOptions = {
          plan: opts.plan,
          statementHash: opts.statementHash,
          senderPubkey: opts.senderPubkey,
          topic: opts.topic,
          notifyType: opts.subscription.notificationType,
          channel,
        }

        const activeToken: Option.Option<ActiveSubscriptionToken> = Match.value(opts.subscription.token).pipe(
          Match.tag('Invalidated', () => Option.none<ActiveSubscriptionToken>()),
          Match.tag('Mobile', (token) => Option.some(token)),
          Match.tag('Web', (token) => Option.some(token)),
          Match.exhaustive,
        )

        if (Option.isNone(activeToken)) {
          yield* Effect.annotateCurrentSpan({
            [SpanAttributes.ERROR_CATEGORY]: 'validation',
            [SpanAttributes.ERROR_RETRYABLE]: false,
            [SpanAttributes.SUBSCRIPTION_ID]: opts.plan.subscriptionId,
            [SpanAttributes.DELIVERY_CHANNEL]: channel,
          })
          yield* Effect.logWarning('Push delivery skipped - token missing')
          yield* Metric.increment(Metric.tagged(pushDeliveryCounter, 'result', 'failure'))
          return 0
        }
        const subscriptionToken = activeToken.value

        const result = yield* sendPush({
          token: subscriptionToken,
          channel,
          notificationType: opts.subscription.notificationType,
          payload: { ...payload, content: opts.content },
        }).pipe(
          Metric.trackDuration(pushDeliveryLatencyHistogram),
          Effect.flatMap((pushResult) => {
            if (pushResult.success !== true || (pushResult.failed ?? 0) !== 0) {
              return Effect.fail(
                PushDeliveryFailed.make({
                  deliveryChannel: channel,
                  reason: 'partial_failure',
                }),
              )
            }
            return Effect.succeed(pushResult)
          }),
          Effect.either,
        )

        if (Either.isLeft(result)) {
          const error = result.left
          const classification = classifyFailure(error)
          const isTerminalToken = classification.kind === 'terminal_token'

          yield* Effect.annotateCurrentSpan({
            [SpanAttributes.SUBSCRIPTION_ID]: opts.plan.subscriptionId,
            [SpanAttributes.DELIVERY_CHANNEL]: channel,
            [SpanAttributes.ERROR_CATEGORY]: classification.kind,
            [SpanAttributes.ERROR_SUBCATEGORY]: classification.reason,
            [SpanAttributes.ERROR_RETRYABLE]: classification.retryable,
            [SpanAttributes.TOKEN_TERMINAL]: isTerminalToken,
            ...(classification.kind === 'terminal_token'
              ? {
                [SpanAttributes.TOKEN_TERMINAL_REASON]: classification.reason,
                ...(classification.providerCode !== undefined
                  ? { [SpanAttributes.TOKEN_PROVIDER_CODE]: classification.providerCode }
                  : {}),
              }
              : {}),
          })

          yield* classification.kind === 'terminal_token'
            ? Effect.logWarning('Push delivery failed - terminal token invalidation', {
              tokenReason: classification.reason,
              providerCode: classification.providerCode,
            })
            : Effect.logWarning('Push delivery failed', error)

          if (isTerminalToken) {
            yield* recordFailureAndClearToken({
              ...outcomeBase,
              classification,
              subscriptionId: opts.plan.subscriptionId,
              token: subscriptionToken,
            })
            yield* Metric.increment(
              Metric.tagged(
                Metric.tagged(pushDeliveryCounter, 'result', 'failure'),
                'terminal',
                'true',
              ),
            )
          } else {
            yield* recordFailure({ ...outcomeBase, classification })
            yield* Metric.increment(
              Metric.tagged(
                Metric.tagged(pushDeliveryCounter, 'result', 'failure'),
                'terminal',
                'false',
              ),
            )
          }

          return yield* Match.value(error).pipe(
            Match.tag(
              'PushNotificationTokenInvalidError',
              (terminalError): Effect.Effect<never, PushDeliveryFailed | PushNotificationTokenInvalidError> =>
                Effect.fail(terminalError),
            ),
            Match.orElse(
              (): Effect.Effect<never, PushDeliveryFailed | PushNotificationTokenInvalidError> =>
                Effect.fail(
                  PushDeliveryFailed.make({
                    deliveryChannel: channel,
                    reason: classification.reason,
                  }),
                ),
            ),
          )
        }

        yield* recordSuccess(outcomeBase)

        yield* updateRateLimit({
          clientId: opts.subscription.clientId,
          senderPubkey: opts.senderPubkey,
          currentWindowStart: opts.rateState?.windowStart,
          currentCount: opts.rateState?.notificationCount ?? 0,
          now: opts.now,
        })

        yield* Metric.increment(Metric.tagged(pushDeliveryCounter, 'result', 'success'))
        yield* Effect.logDebug('Push delivered successfully')

        return 1
      }),
    Effect.scoped,
    Effect.withLogSpan('push_delivery.deliver_plan'),
  ) satisfies PushDeliveryShell['Type']['deliverPlan']

  return PushDeliveryShell.of({ deliverPlan })
})
export namespace PushDeliveryShell {
  export interface Definition {
    readonly deliverPlan: (
      opts: DeliverPlanOptions,
    ) => Effect.Effect<number, PushDeliveryFailed | PushNotificationTokenInvalidError>
  }
}

export class PushDeliveryShell extends Context.Tag('@app/PushDeliveryShell')<
  PushDeliveryShell,
  PushDeliveryShell.Definition
>() {
  static readonly Default = Layer.scoped(PushDeliveryShell, make)
}
