import { PeopleTypedAPI } from '#root/infrastructure/adapters/blockchain/people-typed-api.service.js'
import { Daemon } from '@identity-backend/effect-daemon-spec'
import { ss58Address } from '@polkadot-labs/hdkd-helpers'
import { Context, Duration, Effect, Metric } from 'effect'
import type * as MetricLabelT from 'effect/MetricLabel'

export interface AttestationAllowanceMetricsRuntimeConfig {
  readonly pollInterval: Duration.Duration
}

export class AttestationAllowanceMetricsConfig extends Context.Reference<AttestationAllowanceMetricsConfig>()(
  'AttestationAllowanceMetricsConfig',
  {
    defaultValue: (): AttestationAllowanceMetricsRuntimeConfig => ({
      pollInterval: Duration.seconds(6),
    }),
  },
) {}

const attestationAllowanceBaseGauge = Metric.gauge('blockchain.people.attestation_allowance', {
  description: 'Remaining attestation allowance for a tracked People chain account',
})

export interface AttestationAllowanceWorkSpec {
  readonly name: string
  readonly accountPublicKey: Uint8Array<ArrayBufferLike>
  readonly metricLabels?: ReadonlyArray<MetricLabelT.MetricLabel>
}

export const make = Effect.fn(function*(spec: AttestationAllowanceWorkSpec) {
  const tunables = yield* AttestationAllowanceMetricsConfig
  const polkadotTypedAPI = yield* PeopleTypedAPI
  const { metricLabels = [] } = spec

  return Daemon.poll({
    name: spec.name,
    interval: tunables.pollInterval,
    tick: { tickTimeout: Duration.seconds(90) },
    lock: { mode: 'none' },
    work: Effect.gen(function*() {
      const ss58Prefix = yield* Effect.promise(() => polkadotTypedAPI.constants.System.SS58Prefix())
      const accountSs58Address = ss58Address(spec.accountPublicKey, ss58Prefix)
      const allowance = yield* Effect.tryPromise(() =>
        polkadotTypedAPI.query.PeopleLite.AttestationAllowance.getValue(accountSs58Address)
      ).pipe(
        Effect.map((value) => value ?? 0),
        Effect.orDie,
      )

      const gauge = Metric.taggedWithLabels(attestationAllowanceBaseGauge, metricLabels)

      yield* Metric.set(gauge, allowance)
    }),
  })
})
