import { PeopleTypedAPI } from '#root/infrastructure/adapters/blockchain/people-typed-api.service.js'
import { logTxEvent, watchThroughReorgs } from '#root/infrastructure/tx-event.io.js'
import { BatchRegistrationResult } from '@identity-backend/dim-ticket'
import { fromObservable } from '@identity-backend/rx-effect'
import { Array, Context, Duration, Effect, flow, Layer, Match, Option, pipe, Schema as S, Sink, Stream } from 'effect'
import { Enum, type PolkadotSigner, type TxFinalized } from 'polkadot-api'
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

      const [_extrinsicDuration, txEvents] = yield* Effect.sync(() => tx.signSubmitAndWatch(signer)).pipe(
        Effect.map(fromObservable((cause) => new OnChainTicketAPIError({ cause }))),
        Effect.timed,
      )

      const [_finalizationDuration, result] = yield* pipe(
        txEvents,
        Stream.tap(logTxEvent),
        watchThroughReorgs,
        Stream.filter((e): e is TxFinalized => e.type === 'finalized'),
        Stream.tap((finalized) => Effect.annotateCurrentSpan('blockchain.tx.hash', finalized.txHash)),
        Stream.run(Sink.head()),
        Effect.flatMap((option) =>
          Option.match(option, {
            onNone: () =>
              Effect.fail(
                new OnChainTicketAPIError({
                  cause: new Error('No finalized event received'),
                }),
              ),
            onSome: (finalized) =>
              finalized.ok
                ? Effect.gen(function*() {
                  const { completedIndices, failedIndices } = parseForceBatchResults(
                    finalized.events,
                    tickets.length,
                  )
                  const blockHash = finalized.block.hash
                  const blockNumber = finalized.block.number
                  yield* Effect.annotateCurrentSpan({
                    'dim.ticket.completed': completedIndices.length,
                    'dim.ticket.failed': failedIndices.length,
                    'blockchain.tx.block_hash': blockHash,
                    'blockchain.tx.block_number': blockNumber,
                  })
                  return new BatchRegistrationResult({ completedIndices, failedIndices, blockHash, blockNumber })
                })
                : Effect.fail(
                  new OnChainTicketAPIError({
                    cause: finalized.dispatchError,
                  }),
                ),
          })
        ),
        Effect.timeout(Duration.seconds(120)),
        Effect.catchAll((cause) =>
          Effect.fail(
            new OnChainTicketAPIError({
              cause: cause instanceof Error ? cause : new Error('Transaction finalization failed', { cause }),
            }),
          )
        ),
        Effect.withSpan('blockchain.wait_finalization'),
        Effect.timed,
      )

      return result
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
