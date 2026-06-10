import type { OnChainTicket } from '#root/features/dim/onchain-ticket.adapter.js'
import { OnChainTicketAPI, OnChainTicketAPIError } from '#root/features/dim/onchain-ticket.adapter.js'
import { BatchRegistrationResult } from '@identity-backend/dim-ticket'
import { Context, Effect, HashMap, HashSet, Layer, Ref } from 'effect'
import type { PolkadotSigner } from 'polkadot-api'

type RegisteredTicket = {
  readonly publicKey: OnChainTicket['ticket']
  readonly dim: OnChainTicket['dim']
}

export namespace FakeOnChainTicketAPI {
  export interface Service extends OnChainTicketAPI.Service {
    readonly setTicketWillFail: (ticketId: string) => Effect.Effect<void>
    readonly setIndexWillFail: (index: number) => Effect.Effect<void>
    readonly getRegisteredTickets: Effect.Effect<HashMap.HashMap<OnChainTicket['ticket'], RegisteredTicket>>
    readonly getSubmissionCount: Effect.Effect<number>
    readonly getSubmittedBatchSizes: Effect.Effect<readonly number[]>
    readonly reset: Effect.Effect<void>
    readonly failNext: (error: OnChainTicketAPIError) => Effect.Effect<void>
  }
}

export class FakeOnChainTicketAPI extends Context.Tag(
  '@app/test/FakeOnChainTicketAPI',
)<FakeOnChainTicketAPI, FakeOnChainTicketAPI.Service>() {}

export const OnChainTicketAPITestLayer = Effect.gen(function*() {
  const registeredRef = yield* Ref.make(HashMap.empty<OnChainTicket['ticket'], RegisteredTicket>())
  const failedTicketIdsRef = yield* Ref.make(HashSet.empty<string>())
  const failedIndicesRef = yield* Ref.make(HashSet.empty<number>())
  const blockNumberRef = yield* Ref.make(1)
  const pendingErrorRef = yield* Ref.make<OnChainTicketAPIError | undefined>(undefined)
  const submissionCountRef = yield* Ref.make(0)
  const submittedBatchSizesRef = yield* Ref.make<readonly number[]>([])

  const setTickets = Effect.fn('fake.setTickets')(
    function*(tickets: readonly OnChainTicket[], _signer: PolkadotSigner) {
      yield* Ref.update(submissionCountRef, (n) => n + 1)
      yield* Ref.update(submittedBatchSizesRef, (sizes) => [...sizes, tickets.length])
      const pendingError = yield* Ref.get(pendingErrorRef)
      if (pendingError) {
        yield* Ref.set(pendingErrorRef, undefined)
        return yield* Effect.fail(pendingError)
      }

      const failedTicketIds = yield* Ref.get(failedTicketIdsRef)
      const failedPositions = yield* Ref.get(failedIndicesRef)
      const completedIndices: number[] = []
      const failedIndices: number[] = []

      for (let i = 0; i < tickets.length; i++) {
        const ticket = tickets[i]!
        if (HashSet.has(failedTicketIds, ticket.ticket) || HashSet.has(failedPositions, i)) {
          failedIndices.push(i)
        } else {
          completedIndices.push(i)
          yield* Ref.update(
            registeredRef,
            HashMap.set(ticket.ticket, { publicKey: ticket.ticket, dim: ticket.dim }),
          )
        }
      }

      const blockNumber = yield* Ref.get(blockNumberRef)
      const newBlockNumber = blockNumber + 1
      yield* Ref.set(blockNumberRef, newBlockNumber)
      const blockHash = '0x' + newBlockNumber.toString(16).padStart(64, '0')

      return new BatchRegistrationResult({
        completedIndices,
        failedIndices,
        blockHash,
        blockNumber,
      })
    },
  )

  const getAvailableInvites = Effect.fn('fake.getAvailableInvites')(
    () => Effect.succeed(5),
  )

  const fakeService = FakeOnChainTicketAPI.of({
    setTickets,
    getAvailableInvites,
    setTicketWillFail: (ticketId: string) => Ref.update(failedTicketIdsRef, (set) => HashSet.add(set, ticketId)),
    setIndexWillFail: (index: number) => Ref.update(failedIndicesRef, (set) => HashSet.add(set, index)),
    getRegisteredTickets: Ref.get(registeredRef),
    getSubmissionCount: Ref.get(submissionCountRef),
    getSubmittedBatchSizes: Ref.get(submittedBatchSizesRef),
    reset: Effect.all([
      Ref.set(registeredRef, HashMap.empty()),
      Ref.set(failedTicketIdsRef, HashSet.empty()),
      Ref.set(failedIndicesRef, HashSet.empty()),
      Ref.set(blockNumberRef, 1),
      Ref.set(submissionCountRef, 0),
      Ref.set(submittedBatchSizesRef, []),
    ]),
    failNext: (error) => Ref.set(pendingErrorRef, error),
  })

  return Layer.merge(
    Layer.succeed(OnChainTicketAPI, fakeService),
    Layer.succeed(FakeOnChainTicketAPI, fakeService),
  )
}).pipe(Layer.unwrapEffect)
