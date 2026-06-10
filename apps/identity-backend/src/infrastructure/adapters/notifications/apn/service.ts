import type { PushNotificationRequest } from '@identity-backend/mobile-push-notifications'
import {
  type PushNotificationService,
  PushNotificationTokenInvalidError,
} from '@identity-backend/mobile-push-notifications'
import { FlatApnsPayload, StatementApnsPayloadWire } from '@identity-backend/mobile-push-notifications'
import {
  APNEnvironment,
  type APNSendTarget,
  APNTargetResult,
  APNTopic,
  type ValidDeviceToken,
} from '@identity-backend/mobile-push-notifications/apn'
import {
  aggregateResults,
  classifyApnsResult,
  decideLogging,
  formatTopic,
  resolveTopics,
  routeToEnvironments,
  validateToken,
} from '@identity-backend/mobile-push-notifications/apn'
import { EXPIRY_DEFAULT_SECONDS } from '@identity-backend/mobile-push-notifications/apn'
import {
  Clock,
  Config,
  Context,
  Effect,
  HashSet,
  Layer,
  Match,
  Option,
  Option as O,
  Redacted,
  Schema as S,
} from 'effect'

export class APNServiceConfig extends Context.Tag('APNServiceConfig')<APNServiceConfig, {
  privateKey: Redacted.Redacted<string>
  devPrivateKey?: Redacted.Redacted<string>
  devKeyId?: string
  alertTitle: string
  keyId: string
  teamId: string
  topics: readonly APNTopic[]
  defaultEnvironment: APNEnvironment
  developmentSuffixes: HashSet.HashSet<string>
}>() {}

export class ApnsDefaults extends Context.Reference<ApnsDefaults>()('ApnsDefaults', {
  defaultValue: () => ({
    priority: 10,
    voipExpiry: 0,
  }),
}) {}

export namespace APNService {
  export interface Definition {
    readonly send: PushNotificationService.Definition['send']
  }
}

