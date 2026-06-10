import { schema } from '#root/db/mod.js'
import { createInsertSchema, createSelectSchema } from 'drizzle-orm/effect-schema'
import type { BuildRefine } from 'drizzle-orm/effect-schema/schema.types.internal'
import { Match, ParseResult, Redacted, Schema as S } from 'effect'
import { fromHex } from 'polkadot-api/utils'
import {
  DeviceToken,
  PublicKey,
  Subscription,
  SubscriptionRule,
  TokenInvalidated,
  TokenMobile,
  TokenWeb,
} from './types.js'

const selectColumnOverrides = {
  createdAt: () => S.DateFromSelf,
  updatedAt: () => S.NullOr(S.DateFromSelf),
} satisfies BuildRefine<typeof schema.pushSubscription._.columns>

const SelectPushSubscriptionSchema = createSelectSchema(schema.pushSubscription, selectColumnOverrides).pipe(
  S.annotations({ name: 'SelectPushSubscriptionSchema' }),
)

const decodeSubscription = ParseResult.decode(Subscription)

export const SelectPushSubscriptionACL = S.transformOrFail(
  SelectPushSubscriptionSchema,
  Subscription,
  {
    strict: true,
    decode: (row) => {
      const token = Match.value(row).pipe(
        Match.when(
          {
            notificationType: 'web' as const,
            endpoint: Match.defined,
            p256dhKey: Match.defined,
            authKey: Match.defined,
            contentEncoding: Match.defined,
          },
          (r) =>
            TokenWeb.make({
              endpoint: r.endpoint,
              p256dh: r.p256dhKey,
              auth: r.authKey,
              contentEncoding: r.contentEncoding,
            }),
        ),
        Match.when(
          { token: Match.defined },
          (r) => TokenMobile.make({ token: Redacted.make(DeviceToken.make(r.token)) }),
        ),
        Match.orElse(() => TokenInvalidated.make({})),
      )
      return decodeSubscription({
        id: row.id,
        clientId: row.clientId,
        notificationType: row.notificationType,
        token,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      })
    },
    encode: (_, __, ast) => ParseResult.fail(new ParseResult.Forbidden(ast, _, 'Decode-only')),
  },
).pipe(S.annotations({ name: 'SelectPushSubscriptionACL' }))

const InsertPushSubscriptionSchema = createInsertSchema(schema.pushSubscription).pipe(
  S.pick('clientId', 'notificationType', 'token', 'endpoint', 'p256dhKey', 'authKey', 'contentEncoding'),
  S.annotations({ name: 'InsertPushSubscriptionSchema' }),
)

const UpsertInput = S.Struct({
  clientId: S.String,
  notificationType: S.Literal('apns', 'voip', 'fcm', 'web'),
  token: S.Union(TokenMobile, TokenWeb),
})

export const UpsertPushSubscriptionACL = S.transformOrFail(
  InsertPushSubscriptionSchema,
  UpsertInput,
  {
    strict: true,
    decode: (_, __, ast) => ParseResult.fail(new ParseResult.Forbidden(ast, _, 'Encode-only')),
    encode: (input) => {
      const columns = Match.value(input.token).pipe(
        Match.tag('Mobile', (t) => ({
          token: Redacted.value(t.token),
          endpoint: null,
          p256dhKey: null,
          authKey: null,
          contentEncoding: null,
        })),
        Match.tag('Web', (t) => ({
          token: null,
          endpoint: t.endpoint,
          p256dhKey: t.p256dh,
          authKey: t.auth,
          contentEncoding: t.contentEncoding,
        })),
        Match.exhaustive,
      )
      return ParseResult.succeed({
        clientId: input.clientId,
        notificationType: input.notificationType,
        ...columns,
      })
    },
  },
).pipe(S.annotations({ name: 'UpsertPushSubscriptionACL' }))

const selectSubscriptionRuleColumnOverrides = {
  createdAt: () => S.DateFromSelf,
} satisfies BuildRefine<typeof schema.subscriptionRule._.columns>

const SelectSubscriptionRuleSchema = createSelectSchema(schema.subscriptionRule, selectSubscriptionRuleColumnOverrides)
  .pipe(
    S.annotations({ name: 'SelectSubscriptionRuleSchema' }),
  )

export const SelectSubscriptionRuleACL = S.transformOrFail(
  SelectSubscriptionRuleSchema,
  SubscriptionRule,
  {
    strict: true,
    decode: (row) =>
      ParseResult.succeed({
        id: row.id,
        subscriptionId: row.subscriptionId,
        senderPubkey: Redacted.make(PublicKey.make(fromHex(row.senderPubkey))),
        topic: row.topic,
        createdAt: row.createdAt,
      }),
    encode: (_, __, ast) => ParseResult.fail(new ParseResult.Forbidden(ast, _, 'Decode-only')),
  },
).pipe(S.annotations({ name: 'SelectSubscriptionRuleACL' }))

export const SelectRateLimitSchema = createSelectSchema(schema.rateLimit, {
  windowStart: S.ValidDateFromSelf,
  notificationCount: S.Number.pipe(S.int(), S.greaterThanOrEqualTo(0)),
}).pipe(S.annotations({ name: 'SelectRateLimitSchema' }))
