import {
  DeliveryChannel,
  DeviceToken,
  NotifyType,
  RedactedDeviceToken,
} from '@identity-backend/mobile-push-notifications'
import { StatementHash, VerifiedStatement } from '@identity-backend/statement-store/live'
import { Brand, Schema as S } from 'effect'

export { DeliveryChannel, DeviceToken, NotifyType, RedactedDeviceToken, StatementHash, VerifiedStatement }

export const PublicKey = S.Uint8ArrayFromSelf.pipe(
  S.filter((b) => b.byteLength === 32, { message: () => 'PublicKey must be 32 bytes' }),
  S.annotations({
    arbitrary: () => (fc) => fc.uint8Array({ minLength: 32, maxLength: 32 }),
  }),
  S.brand('PublicKey'),
)
export type PublicKey = S.Schema.Type<typeof PublicKey>

export const RedactedPublicKey = S.RedactedFromSelf(PublicKey)
export type RedactedPublicKey = S.Schema.Type<typeof RedactedPublicKey>

export type Topic = string & Brand.Brand<'Topic'>

export const Topic = S.String.pipe(
  S.minLength(1),
  S.brand('Topic'),
)

export const SubscriptionId = S.UUID.pipe(S.brand('SubscriptionId'))
export type SubscriptionId = S.Schema.Type<typeof SubscriptionId>

export type RuleId = string & Brand.Brand<'RuleId'>

export const RuleId = S.UUID.pipe(S.brand('RuleId'))

export const ContentEncoding = S.Literal('aes128gcm', 'aesgcm')
export type ContentEncoding = S.Schema.Type<typeof ContentEncoding>

const TokenTypeId: unique symbol = Symbol.for('@identity-backend/Token')
export type TokenTypeId = typeof TokenTypeId

export class TokenMobile extends S.TaggedClass<TokenMobile>()('Mobile', {
  token: RedactedDeviceToken,
}) {
  readonly [TokenTypeId] = TokenTypeId
}

export class TokenWeb extends S.TaggedClass<TokenWeb>()('Web', {
  endpoint: S.String.pipe(S.minLength(1), S.maxLength(4096)),
  p256dh: S.String.pipe(S.minLength(1), S.maxLength(1024)),
  auth: S.String.pipe(S.minLength(1), S.maxLength(512)),
  contentEncoding: ContentEncoding,
}) {
  readonly [TokenTypeId] = TokenTypeId
}

export class TokenInvalidated extends S.TaggedClass<TokenInvalidated>()('Invalidated', {}) {
  readonly [TokenTypeId] = TokenTypeId
}

export const SubscriptionToken = S.Union(TokenMobile, TokenWeb, TokenInvalidated)
export type SubscriptionToken = S.Schema.Type<typeof SubscriptionToken>

const SubscriptionTypeId: unique symbol = Symbol.for('@identity-backend/Subscription')
export type SubscriptionTypeId = typeof SubscriptionTypeId

export class Subscription extends S.Class<Subscription>('Subscription')({
  id: SubscriptionId,
  clientId: S.String,
  notificationType: NotifyType,
  token: SubscriptionToken,
  createdAt: S.ValidDateFromSelf,
  updatedAt: S.Union(S.ValidDateFromSelf, S.Null),
}) {
  readonly [SubscriptionTypeId] = SubscriptionTypeId
}

export class SubscriptionRule extends S.Class<SubscriptionRule>('SubscriptionRule')({
  id: RuleId,
  subscriptionId: SubscriptionId,
  senderPubkey: RedactedPublicKey,
  topic: Topic,
  createdAt: S.ValidDateFromSelf,
}) {}

export class PushRecord extends S.Class<PushRecord>('PushRecord')({
  id: S.UUID,
  subscriptionId: SubscriptionId,
  statementHash: S.String,
  senderPubkey: RedactedPublicKey,
  topic: Topic,
  notifyType: NotifyType,
  deliveryChannel: DeliveryChannel,
  sentAt: S.ValidDateFromSelf,
}) {}

