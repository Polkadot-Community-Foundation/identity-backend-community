import { DBTest } from '#root/db/drizzle.js'
import { DefectReporter } from '#root/infrastructure/observability/mod.js'
import { dotToPlanck, ZERO_PLANCK } from '#root/schema/balance.js'
import {
  BalanceCheckWorkerDeps,
  makeRegistrationQueueWorker,
  RegistrationQueueConfig,
} from '#root/supervision/registration-queue/mod.js'
import { InstantClaim, PaymentAddressProvider } from '#root/username-registration/registration-queue/claim-ports.js'
import { ClaimUsernameExecutorDeps } from '#root/username-registration/registration-queue/claim.executor.js'
import {
  EnqueueUsernameRegistrationUseCase,
  UsernameRegistrationEnqueueConfig,
  UsernameRegistrationEnqueueRuntimeConfig as EnqueueQueueCapacityConfig,
} from '#root/username-registration/registration-queue/enqueue.use-case.js'
import { QueuePriorityConfig } from '#root/username-registration/registration-queue/priority-group.config.js'
import { RegistrationQueueStatusConfig } from '#root/username-registration/registration-queue/queue-status.config.js'
import { it as effectIt, layer as effectLayer } from '@effect/vitest'
import { DaemonReporter, LeaderLock, run } from '@identity-backend/effect-daemon-spec'
import { makeFeature } from '@identity-backend/effect-vitest-gherkin'
import { Ss58StringFromHex } from '@identity-backend/substrate-schema'
import { Effect, Layer, Random, Schema as S } from 'effect'
import { TestTracingLive } from '../helpers/tracing.js'
import { specQueuePriorityRules } from './fixtures/priority-rules.js'
import { addressFromSeed } from './fixtures/queue-entry-builder.js'
import { ProcessingDaemonHealth } from './fixtures/registration-queue-client.js'

const testQueueConfig = Layer.succeed(RegistrationQueueConfig, {
  network: 'polkadot',
})

const testQueueCapacityConfig = Layer.succeed(EnqueueQueueCapacityConfig, {
  maxQueueSize: 3,
  rules: specQueuePriorityRules,
})

const ss58FromSeed = (seed: number) => S.decodeSync(Ss58StringFromHex)(addressFromSeed(seed))

const accountBalance = (id: string) => {
  if (id === ss58FromSeed(40)) return dotToPlanck(1000n)
  if (id === ss58FromSeed(30)) return dotToPlanck(100n)
  if (id === ss58FromSeed(20)) return dotToPlanck(10n)
  return ZERO_PLANCK
}

const testBalanceReader = Layer.succeed(
  BalanceCheckWorkerDeps,
  BalanceCheckWorkerDeps.of({
    getFreeBalances: (ids: ReadonlyArray<string>) => Effect.succeed(ids.map(accountBalance)),
  }),
)

const launchedProcessingWorkerLayer = Layer.scoped(
  ProcessingDaemonHealth,
  Effect.gen(function*() {
    const worker = yield* makeRegistrationQueueWorker
    return yield* run.worker(worker)
  }),
).pipe(
  Layer.provide(Layer.mergeAll(
    Layer.succeed(QueuePriorityConfig, specQueuePriorityRules),
    testQueueConfig,
  )),
)

const claimExecutorDeps = Layer.effect(
  ClaimUsernameExecutorDeps,
  Effect.gen(function*() {
    const payment = yield* PaymentAddressProvider
    const instant = yield* InstantClaim
    const enqueue = yield* EnqueueUsernameRegistrationUseCase
    return { quote: payment.quote, claimInstant: instant.claim, enqueue }
  }),
).pipe(Layer.provide(Layer.mergeAll(PaymentAddressProvider.Default, InstantClaim.Default)))

const mergedCore = Layer.provideMerge(
  claimExecutorDeps,
  Layer.mergeAll(
    EnqueueUsernameRegistrationUseCase.DefaultWithoutDependencies.pipe(
      Layer.provide(testQueueCapacityConfig),
    ),
    launchedProcessingWorkerLayer,
    testQueueCapacityConfig,
    testBalanceReader,
    Layer.succeed(QueuePriorityConfig, specQueuePriorityRules),
    Layer.succeed(RegistrationQueueStatusConfig, { network: 'polkadot', slotCount: 4 }),
  ),
)

const testLayerCore = Layer.mergeAll(
  Layer.provide(
    mergedCore,
    Layer.succeed(UsernameRegistrationEnqueueConfig, { network: 'polkadot' }),
  ),
  Layer.succeed(UsernameRegistrationEnqueueConfig, { network: 'polkadot' }),
)

export const sharedFileLayer = Layer.mergeAll(DBTest, TestTracingLive)

export const scenarioLayer = Layer.provideMerge(
  testLayerCore,
  Layer.mergeAll(
    LeaderLock.Noop,
    DaemonReporter.Noop,
    DefectReporter.NoOp,
    Layer.effect(Random.Random, Effect.random),
  ),
)

export const feature = makeFeature({ it: effectIt, layer: effectLayer })
