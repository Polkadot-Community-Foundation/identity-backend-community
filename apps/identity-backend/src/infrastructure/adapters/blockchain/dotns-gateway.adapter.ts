import { DOTNS_INTAKE_FRESHNESS_MAX_AGE_SECONDS, DOTNS_SIGNED_AT_SAFETY_MARGIN_SECONDS } from '#root/config.js'
import { AssetHubTypedAPI } from '#root/infrastructure/adapters/blockchain/asset-hub-typed-api.service.js'
import { Effect } from 'effect'
import { Binary, Enum, type Transaction, type TxCallData } from 'polkadot-api'

export type AhItemFailedEvFilter = Effect.Effect.Success<
  typeof AssetHubTypedAPI
>['event']['Utility']['ItemFailed']['filter']

// Minimum seconds the daemon needs between intake and the submit deadline to
// have a realistic shot at landing the extrinsic (one daemon tick + first AH
// block + safety). Tuned against AH 6s block time.
const MIN_DAEMON_BUDGET_SECONDS = 30

export namespace DotnsGatewayAPI {
  export type ReserveNameParams = {
    candidate: string
    candidateSignature: Uint8Array
    liteLabel: string
    chatKey: Uint8Array
    reservedBaseLabel: string | undefined
    signedAt: bigint
  }

  export type ProxyParams = {
    real: string
    forceProxyType?: 'Any' | 'NonTransfer' | 'CancelProxy' | 'Assets' | 'AssetOwner' | 'AssetManager' | 'Collator'
    call: TxCallData
  }

  export type ChainConstants = {
    readonly maxValiditySeconds: number
    readonly maxFutureSkewSeconds: number
  }

  export interface DotnsGatewayAPI {
    /** On-chain runtime constants for the DotnsGateway pallet, cached at layer init. */
    readonly chainConstants: ChainConstants
    /** Intake-side max age (seconds) — sourced from DOTNS_INTAKE_FRESHNESS_MAX_AGE_SECONDS. */
    readonly intakeFreshnessMaxAgeSeconds: number
    reserveNames: (
      params: readonly ReserveNameParams[],
      // oxlint-disable-next-line typescript/no-explicit-any
    ) => Effect.Effect<Transaction<any, any>, never, never>
    proxy: (
      params: ProxyParams,
      // oxlint-disable-next-line typescript/no-explicit-any
    ) => Effect.Effect<Transaction<any, any>, never, never>
    /** Filter for Utility.ItemFailed events as decoded by the AH typed API. */
    readonly filterUtilityItemFailed: AhItemFailedEvFilter
  }
}

export class DotnsGatewayAPI extends Effect.Service<DotnsGatewayAPI>()('@app/DotnsGatewayAPI', {
  effect: Effect.gen(function*() {
    const ahApi = yield* AssetHubTypedAPI

    const [maxValiditySeconds, maxFutureSkewSeconds] = yield* Effect.all([
      Effect.promise(() => ahApi.constants.DotnsGateway.MaxValiditySeconds()).pipe(Effect.map(Number)),
      Effect.promise(() => ahApi.constants.DotnsGateway.MaxFutureSkewSeconds()).pipe(Effect.map(Number)),
    ])

    const intakeFreshnessMaxAgeSeconds = yield* DOTNS_INTAKE_FRESHNESS_MAX_AGE_SECONDS
    const submitSafetyMarginSeconds = yield* DOTNS_SIGNED_AT_SAFETY_MARGIN_SECONDS

    // Invariant: the daemon must have a real budget between intake and its own
    // submit deadline. If intake accepts signatures older than the daemon's
    // deadline, accepted rows get marked FAILED with SIGNATURE_EXPIRED before
    // they ever reach the chain — silent failure from the client's POV.
    const daemonBudgetSeconds = maxValiditySeconds - submitSafetyMarginSeconds - intakeFreshnessMaxAgeSeconds
    if (daemonBudgetSeconds < MIN_DAEMON_BUDGET_SECONDS) {
      return yield* Effect.dieMessage(
        `dotNS signature window misconfigured: ` +
          `MaxValiditySeconds=${maxValiditySeconds}, ` +
          `DOTNS_SIGNED_AT_SAFETY_MARGIN_SECONDS=${submitSafetyMarginSeconds}, ` +
          `DOTNS_INTAKE_FRESHNESS_MAX_AGE_SECONDS=${intakeFreshnessMaxAgeSeconds}. ` +
          `Daemon budget (validity - submit margin - intake max age) = ${daemonBudgetSeconds}s, ` +
          `must be at least ${MIN_DAEMON_BUDGET_SECONDS}s. ` +
          `Lower DOTNS_INTAKE_FRESHNESS_MAX_AGE_SECONDS or DOTNS_SIGNED_AT_SAFETY_MARGIN_SECONDS, ` +
          `or raise MaxValiditySeconds on the AH runtime.`,
      )
    }

    const chainConstants: DotnsGatewayAPI.ChainConstants = {
      maxValiditySeconds,
      maxFutureSkewSeconds,
    }

    const reserveNames = ((params) =>
      Effect.sync(() => {
        const calls = params.map((p) =>
          ahApi.tx.DotnsGateway.reserve_name({
            candidate: p.candidate,
            candidate_signature: {
              type: 'Sr25519',
              value: Binary.toHex(p.candidateSignature),
            },
            lite_label: Binary.fromText(p.liteLabel),
            chat_key: Binary.toHex(p.chatKey),
            reserved_base_label: p.reservedBaseLabel
              ? Binary.fromText(p.reservedBaseLabel)
              : undefined,
            signed_at: p.signedAt,
          }).decodedCall
        )
        return ahApi.tx.Utility.force_batch({ calls })
      }).pipe(
        Effect.withLogSpan('dotns_gateway/reserve_names'),
        Effect.withSpan('dotns_gateway/reserve_names'),
      )) satisfies DotnsGatewayAPI.DotnsGatewayAPI['reserveNames']

    const proxy = (params: DotnsGatewayAPI.ProxyParams) =>
      Effect.succeed(
        ahApi.tx.Proxy.proxy({
          real: Enum('Id', params.real),
          force_proxy_type: params.forceProxyType !== undefined
            ? Enum(params.forceProxyType)
            : undefined,
          call: params.call,
        }),
      ).pipe(
        Effect.withLogSpan('dotns_gateway/proxy'),
        Effect.withSpan('dotns_gateway/proxy'),
      )

    return {
      chainConstants,
      intakeFreshnessMaxAgeSeconds,
      reserveNames,
      proxy,
      filterUtilityItemFailed: ahApi.event.Utility.ItemFailed.filter,
    } satisfies DotnsGatewayAPI.DotnsGatewayAPI as DotnsGatewayAPI.DotnsGatewayAPI
  }),
  dependencies: [
    AssetHubTypedAPI.Default,
  ],
}) {}
