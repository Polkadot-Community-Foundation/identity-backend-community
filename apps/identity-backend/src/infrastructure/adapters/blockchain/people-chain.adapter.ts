import { PeopleTypedAPI } from '#root/infrastructure/adapters/blockchain/people-typed-api.service.js'
import { UtilityAPI } from '#root/infrastructure/adapters/blockchain/utility-chain.adapter.js'
import { Array, Effect, pipe } from 'effect'
import { Binary, Enum, type Transaction, type TxCallData } from 'polkadot-api'

export namespace PeopleAPI {
  export type ProxyParams = {
    real: string
    force_proxy_type?: 'Any' | 'NonTransfer' | 'CancelProxy' | 'Identity' | 'IdentityJudgement' | 'Collator'
    call: TxCallData
  }

  export type AttestParams = readonly {
    candidate: string
    candidateSignature: Uint8Array
    ringVrfKey: Uint8Array
    proofOfOwnership: Uint8Array
    consumerRegistration: {
      signature: Uint8Array
      account: string
      identifierKey: Uint8Array
      username: string
      reservedUsername: string | undefined
    }
  }[]

  export interface PeopleAPI {
    proxy: (
      params: ProxyParams,
      // oxlint-disable-next-line typescript/no-explicit-any
    ) => Effect.Effect<Transaction<any, any>, never, never>
    attests: (
      params: AttestParams,
      // oxlint-disable-next-line typescript/no-explicit-any
    ) => Effect.Effect<Transaction<any, any>, never, never>
  }
}

export class PeopleAPI extends Effect.Service<PeopleAPI>()('@app/PeopleAPI', {
  effect: Effect.gen(function*() {
    const nextAPI = yield* PeopleTypedAPI
    const utilityAPI = yield* UtilityAPI

    const attest = (params: {
      candidate: string
      candidateSignature: Uint8Array
      ringVrfKey: Uint8Array
      proofOfOwnership: Uint8Array
      consumerRegistration: {
        signature: Uint8Array
        account: string
        identifierKey: Uint8Array
        username: string
        reservedUsername: string | undefined
      }
    }) =>
      Effect.succeed(
        nextAPI.tx.PeopleLite.attest({
          candidate: params.candidate,
          candidate_signature: {
            type: 'Sr25519',
            value: Binary.toHex(params.candidateSignature),
          },
          ring_vrf_key: Binary.toHex(params.ringVrfKey),
          proof_of_ownership: Binary.toHex(params.proofOfOwnership),
          consumer_registration: {
            signature: {
              type: 'Sr25519',
              value: Binary.toHex(params.consumerRegistration.signature),
            },
            account: params.consumerRegistration.account,
            identifier_key: Binary.toHex(params.consumerRegistration.identifierKey),
            username: Binary.fromText(params.consumerRegistration.username),
            reserved_username: params.consumerRegistration.reservedUsername !== undefined
              ? Binary.fromText(params.consumerRegistration.reservedUsername)
              : undefined,
          },
        }),
      ).pipe(
        Effect.withLogSpan('people_api/attest'),
        Effect.withSpan('people_api/attest'),
      )

    const attests = ((params) =>
      Effect.gen(function*() {
        const calls = yield* pipe(
          Array.map(params, attest),
          Effect.allWith({ concurrency: 'unbounded' }),
          Effect.andThen(Array.map((tx) => tx.decodedCall)),
        )

        return yield* utilityAPI.forceBatch({ calls })
      }).pipe(
        Effect.withLogSpan('people_api/attests'),
        Effect.withSpan('people_api/attests'),
      )) satisfies PeopleAPI.PeopleAPI['attests']

    const proxy = (params: PeopleAPI.ProxyParams) =>
      Effect.succeed(
        nextAPI.tx.Proxy.proxy({
          real: Enum('Id', params.real),
          force_proxy_type: params.force_proxy_type !== undefined
            ? Enum(params.force_proxy_type)
            : undefined,
          call: params.call,
        }),
      ).pipe(
        Effect.withLogSpan('people_api/proxy'),
        Effect.withSpan('people_api/proxy'),
      )

    return {
      proxy,
      attests,
    } satisfies PeopleAPI.PeopleAPI as PeopleAPI.PeopleAPI
  }),
}) {}
