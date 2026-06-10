import { OnChainTicketAPI, type OnChainTicketAPIError } from '#root/features/dim/onchain-ticket.adapter.js'
import { BatchRegistrationResult, DIMLiteral } from '@identity-backend/dim-ticket'
import { Context, Duration, Effect, Layer, Schema as S } from 'effect'
import type { PolkadotSigner } from 'polkadot-api'
import { TicketAddress } from './invitation-ticket.schema.js'

export class RegisterDIMTicketsDaemonError extends S.TaggedError<RegisterDIMTicketsDaemonError>()(
  'RegisterDIMTicketsDaemonError',
  {
    category: S.Literal('blockchain', 'network'),
    retryable: S.Boolean,
    cause: S.optional(S.Unknown),
  },
) {
  override get message() {
    return 'DIM ticket batch registration failed'
  }
}

export type DimTicketBlockchainServiceConfigShape = {
  readonly submitTimeout: Duration.Duration
  readonly proxyAs: { readonly real: string } | undefined
}

const dimTicketBlockchainServiceConfigDefault: DimTicketBlockchainServiceConfigShape = {
  submitTimeout: Duration.seconds(120),
  proxyAs: undefined,
}

export class DimTicketBlockchainServiceConfig extends Context.Reference<DimTicketBlockchainServiceConfig>()(
  '@app/DimTicketBlockchainServiceConfig',
  { defaultValue: (): DimTicketBlockchainServiceConfigShape => dimTicketBlockchainServiceConfigDefault },
) {}

export namespace DimTicketBlockchainService {
  export interface Definition {
    readonly registerBatch: (
      tickets: readonly { ticket: string; dim: DIMLiteral }[],
      signer: PolkadotSigner,
    ) => Effect.Effect<BatchRegistrationResult, RegisterDIMTicketsDaemonError | OnChainTicketAPIError>

    readonly checkQuota: (params: {
      inviter: string
      dim: DIMLiteral
    }) => Effect.Effect<number, OnChainTicketAPIError, never>
  }
}

const make = Effect.gen(function*() {
  const onChainAPI = yield* OnChainTicketAPI
  const config = yield* DimTicketBlockchainServiceConfig

  const registerBatch = (Effect.fn('DimTicketBlockchainService.registerBatch')(
    function*(tickets, signer) {
      yield* Effect.annotateLogsScoped({ component: 'DimTicketBlockchainService' })

      yield* Effect.logInfo('DIM ticket batch started', { 'dim.ticket.batch_size': tickets.length })

      const dimTickets = tickets.map((t: { ticket: string; dim: 'Game' | 'ProofOfInk' }) => ({
        ticket: TicketAddress.make(t.ticket),
        dim: t.dim,
      }))
      const batchResult = yield* onChainAPI.setTickets(
        dimTickets,
        signer,
        config.proxyAs !== undefined ? { proxyAs: config.proxyAs } : undefined,
      )

      yield* Effect.annotateCurrentSpan({
        'dim.ticket.success_count': batchResult.completedIndices.length,
        'dim.ticket.failure_count': batchResult.failedIndices.length,
      })

      yield* Effect.logInfo('DIM ticket batch succeeded', {
        'dim.ticket.blockchain_result': 'success',
        'dim.ticket.registered': String(batchResult.completedIndices.length),
        'dim.ticket.failed': String(batchResult.failedIndices.length),
      })

      return batchResult
    },
    (effect) =>
      Effect.catchTag(effect, 'OnChainTicketAPIError', (err) =>
        Effect.fail(
          new RegisterDIMTicketsDaemonError({
            category: 'blockchain',
            retryable: true,
            cause: err,
          }),
        )),
    Effect.scoped,
  )) satisfies DimTicketBlockchainService['Type']['registerBatch']

  const checkQuota = Effect.fn('DimTicketBlockchainService.check_quota')(
    function*({ inviter, dim }) {
      yield* Effect.annotateCurrentSpan({
        'dim.ticket.dim': dim,
      })

      const available = yield* onChainAPI.getAvailableInvites({
        dim,
        inviter,
      })

      yield* Effect.annotateCurrentSpan({
        'dim.ticket.available_invites': available,
      })

      return available
    },
  ) satisfies DimTicketBlockchainService['Type']['checkQuota']

  return DimTicketBlockchainService.of({ registerBatch, checkQuota })
})

export class DimTicketBlockchainService extends Context.Tag('@app/DimTicketBlockchainService')<
  DimTicketBlockchainService,
  DimTicketBlockchainService.Definition
>() {
  static readonly DefaultWithoutDependencies = Layer.scoped(DimTicketBlockchainService, make)
  static readonly Default = Layer.suspend(() => DimTicketBlockchainService.DefaultWithoutDependencies).pipe(
    Layer.provideMerge(OnChainTicketAPI.Default),
  )
}
