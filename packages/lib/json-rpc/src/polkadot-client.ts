import { WebSocketConstructor } from '@effect/platform/Socket'
import { Effect } from 'effect'
import type { PolkadotClient } from 'polkadot-api'
import type { WsJsonRpcProvider } from 'polkadot-api/ws'

export type PolkadotClientWithProvider = PolkadotClient & {
  readonly network: string
  readonly chain: string
  readonly reconnect: () => void
  readonly provider: WsJsonRpcProvider
}

export type Params = Readonly<{
  endpoints: string[]
  heartbeatTimeout?: number
  readonly network: string
  readonly chain: string
}>

export const make = Effect.fnUntraced(function*(params: Params) {
  const { getWsProvider } = yield* Effect.promise(() => import('polkadot-api/ws'))
  const { createClient } = yield* Effect.promise(() => import('polkadot-api'))
  const wsCtor = yield* WebSocketConstructor
  class WsCtor {
    constructor(...args: Parameters<typeof wsCtor>) {
      return wsCtor(...args)
    }
  }

  const provider = yield* Effect.sync(() =>
    getWsProvider(params.endpoints, {
      // oxlint-disable-next-line typescript/consistent-type-assertions
      websocketClass: WsCtor as typeof globalThis.WebSocket,
      ...(params.heartbeatTimeout !== undefined && { heartbeatTimeout: params.heartbeatTimeout }),
    })
  )

  const reconnect = () => provider.switch()

  const client = yield* Effect.acquireRelease(
    Effect.sync(() => createClient(provider)),
    (client) => Effect.sync(() => client.destroy()),
  )

  const result: PolkadotClientWithProvider = {
    ...client,
    reconnect,
    provider,
    network: params.network,
    chain: params.chain,
  }
  return result
})