export class RateLimitRecord extends S.Class<RateLimitRecord>('RateLimitRecord')({
  senderPubkey: RedactedPublicKey,
  clientId: S.String,
  windowStart: S.ValidDateFromSelf,
  notificationCount: S.Number.pipe(S.int(), S.greaterThanOrEqualTo(0)),
}) {}

export class DeliveryPlan extends S.Class<DeliveryPlan>('DeliveryPlan')({
  subscriptionId: SubscriptionId,
  ruleId: RuleId,
  senderPubkey: RedactedPublicKey,
  topic: Topic,
}) {}

const NoMatchesTypeId: unique symbol = Symbol.for('@identity-backend/NoMatches')
export type NoMatchesTypeId = typeof NoMatchesTypeId

export class NoMatches extends S.TaggedClass<NoMatches>()('NoMatches', {}) {
  readonly [NoMatchesTypeId] = NoMatchesTypeId
}

const DeliverTypeId: unique symbol = Symbol.for('@identity-backend/Deliver')
export type DeliverTypeId = typeof DeliverTypeId

export class Deliver extends S.TaggedClass<Deliver>()('Deliver', {
  plans: S.Array(DeliveryPlan),
}) {
  readonly [DeliverTypeId] = DeliverTypeId
}

const SkipTypeId: unique symbol = Symbol.for('@identity-backend/Skip')
export type SkipTypeId = typeof SkipTypeId

export class Skip extends S.TaggedClass<Skip>()('Skip', {
  reason: S.Literal('no_sender', 'no_topics', 'signature_invalid', 'rate_limited', 'duplicate'),
}) {
  readonly [SkipTypeId] = SkipTypeId
}

export type ProcessingDecision = NoMatches | Deliver | Skip

const MAX_DATE_MS = 8640000000000000
const MAX_WINDOW_SIZE_MS = 86_400_000

export const PipelineRateState = S.Struct({
  windowStart: S.ValidDateFromSelf.pipe(
    S.filter((d) => d.getTime() <= MAX_DATE_MS - MAX_WINDOW_SIZE_MS, {
      message: () => 'windowStart + windowSizeMs would exceed Date max',
    }),
    S.annotations({
      arbitrary: () => (fc) => fc.date({ min: new Date(0), max: new Date(MAX_DATE_MS - MAX_WINDOW_SIZE_MS) }),
    }),
  ),
  notificationCount: S.Number.pipe(S.int(), S.greaterThanOrEqualTo(0)),
}).pipe(S.brand('RateState'))

export const PipelineRateLimitConfig = S.Struct({
  windowSizeMs: S.Number.pipe(S.int(), S.positive(), S.lessThanOrEqualTo(86_400_000)),
  maxPerWindow: S.Number.pipe(S.int(), S.positive(), S.lessThanOrEqualTo(10_000)),
  cooldownMs: S.Number.pipe(S.int(), S.positive(), S.lessThanOrEqualTo(86_400_000)),
}).pipe(
  S.filter((config) => config.cooldownMs > config.windowSizeMs, {
    message: () => 'cooldownMs must be greater than windowSizeMs',
  }),
  S.annotations({
    arbitrary: () => (fc) =>
      fc
        .tuple(
          fc.integer({ min: 1, max: 86_399_999 }),
          fc.integer({ min: 1, max: 10_000 }),
        )
        .chain(([windowSizeMs, maxPerWindow]) =>
          fc.integer({ min: windowSizeMs + 1, max: 86_400_000 }).map(
            (cooldownMs) => ({ windowSizeMs, maxPerWindow, cooldownMs }),
          )
        ),
  }),
  S.brand('RateLimitConfig'),
)

export class ProcessStatementCommand extends S.Class<ProcessStatementCommand>('ProcessStatementCommand')({
  rules: S.Array(SubscriptionRule),
  existingHashes: S.Array(StatementHash),
  rateState: S.optional(PipelineRateState),
  rateLimitConfig: PipelineRateLimitConfig,
  now: S.DateFromSelf,
  statementHash: StatementHash,
}) {}
