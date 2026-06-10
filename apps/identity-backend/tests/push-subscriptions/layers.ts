import { DBTest } from '#root/db/drizzle.js'
import { SubscriptionCrudShell } from '#root/features/subscriptions/crud.shell.js'
import { PushDeliveryShell } from '#root/features/subscriptions/pipeline/delivery.shell.js'
import { StatementSubscriber } from '#root/features/subscriptions/pipeline/processor.shell.js'
import { PushBroadcastUseCase } from '#root/features/subscriptions/push-broadcast/push-broadcast.use-case.js'
import { SubscriptionRulesShell } from '#root/features/subscriptions/rules.shell.js'
import { APNService } from '#root/infrastructure/adapters/notifications/apn/index.js'
import { FCMPushService } from '#root/infrastructure/adapters/notifications/fcm/service.js'
import { WebPushService } from '#root/infrastructure/adapters/notifications/web/web-push.service.js'
import {
  NotificationsProcessorSupervisor,
  StatementProcessorWorkerRuntimeConfig,
} from '#root/supervision/notifications-processor/mod.js'
import { it as effectIt, layer as effectLayer } from '@effect/vitest'
import { DaemonReporter, LeaderLock, run } from '@identity-backend/effect-daemon-spec'
import { makeFeature } from '@identity-backend/effect-vitest-gherkin'
import { StatementStoreFake } from '@identity-backend/statement-store/fake'
import { Duration, Effect, Layer } from 'effect'
import { vi } from 'vitest'
import { TestTracingLive } from '../helpers/tracing.js'
import { makeApnSendMock, makeFcmSendMock } from './helpers/subscription-test-layer.js'

export const apnSend = makeApnSendMock()
export const fcmSend = makeFcmSendMock()
export const webPushSend = vi.fn<WebPushService.Definition['send']>(() => Effect.void)

const statementProcessorWorkerConfigTest = Layer.succeed(StatementProcessorWorkerRuntimeConfig, {
  perStatementTimeout: Duration.millis(500),
  subscriptionIdleTimeout: Duration.millis(500),
  retryBaseDelay: Duration.millis(5),
  retryMaxDelay: Duration.millis(20),
  retryMaxAttempts: 5,
  tickTimeout: Duration.millis(500),
})

const statementStoreLayer = StatementStoreFake

/**
 * Keep StatementStore + StatementSubscriber in one composed layer so both
 * subscriber and tests resolve the exact same fake store instance.
 */
const statementStoreRuntimeLayer = Layer.provideMerge(
  StatementSubscriber.Default,
  statementStoreLayer,
)

/** Supervisor tree (provides NotificationsProcessorSupervisor). */
const notificationsProcessorLayer = NotificationsProcessorSupervisor.Default.pipe(
  Layer.provide(PushDeliveryShell.Default),
)

/** Fork the supervisor into the test scope. */
const launchedSupervisorLayer = Layer.scopedDiscard(
  Effect.gen(function*() {
    const supervisor = yield* NotificationsProcessorSupervisor
    yield* run.supervisor(supervisor)
  }),
).pipe(
  Layer.provide(notificationsProcessorLayer),
)

const broadcastShellTestLayer = PushBroadcastUseCase.Default

const testLayerCore = Layer.mergeAll(
  notificationsProcessorLayer,
  SubscriptionCrudShell.Default,
  SubscriptionRulesShell.Default,
  broadcastShellTestLayer,
  launchedSupervisorLayer,
)

export const sharedFileLayer = Layer.mergeAll(DBTest, TestTracingLive)

export const scenarioLayer = Layer.provideMerge(
  testLayerCore,
  Layer.mergeAll(
    LeaderLock.Noop,
    DaemonReporter.Noop,
    statementStoreRuntimeLayer,
    Layer.effect(FCMPushService, Effect.succeed({ send: fcmSend } as unknown as FCMPushService)),
    Layer.succeed(APNService, APNService.of({ send: apnSend })),
    Layer.succeed(WebPushService, WebPushService.of({ send: webPushSend })),
    statementProcessorWorkerConfigTest,
  ),
)

export const feature = makeFeature({ it: effectIt, layer: effectLayer })