const make = Effect.gen(function*() {
  const config = yield* APNServiceConfig

  const apn = yield* Effect.promise(() => import('@parse/node-apn'))

  const createProvider = (production: boolean, key: Redacted.Redacted<string>, keyId: string) =>
    Effect.sync(() =>
      new apn.Provider({
        token: {
          key: Buffer.from(Redacted.value(key), 'utf-8'),
          keyId: keyId,
          teamId: config.teamId,
        },
        production,
      })
    )

  const devProvider = yield* Effect.gen(function*() {
    const key = config.devPrivateKey ?? config.privateKey
    const keyId = config.devKeyId ?? config.keyId
    if (config.devPrivateKey === undefined) {
      yield* Effect.logWarning(
        'APN devPrivateKey not configured, falling back to production key for development environment',
      )
    }
    return yield* createProvider(false, key, keyId)
  })
  const prodProvider = yield* createProvider(true, config.privateKey, config.keyId)

  const providers: Record<APNEnvironment, InstanceType<typeof apn.Provider>> = {
    development: devProvider,
    production: prodProvider,
  }
  const encodeApnsWire = S.encodeSync(StatementApnsPayloadWire)

  const logSendResult = (target: APNSendTarget) => (result: APNTargetResult) =>
    Effect.gen(function*() {
      const reasons = result.result.failed.map(f => f.response?.reason)
      const logging = decideLogging(result.result.failed.length, reasons)

      return yield* Match.value(logging.level).pipe(
        Match.when('warning', () =>
          Effect.logWarning('APNs push completed with failures', {
            topic: target.topic,
            environment: target.environment,
            sent: result.result.sent.length,
            failed: result.result.failed.length,
            reasons: logging.reasons,
          })),
        Match.when('debug', () =>
          Effect.logDebug('APNs push sent', {
            topic: target.topic,
            environment: target.environment,
            sent: result.result.sent.length,
            apnsIds: result.result.sent.map(s => s['apns-id']).filter(Boolean),
          })),
        Match.exhaustive,
      )
    })

  const sendToTarget =
    (request: PushNotificationRequest, validatedToken: ValidDeviceToken) => (target: APNSendTarget) =>
      Effect.gen(function*() {
        const now = yield* Clock.currentTimeMillis
        const formatted = formatTopic(target.topic, request.voip ?? false)
        const apnsDefaults = yield* ApnsDefaults

        const notification = yield* Effect.sync(() => {
          const n = new apn.Notification()

          n.payload = Match.value(request).pipe(
            Match.tag('StatementPushRequest', (r) =>
              encodeApnsWire({
                statement: {
                  data: r.message,
                  topic: r.topic,
                  senderPubkey: r.senderPubkey,
                },
              })),
            Match.tag('FlatPushRequest', (r) => {
              const { _tag, ...clean } = new FlatApnsPayload({ pushId: r.pushId, message: r.message })
              return clean
            }),
            Match.exhaustive,
          )

          if (!request.voip) {
            n.aps.alert = { title: config.alertTitle }
            n.aps['mutable-content'] = 1
          }

          const truncated = Match.value(request).pipe(
            Match.tag('StatementPushRequest', (r) => r.truncated),
            Match.tag('FlatPushRequest', () => false),
            Match.exhaustive,
          )
          if (truncated) n.aps['content-available'] = 1

          n.pushType = request.voip ? 'voip' : 'alert'
          n.topic = formatted
          n.priority = apnsDefaults.priority
          n.expiry = request.voip
            ? apnsDefaults.voipExpiry
            : (request.expiry ?? Math.floor(now / 1000) + EXPIRY_DEFAULT_SECONDS)
          return n
        })

        const result = yield* Effect.promise(() =>
          providers[target.environment].send(notification, Redacted.value(validatedToken))
        )

        return APNTargetResult.make({
          environment: target.environment,
          topic: target.topic,
          result: {
            sent: result.sent ?? [],
            failed: result.failed ?? [],
          },
        })
      })

  const send: PushNotificationService.Definition['send'] = (request) =>
    Effect.gen(function*() {
      yield* Effect.annotateCurrentSpan({ pushId: request.pushId })

      const validatedToken = yield* validateToken(request.deviceToken)
      const topics = yield* resolveTopics(request.topics, config.topics)

      const targets = topics.flatMap((topic) =>
        routeToEnvironments(topic, config.defaultEnvironment, config.developmentSuffixes)
      )
      const results = yield* Effect.all(
        targets.map((target) =>
          sendToTarget(request, validatedToken)(target).pipe(
            Effect.tap(logSendResult(target)),
          )
        ),
        { concurrency: 'unbounded' },
      )

      const terminal = classifyApnsResult(Redacted.value(validatedToken), results)
      if (Option.isSome(terminal)) {
        return yield* Effect.fail(
          PushNotificationTokenInvalidError.make({
            platform: 'ios',
            reason: terminal.value.reason,
            providerCode: terminal.value.providerCode,
          }),
        )
      }

      return aggregateResults(results)
    })

  return APNService.of({ send })
}).pipe(Effect.scoped)

export class APNService extends Context.Tag('@app/APNService')<APNService, APNService.Definition>() {
  static readonly DefaultWithoutDependencies = Layer.effect(APNService, make)
  static readonly Default = Layer.suspend(() => APNService.DefaultWithoutDependencies).pipe(
    Layer.provide(Layer.effect(
      APNServiceConfig,
      Effect.gen(function*() {
        const config = yield* Effect.promise(() => import('#root/config.js'))

        const apnConfig = yield* Config.all({
          privateKey: config.APN_PRIVATE_KEY,
          devPrivateKey: config.APN_PRIVATE_KEY_DEV,
          devKeyId: config.APN_KEY_ID_DEV,
          keyId: config.APN_KEY_ID,
          teamId: config.APN_TEAM_ID,
          topics: config.APN_TOPICS,
          defaultEnvironment: config.APN_PRODUCTION,
          developmentSuffixes: config.APN_DEVELOPMENT_SUFFIXES,
          dualFlowEnabled: config.DUAL_FLOW_NOTIFICATIONS_ENABLED,
        })

        return APNServiceConfig.of({
          privateKey: apnConfig.privateKey,
          keyId: apnConfig.keyId,
          teamId: apnConfig.teamId,
          topics: apnConfig.topics.map((t) => APNTopic.make(t)),
          defaultEnvironment: apnConfig.defaultEnvironment,
          developmentSuffixes: apnConfig.dualFlowEnabled
            ? apnConfig.developmentSuffixes
            : HashSet.empty<string>(),
          alertTitle: 'Polkadot',
          ...(O.isSome(apnConfig.devPrivateKey) && { devPrivateKey: apnConfig.devPrivateKey.value }),
          ...(O.isSome(apnConfig.devKeyId) && { devKeyId: apnConfig.devKeyId.value }),
        })
      }),
    )),
  )
}
