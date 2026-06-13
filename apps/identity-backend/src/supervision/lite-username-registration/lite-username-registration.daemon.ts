import { DotnsGatewayAPI } from '#root/infrastructure/adapters/blockchain/dotns-gateway.adapter.js'
import { DefectReporter } from '#root/infrastructure/observability/mod.js'
import { sr25519 } from '@identity-backend/crypto'
import { oneForOne, Supervision } from '@identity-backend/effect-daemon-spec'
import { Array, Context, Duration, Effect, Layer, Option } from 'effect'

import {
  dotnsGatewayReserveOperationsFailureCounter,
  dotnsGatewayReserveOperationsTotalCounter,
} from '#root/metrics/dotns-gateway.js'
import { DotnsReservationWorker, PeopleLiteAttestationWorker } from './workers/mod.js'

export interface LiteUsernameRegistrationSupervisorRuntimeConfig {
  readonly backoffMaxDelay: Duration.Duration
  readonly pollInterval: Duration.Duration
  readonly tickOverhead: Duration.Duration
}

export class LiteUsernameRegistrationSupervisorConfig
  extends Context.Reference<LiteUsernameRegistrationSupervisorConfig>()(
    'LiteUsernameRegistrationSupervisorConfig',
    {
      defaultValue: (): LiteUsernameRegistrationSupervisorRuntimeConfig => ({
        backoffMaxDelay: Duration.seconds(10),
        pollInterval: Duration.seconds(6),
        tickOverhead: Duration.seconds(25),
      }),
    },
  )
{}

const tickTimeoutFrom = (
  cfg: LiteUsernameRegistrationSupervisorRuntimeConfig,
  inclusion: Duration.Duration,
  finalization: Duration.Duration,
): Duration.Duration => Duration.sum(Duration.sum(inclusion, finalization), cfg.tickOverhead)

export class LiteUsernameRegistrationSupervisor extends Effect.Service<LiteUsernameRegistrationSupervisor>()(
  'identity-backend-container/LiteUsernameRegistrationSupervisor',
  {
    effect: Effect.gen(function*() {
      const supervisorCfg = yield* LiteUsernameRegistrationSupervisorConfig
      const defectReporter = yield* DefectReporter
      const peopleChild = yield* PeopleLiteAttestationWorker.make
      const dotnsGatewayOption = yield* Effect.serviceOption(DotnsGatewayAPI)
      const dotnsChild = yield* Option.match(dotnsGatewayOption, {
        onNone: () => Effect.succeed(Option.none()),
        onSome: (svc) =>
          DotnsReservationWorker.make.pipe(
            Effect.provideService(DotnsGatewayAPI, svc),
            Effect.map(Option.some),
          ),
      })
      const children = [peopleChild, ...Array.getSomes([dotnsChild])]

      return oneForOne({
        name: 'lite-username-registration',
        lock: { mode: 'none' },
        children,
        supervision: Supervision.leader(supervisorCfg.backoffMaxDelay),
        reporter: {
          onRestart: (cause) => defectReporter.captureException(cause),
          onExhausted: (cause) => defectReporter.captureException(cause),
        },
      })
    }),
    dependencies: [
      Layer.effect(
        PeopleLiteAttestationWorker.PeopleLiteAttestationWorkerConfig,
        Effect.gen(function*() {
          const {
            REGISTER_USERNAME_BATCH_SIZE,
            TX_INCLUSION_TIMEOUT,
            PEOPLE_CHAIN_FINALIZATION_TIMEOUT,
            PROXY_PRIVATE_KEY,
            PROXY_DELEGATION_ENABLED,
            ATTESTER_PUBLIC_KEY,
            ATTESTER_PROXY_PRIVATE_KEY,
          } = yield* Effect.promise(() => import('#root/config.js'))

          const supervisorCfg = yield* LiteUsernameRegistrationSupervisorConfig
          const proxyDelegationEnabled = yield* PROXY_DELEGATION_ENABLED
          const proxyKeypair = yield* sr25519.fromPrivateKey({ privateKey: yield* PROXY_PRIVATE_KEY })
          const attesterSignerKeypair = proxyDelegationEnabled
            ? yield* sr25519.fromPrivateKey({ privateKey: yield* ATTESTER_PROXY_PRIVATE_KEY })
            : proxyKeypair
          const attesterPublicKey = yield* ATTESTER_PUBLIC_KEY
          const inclusionTimeout = yield* TX_INCLUSION_TIMEOUT
          const finalizationTimeout = yield* PEOPLE_CHAIN_FINALIZATION_TIMEOUT

          return {
            inclusionTimeout,
            finalizationTimeout,
            batchSize: yield* REGISTER_USERNAME_BATCH_SIZE,
            keypair: attesterSignerKeypair,
            proxyDelegationEnabled,
            attesterPublicKey,
            pollInterval: supervisorCfg.pollInterval,
            tickTimeout: tickTimeoutFrom(supervisorCfg, inclusionTimeout, finalizationTimeout),
          }
        }),
      ),
      Layer.effect(
        DotnsReservationWorker.DotnsReservationWorkerConfig,
        Effect.gen(function*() {
          const {
            DOTNS_GATEWAY_ENABLED,
            DOTNS_RESERVE_INCLUSION_TIMEOUT,
            ASSET_HUB_FINALIZATION_TIMEOUT,
            DOTNS_RESERVE_BATCH_SIZE,
            DOTNS_SIGNED_AT_SAFETY_MARGIN_SECONDS,
            PROXY_PRIVATE_KEY,
            PROXY_DELEGATION_ENABLED,
            ATTESTER_PUBLIC_KEY,
            ATTESTER_PROXY_PRIVATE_KEY,
          } = yield* Effect.promise(() => import('#root/config.js'))

          const supervisorCfg = yield* LiteUsernameRegistrationSupervisorConfig
          const dotnsGatewayEnabled = yield* DOTNS_GATEWAY_ENABLED
          const proxyDelegationEnabled = yield* PROXY_DELEGATION_ENABLED
          const proxyKeypair = yield* sr25519.fromPrivateKey({ privateKey: yield* PROXY_PRIVATE_KEY })
          const attesterSignerKeypair = proxyDelegationEnabled
            ? yield* sr25519.fromPrivateKey({ privateKey: yield* ATTESTER_PROXY_PRIVATE_KEY })
            : proxyKeypair
          const attesterPublicKey = yield* ATTESTER_PUBLIC_KEY
          const inclusionTimeout = yield* DOTNS_RESERVE_INCLUSION_TIMEOUT
          const finalizationTimeout = yield* ASSET_HUB_FINALIZATION_TIMEOUT

          return {
            dotnsGatewayEnabled,
            operationsTotalCounter: dotnsGatewayReserveOperationsTotalCounter,
            operationsFailuresCounter: dotnsGatewayReserveOperationsFailureCounter,
            inclusionTimeout,
            finalizationTimeout,
            batchSize: yield* DOTNS_RESERVE_BATCH_SIZE,
            keypair: attesterSignerKeypair,
            proxyDelegationEnabled,
            attesterPublicKey,
            pollInterval: supervisorCfg.pollInterval,
            tickTimeout: tickTimeoutFrom(supervisorCfg, inclusionTimeout, finalizationTimeout),
            signedAtSafetyMarginSeconds: yield* DOTNS_SIGNED_AT_SAFETY_MARGIN_SECONDS,
          }
        }),
      ),
    ],
  },
) {}
