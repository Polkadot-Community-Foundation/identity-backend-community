import { PrefixedHex } from '@identity-backend/substrate-schema'
import { Context, Effect, Encoding, Layer, Redacted, Schema as S } from 'effect'

// ── Error types ────────────────────────────────────────────────────────────

export class WebPushTerminalError extends S.TaggedError<WebPushTerminalError>()('WebPushTerminalError', {
  cause: S.optional(S.Unknown),
}) {}

export class WebPushDeliveryError extends S.TaggedError<WebPushDeliveryError>()('WebPushDeliveryError', {
  cause: S.optional(S.Unknown),
}) {}

// ── Service definition ─────────────────────────────────────────────────────

export namespace WebPushService {
  export interface Definition {
    readonly send: (
      subscription: {
        readonly endpoint: string
        readonly p256dh: string
        readonly auth: string
        readonly contentEncoding: 'aes128gcm' | 'aesgcm'
      },
      payload: {
        readonly signer: Uint8Array
        readonly topic: string
        readonly content: Record<string, unknown> | null
      },
    ) => Effect.Effect<void, WebPushTerminalError | WebPushDeliveryError>
  }
}

export class WebPushServiceConfig extends Context.Tag('@app/WebPushServiceConfig')<
  WebPushServiceConfig,
  {
    readonly publicKey: Uint8Array
    readonly privateKey: Redacted.Redacted<Uint8Array>
    readonly subject: string
  }
>() {}

// ── Implementation ─────────────────────────────────────────────────────────

const WebPushPayload = S.parseJson(
  S.Struct({
    signer: PrefixedHex,
    topic: S.String,
    content: S.NullishOr(S.Record({ key: S.String, value: S.Unknown })),
  }),
)

const make = Effect.gen(function*() {
  const cfg = yield* WebPushServiceConfig
  const webPush = yield* Effect.promise(() => import('web-push'))

  yield* Effect.sync(() =>
    webPush.setVapidDetails(
      cfg.subject,
      Encoding.encodeBase64Url(cfg.publicKey),
      Encoding.encodeBase64Url(Redacted.value(cfg.privateKey)),
    )
  )

  const send: WebPushService.Definition['send'] = (subscription, payload) =>
    Effect.gen(function*() {
      const signerHex = yield* S.decode(PrefixedHex)(Encoding.encodeHex(payload.signer)).pipe(Effect.orDie)
      const wire = yield* S.encode(WebPushPayload)({
        signer: signerHex,
        topic: payload.topic,
        content: payload.content,
      }).pipe(Effect.orDie)

      yield* Effect.tryPromise({
        try: () =>
          webPush.sendNotification(
            { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
            wire,
            { contentEncoding: subscription.contentEncoding, timeout: 30_000 },
          ),
        catch: (cause) => {
          if (cause instanceof webPush.WebPushError) {
            if (cause.statusCode === 404 || cause.statusCode === 410) {
              return new WebPushTerminalError({ cause })
            }
            return new WebPushDeliveryError({ cause })
          }
          return new WebPushDeliveryError({ cause })
        },
      })
    })

  return WebPushService.of({ send })
})

export class WebPushService extends Context.Tag('@app/WebPushService')<
  WebPushService,
  WebPushService.Definition
>() {
  static readonly DefaultWithoutDependencies = Layer.effect(WebPushService, make)
}
