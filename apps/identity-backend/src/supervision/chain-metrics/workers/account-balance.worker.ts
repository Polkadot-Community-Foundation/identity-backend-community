import { PeopleTypedAPI } from '#root/infrastructure/adapters/blockchain/people-typed-api.service.js'
import { tokenMath } from '#root/utils/mod.js'
import { Daemon } from '@identity-backend/effect-daemon-spec'
import { ss58Address } from '@polkadot-labs/hdkd-helpers'
import { Context, Duration, Effect, Match, Metric, MetricLabel } from 'effect'
import type * as MetricLabelT from 'effect/MetricLabel'

/** Tunables for the account-balance worker only. */
export interface AccountBalanceMetricsRuntimeConfig {
  readonly pollInterval: Duration.Duration
  readonly chainDecimals: number
  readonly includeSs58InMetricLabels?: boolean
}

export class AccountBalanceMetricsConfig extends Context.Reference<AccountBalanceMetricsConfig>()(
  'AccountBalanceMetricsConfig',
  {
    defaultValue: (): AccountBalanceMetricsRuntimeConfig => ({
      pollInterval: Duration.seconds(6),
      chainDecimals: 10,
      includeSs58InMetricLabels: false,
    }),
  },
) {}

const accountFreeBalanceBaseGauge = Metric.gauge('blockchain.account_free_balance', {
  description: 'Free balance of a tracked Substrate account',
})

export interface AccountBalanceWorkSpec {
  /** Child worker name for supervision and metrics identity. */
  readonly name: string
  readonly accountPublicKey: Uint8Array<ArrayBufferLike>
  /** Low-cardinality labels (e.g. role, pool). */
  readonly metricLabels?: ReadonlyArray<MetricLabelT.MetricLabel>
}

export const make = Effect.fn(function*(spec: AccountBalanceWorkSpec) {
  const tunables = yield* AccountBalanceMetricsConfig
  const polkadotTypedAPI = yield* PeopleTypedAPI
  const balanceCfg = yield* AccountBalanceMetricsConfig
  const { metricLabels = [] } = spec

  return Daemon.poll({
    name: spec.name,
    interval: tunables.pollInterval,
    tick: { tickTimeout: Duration.seconds(90) },
    lock: { mode: 'none' },
    work: Effect.gen(function*() {
      const ss58Prefix = yield* Effect.promise(() => polkadotTypedAPI.constants.System.SS58Prefix())
      const accountSs58Address = ss58Address(spec.accountPublicKey, ss58Prefix)
      const freeBalance = yield* Effect.tryPromise(() =>
        polkadotTypedAPI.query.System.Account.getValue(accountSs58Address)
      ).pipe(
        Effect.map((account) => account.data.free),
        Effect.map(tokenMath.formatBigIntToDecimal(balanceCfg.chainDecimals)),
        Effect.orDie,
      )

      const labels = Match.value(balanceCfg.includeSs58InMetricLabels).pipe(
        Match.when(true, () => [...metricLabels, MetricLabel.make('ss58', accountSs58Address)]),
        Match.orElse(() => metricLabels),
      )

      const gauge = Metric.taggedWithLabels(accountFreeBalanceBaseGauge, labels)

      yield* Metric.set(gauge, freeBalance)
    }),
  })
})
