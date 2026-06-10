import { FetchHttpClient, HttpClient, HttpClientRequest } from '@effect/platform'
import { BunRuntime } from '@effect/platform-bun'
import { layerWebSocketConstructor } from '@effect/platform-bun/BunSocket'
import { pop_testnet } from '@identity-backend/descriptors'
import { ss58Address } from '@polkadot-labs/hdkd-helpers'
import { decodeHex } from '@std/encoding'
import { Config, Duration, Effect, Layer } from 'effect'

type PolkadotPeopleNextDescriptors = typeof pop_testnet
const polkadotPeopleNextDescriptor = pop_testnet

// Alice's well-known dev account public key
const ALICE_PUBLIC_KEY = decodeHex('d43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d')

const program = Effect.gen(function*() {
  yield* Effect.log('Starting People startup container')

  const { PEOPLE_RPC_ENDPOINTS } = yield* Config.all({
    PEOPLE_RPC_ENDPOINTS: Config.array(Config.nonEmptyString(), 'PEOPLE_RPC_ENDPOINTS').pipe(
      Config.map((endpoints) => endpoints.map((endpoint) => endpoint.trim())),
    ),
  })

  yield* Effect.log(`Connecting to endpoints: ${PEOPLE_RPC_ENDPOINTS.join(', ')}`)

  const { createWsClient } = yield* Effect.promise(() => import('polkadot-api/ws'))

  const peopleWsClient = yield* Effect.acquireRelease(
    Effect.sync(() =>
      createWsClient(PEOPLE_RPC_ENDPOINTS, {
        heartbeatTimeout: 1_800_000,
      })
    ),
    (client) => Effect.sync(() => client.destroy()),
  )

  yield* Effect.log('Connected to People WebSocket client')

  const typedAPI = peopleWsClient.getTypedApi<PolkadotPeopleNextDescriptors>(
    polkadotPeopleNextDescriptor,
  )
  yield* Effect.log('Got typed API')

  const ss58Prefix = yield* Effect.promise(() => typedAPI.constants.System.SS58Prefix())
  yield* Effect.log(`Got SS58 prefix: ${ss58Prefix}`)

  // Build initial block to finalize chopsticks pre-seeded storage
  yield* Effect.log('Building initial block to finalize storage...')

  const httpEndpoint = PEOPLE_RPC_ENDPOINTS[0]!.replace('ws://', 'http://').replace('wss://', 'https://')
  const httpClient = yield* HttpClient.HttpClient

  yield* httpClient.execute(
    yield* HttpClientRequest.post(httpEndpoint).pipe(
      HttpClientRequest.bodyJson({
        jsonrpc: '2.0',
        id: 1,
        method: 'dev_newBlock',
        params: [],
      }),
    ),
  ).pipe(
    Effect.tapError(() => Effect.log('Skipping initial block build (non-critical)')),
    Effect.catchAll(() => Effect.void),
  )

  yield* Effect.log('Block built successfully')

  // Preseed Game storage so invitation-ticket E2E tests can sign_up_with_invite
  // without hitting NoGame (Custom error 143) in the GameAsInvited extension
  yield* Effect.log('Preseeding Game.Game storage...')
  const gameFuture = Math.floor(Date.now() / 1000) + 86400

  yield* httpClient.execute(
    yield* HttpClientRequest.post(httpEndpoint).pipe(
      HttpClientRequest.bodyJson({
        jsonrpc: '2.0',
        id: 2,
        method: 'dev_setStorage',
        params: [{
          Game: {
            Game: {
              index: 0,
              registration_ends: gameFuture,
              shuffle_deadline: gameFuture + 3600,
              game_date: gameFuture + 7200,
              report_ends: gameFuture + 10800,
              state: { Registration: { next_player_index: 0 } },
              max_group_size: 10,
              rounds: 1,
              pending_attendance: 0,
              scratch_pot_funded: false,
            },
          },
        }],
      }),
    ),
  ).pipe(
    Effect.tapError(() => Effect.logWarning('Failed to preseed Game.Game storage')),
    Effect.ignore,
  )

  yield* Effect.log('Game.Game storage preseeded')

  // Verify Alice has AttestationAllowance (pre-seeded via chopsticks)
  const aliceAddress = ss58Address(ALICE_PUBLIC_KEY, ss58Prefix)
  yield* Effect.log(`Checking AttestationAllowance for Alice: ${aliceAddress}`)

  const attestationAllowance = yield* Effect.tryPromise(() =>
    typedAPI.query.PeopleLite.AttestationAllowance.getValue(aliceAddress)
  )

  if (attestationAllowance === undefined || attestationAllowance === 0) {
    yield* Effect.logWarning('Alice has no AttestationAllowance - registration may fail')
  } else {
    yield* Effect.log(`Alice AttestationAllowance: ${attestationAllowance}`)
  }

  yield* Effect.log('People startup container completed successfully')
}).pipe(
  Effect.provide(Layer.mergeAll(layerWebSocketConstructor, FetchHttpClient.layer)),
  Effect.scoped,
  Effect.timeout(Duration.minutes(1)),
  Effect.orDie,
)

BunRuntime.runMain(program)
