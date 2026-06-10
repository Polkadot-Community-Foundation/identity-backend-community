import { SubscriptionDaemonShell } from '#root/features/subscriptions/pipeline/processor.shell.js'
import { SpanAttributes } from '#root/features/subscriptions/telemetry.js'
import { Daemon } from '@identity-backend/effect-daemon-spec'
import { Context, Duration, Effect, Match, Stream } from 'effect'

export const getErrorSubcategory = (err: { readonly _tag: string }): string =>
  Match.value(err._tag).pipe(
    Match.when('PushDeliveryFailed', () => 'network'),
    Match.when('PushNotificationServiceError', () => 'network'),
    Match.when('PushNotificationTokenInvalidError', () => 'terminal_token'),
    Match.when('ApnsTokenMissing', () => 'validation'),
    Match.when('FcmTokenMissing', () => 'validation'),
    Match.when('VoipTokenMissing', () => 'validation'),
    Match.when('PushNotificationValidationError', () => 'validation'),
    Match.when('SubscriptionNotFoundError', () => 'validation'),
    Match.when('StatementValidationError', () => 'validation'),
    Match.orElse(() => 'unknown'),
  )

export class StatementProcessorWorkerRuntimeConfig extends Context.Reference<StatementProcessorWorkerRuntimeConfig>()(
  'StatementProcessorWorkerRuntimeConfig',
  {
    defaultValue: () => ({
      perStatementTimeout: Duration.seconds(30),
      subscriptionIdleTimeout: Duration.seconds(6),
      retryBaseDelay: Duration.seconds(1),
      retryMaxDelay: Duration.minutes(1),
      retryMaxAttempts: 5,
      tickTimeout: Duration.hours(1),
    }),
  },
) {}

export const make = Effect.fn(function*() {
  const config = yield* StatementProcessorWorkerRuntimeConfig
  const shell = yield* SubscriptionDaemonShell

  const heartbeatStream = Stream.repeatEffect(
    Effect.sleep(config.subscriptionIdleTimeout).pipe(
      Effect.as({ _tag: 'heartbeat' as const }),
    ),
  )
  const statementStream = shell.subscribeToStatements().pipe(
    Stream.map((statement) => ({ _tag: 'statement' as const, statement })),
    Stream.catchAll((error) => Stream.die(error)),
  )

  return Daemon.stream({
    name: 'statement-processor',
    stream: Stream.merge(statementStream, heartbeatStream).pipe(
      Stream.tap((event) =>
        Match.value(event).pipe(
          Match.tag('statement', (e) => shell.processStatement(e.statement)),
          Match.tag('heartbeat', () => Effect.void),
          Match.exhaustive,
        )
      ),
    ),
    tick: {
      spanName: 'notifications_processor.tick',
      tickTimeout: config.tickTimeout,
      startLogLevel: 'info',
    },
    tickHooks: {
      spanAttributes: Effect.succeed({
        [SpanAttributes.POLL_INTERVAL_MS]: Duration.toMillis(config.subscriptionIdleTimeout),
        [SpanAttributes.TIMEOUT_MS]: Duration.toMillis(config.perStatementTimeout),
      }),
    },
    lock: { mode: 'none' },
  })
})

if (import.meta.vitest) {
  const { describe, expect, it } = await import('vitest')

  const classifiedTags = [
    'PushDeliveryFailed',
    'PushNotificationServiceError',
    'PushNotificationTokenInvalidError',
    'ApnsTokenMissing',
    'FcmTokenMissing',
    'VoipTokenMissing',
    'PushNotificationValidationError',
    'SubscriptionNotFoundError',
    'StatementValidationError',
    'NotARealTaggedError',
  ] as const

  describe('getErrorSubcategory', () => {
    it('Should_MatchInlineSnapshot_When_KnownTags', () => {
      expect(
        Object.fromEntries(classifiedTags.map((tag) => [tag, getErrorSubcategory({ _tag: tag })])),
      ).toMatchInlineSnapshot(`
        {
          "ApnsTokenMissing": "validation",
          "FcmTokenMissing": "validation",
          "NotARealTaggedError": "unknown",
          "PushDeliveryFailed": "network",
          "PushNotificationServiceError": "network",
          "PushNotificationTokenInvalidError": "terminal_token",
          "PushNotificationValidationError": "validation",
          "StatementValidationError": "validation",
          "SubscriptionNotFoundError": "validation",
          "VoipTokenMissing": "validation",
        }
      `)
    })
  })
}
