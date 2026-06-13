import { ChainId, ChainSubmitter } from '#root/infrastructure/adapters/blockchain/chain-submitter.adapter.js'
import { PeopleTypedAPI } from '#root/infrastructure/adapters/blockchain/people-typed-api.service.js'
import { BatchRegistrationResult } from '@identity-backend/dim-ticket'
import { Array, Context, Duration, Effect, flow, Layer, Match, Schema as S } from 'effect'
import { Enum, type PolkadotSigner } from 'polkadot-api'
import { TicketAddress } from './invitation-ticket.schema.js'
import { parseForceBatchResults } from './onchain-ticket-events.js'

export class OnChainTicketAPIError extends S.TaggedError<OnChainTicketAPIError>()('OnChainTicketAPIError', {
  cause: S.Unknown,
}) {}

export interface OnChainTicket {
  readonly ticket: TicketAddress
  readonly dim: 'Game' | 'ProofOfInk'
}

// Backward compat alias
export type { OnChainTicket as DIMTicket }

export namespace OnChainTicketAPI {
  export type SetTicketsOptions = {
    readonly proxyAs?: { readonly real: string }
  }

  export interface Service {
    readonly setTickets: (
      params: readonly OnChainTicket[],
      signer: PolkadotSigner,
      options?: SetTicketsOptions,
    ) => Effect.Effect<BatchRegistrationResult, OnChainTicketAPIError, never>

    readonly getAvailableInvites: (params: {
      readonly dim: 'Game' | 'ProofOfInk'
      readonly inviter: string
    }) => Effect.Effect<number, OnChainTicketAPIError, never>
  }
}

const make = Effect.gen(function*() {
  const nextAPI = yield* PeopleTypedAPI
  const chainSubmitter = yield* ChainSubmitter

  const setTickets = (Effect.fn('blockchain.set_invite_ticket')(
    function*(tickets, signer, options) {
      yield* Effect.annotateCurrentSpan({
        'blockchain.batch.size': tickets.length,
        'invitation_ticket.dim': tickets[0]?.dim,
        'blockchain.proxy.enabled': options?.proxyAs !== undefined,
      })

      const calls = Array.map(tickets, (onChainTicket) =>
        Match.value(onChainTicket.dim).pipe(
          Match.when('Game', () => nextAPI.tx.Game.set_invite_ticket({ ticket: onChainTicket.ticket }).decodedCall),
          Match.when('ProofOfInk', () =>
            nextAPI.tx.ProofOfInk.set_invite_ticket({ ticket: onChainTicket.ticket }).decodedCall),
          Match.exhaustive,
        ))

      const baseTx = nextAPI.tx.Utility.force_batch({ calls })
      const tx = options?.proxyAs !== undefined
        ? nextAPI.tx.Proxy.proxy({
          real: Enum('Id', options.proxyAs.real),
          force_proxy_type: Enum('Any'),
          call: baseTx.decodedCall,
        })
        : baseTx

      const finalized = yield* chainSubmitter.submit(signer, tx, {
        chain: ChainId.make('people'),
        timeout: Duration.seconds(120),
        finalizationTimeout: Duration.seconds(70),
      }).pipe(
        Effect.mapError((cause) => new OnChainTicketAPIError({ cause })),
      )

      return yield* Match.value(finalized).pipe(
        Match.tag(
          'TransactionReverted',
          (reverted) => Effect.fail(new OnChainTicketAPIError({ cause: reverted.dispatchError })),
        ),
        Match.tag('TransactionIncluded', (included) =>
          Effect.gen(function*() {
            const { completedIndices, failedIndices } = parseForceBatchResults(included.events, tickets.length)
            yield* Effect.annotateCurrentSpan({
              'dim.ticket.completed': completedIndices.length,
              'dim.ticket.failed': failedIndices.length,
              'blockchain.tx.hash': included.txHash,
              'blockchain.tx.block_hash': included.block.hash,
              'blockchain.tx.block_number': included.block.number,
            })
            return new BatchRegistrationResult({
              completedIndices,
              failedIndices,
              blockHash: included.block.hash,
              blockNumber: included.block.number,
            })
          })),
        Match.exhaustive,
      )
    },
  )) satisfies OnChainTicketAPI.Service['setTickets']

  const getAvailableInvites = (Effect.fn('onchain_ticket_api.get_available_invites')(
    function*({ dim, inviter }) {
      yield* Effect.annotateCurrentSpan({ dim, inviter })

      const query = Match.value(dim).pipe(
        Match.when('Game', () => nextAPI.query.Game.AvailableInvites),
        Match.when('ProofOfInk', () => nextAPI.query.ProofOfInk.AvailableInvites),
        Match.exhaustive,
      )

      const available = yield* Effect.tryPromise({
        try: () => query.getValue(inviter),
        catch: (cause) => new OnChainTicketAPIError({ cause }),
      })

      return available
    },
    flow(
      Effect.mapError((cause) => new OnChainTicketAPIError({ cause })),
    ),
  )) satisfies OnChainTicketAPI.Service['getAvailableInvites']

  return OnChainTicketAPI.of({
    setTickets,
    getAvailableInvites,
  })
})

export class OnChainTicketAPI extends Context.Tag('@app/OnChainTicketAPI')<
  OnChainTicketAPI,
  OnChainTicketAPI.Service
>() {
  static readonly DefaultWithoutDependencies = Layer.effect(OnChainTicketAPI, make)
  static readonly Default = Layer.suspend(() => OnChainTicketAPI.DefaultWithoutDependencies)
}
