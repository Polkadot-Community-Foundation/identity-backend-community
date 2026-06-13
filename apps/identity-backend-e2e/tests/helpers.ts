import { pop_testnet } from '@identity-backend/descriptors'
import {
  createLitePersonSigner,
  deriveLitePersonParams,
  formatParams,
  generateMnemonic,
  type LitePersonParams,
  type SetupResult,
  setupWallets,
} from '@identity-backend/people-lite-fixtures'
import { getDynamicBuilder, getLookupFn } from '@polkadot-api/metadata-builders'
import { type SystemEvent } from '@polkadot-api/observable-client'
import { getPolkadotSigner, type PolkadotSigner } from '@polkadot-api/signer'
import { decAnyMetadata, type HexString, unifyMetadata } from '@polkadot-api/substrate-bindings'
import { sr25519CreateDerive } from '@polkadot-labs/hdkd'
import { type KeyPair, mnemonicToMiniSecret } from '@polkadot-labs/hdkd-helpers'
import { Effect } from 'effect'
import { customAlphabet } from 'nanoid'
import { lowercase } from 'nanoid-dictionary'
import { Binary, createClient, type PolkadotClient, type TypedApi } from 'polkadot-api'
import { getWsProvider } from 'polkadot-api/ws'
import { combineLatest, firstValueFrom, timeout } from 'rxjs'
import { filter, map } from 'rxjs/operators'

export { createLitePersonSigner, deriveLitePersonParams, formatParams, generateMnemonic, setupWallets }
export type { LitePersonParams, SetupResult }

export function createPeopleSigner(
  keyPair: KeyPair,
): PolkadotSigner {
  const baseSigner = getPolkadotSigner(keyPair.publicKey, 'Sr25519', keyPair.sign)

  return {
    publicKey: baseSigner.publicKey,
    signBytes: baseSigner.signBytes,
    signTx: async (callData, signedExtensions, metadata, atBlockNumber, hasher) => {
      const extensionsWithCustom = {
        ...signedExtensions,
        VerifyMultiSignature: {
          identifier: 'VerifyMultiSignature',
          value: new Uint8Array([0]),
          additionalSigned: new Uint8Array([]),
        },
      }

      return baseSigner.signTx(callData, extensionsWithCustom, metadata, atBlockNumber, hasher)
    },
  }
}

export interface WaitForRegistrationResult {
  onchainUsername: string
  onchainAccount: string
}

export async function waitForRegistration(
  api: TypedApi<typeof pop_testnet>,
  candidateAccountId: string,
  fullUsername: string,
  timeoutMs: number = 60000,
): Promise<WaitForRegistrationResult> {
  const usernameBinary = Binary.fromText(fullUsername)

  const [, usernameOwner] = await firstValueFrom(
    combineLatest([
      api.query.PeopleLite.LitePeople.watchValue(candidateAccountId).pipe(
        map(({ value }) => value),
      ),
      api.query.Resources.UsernameOwnerOf.watchValue(usernameBinary).pipe(
        map(({ value }) => value),
      ),
    ]).pipe(
      filter(([litePeople, owner]) => litePeople != null && owner != null),
      timeout(timeoutMs),
    ),
  )

  return {
    onchainUsername: fullUsername,
    onchainAccount: usernameOwner ?? '',
  }
}

const CHAIN_QUERY_HEARTBEAT_MS = 60_000

export type PopTestnetApi = TypedApi<typeof pop_testnet>

/**
 * Execute a callback with a Polkadot API client. Ensures client destruction after use.
 */
export async function withPolkadotClient<T>(
  wsEndpoint: string,
  fn: (api: PopTestnetApi) => Promise<T>,
): Promise<T> {
  const client = createClient(
    getWsProvider(wsEndpoint, { heartbeatTimeout: CHAIN_QUERY_HEARTBEAT_MS }),
  )
  const api = client.getTypedApi(pop_testnet)
  try {
    return await fn(api)
  } finally {
    client.destroy()
  }
}

export async function getEventsAtBlock(
  wsEndpoint: string,
  blockHash: string,
): Promise<SystemEvent[]> {
  const client = createClient(getWsProvider(wsEndpoint))
  try {
    const rawMetadata = await client._request<HexString>(
      'state_call',
      ['Metadata_metadata', '0x', blockHash],
    )
    const metadata = unifyMetadata(decAnyMetadata(rawMetadata))
    const lookup = getLookupFn(metadata)
    const dynamicBuilder = getDynamicBuilder(lookup)
    const eventsStorage = dynamicBuilder.buildStorage('System', 'Events')
    const storageKey = eventsStorage.keys.enc()

    const eventsHex = await client._request<HexString | null>(
      'state_getStorageAt',
      [storageKey, blockHash],
    )
    if (!eventsHex) return []

    const eventsDec = eventsStorage.value.dec as (input: HexString) => Array<SystemEvent>
    return eventsDec(eventsHex)
  } finally {
    client.destroy()
  }
}

let pendingTransfer: Promise<void> = Promise.resolve()

let sharedClient: { client: PolkadotClient; api: PopTestnetApi } | null = null

export function getTransferClient(wsEndpoint: string): { client: PolkadotClient; api: PopTestnetApi } {
  if (!sharedClient) {
    const client = createClient(getWsProvider(wsEndpoint, { heartbeatTimeout: 1_800_000 }))
    const api = client.getTypedApi(pop_testnet)
    sharedClient = { client, api }
  }
  return sharedClient
}

export function destroySharedClient(): void {
  if (sharedClient) {
    try {
      sharedClient.client.destroy()
    } catch {}
    sharedClient = null
  }
}

function detectStaleError(err: unknown): boolean {
  if (err instanceof Error) {
    if (err.name === 'InvalidTxError') return true
    if (err.message.includes('Stale')) return true
  }
  if (typeof err === 'object' && err !== null) {
    const e = err as Record<string, unknown>
    if (e.error && typeof e.error === 'object') {
      const error = e.error as Record<string, unknown>
      if (
        error.type === 'Invalid' &&
        typeof error.value === 'object' &&
        (error.value as Record<string, unknown>).type === 'Stale'
      ) {
        return true
      }
    }
  }
  return false
}

async function submitWithStaleRetry<T>(
  submit: () => Promise<T>,
  opts: { maxRetries?: number; baseDelayMs?: number } = {},
): Promise<T> {
  const { maxRetries = 10, baseDelayMs = 1000 } = opts
  let lastErr: unknown

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await submit()
    } catch (err) {
      lastErr = err
      if (!detectStaleError(err) || i === maxRetries - 1) throw err
      destroySharedClient()
      const delay = baseDelayMs * (i + 1)
      console.log(`[StaleRetry] attempt ${i + 1}/${maxRetries} failed, waiting ${delay}ms before retry`)
      await Effect.runPromise(Effect.sleep(`${delay} millis`))
    }
  }
  throw lastErr
}

/**
 * Transfer funds to multiple addresses in a single batched transaction.
 * This is much faster than individual transfers since it only waits for
 * finalization once instead of once per transfer.
 */
export async function transferFundsBatch(
  wsEndpoint: string,
  fromMnemonic: string,
  transfers: Array<{ toAddress: string; amount?: bigint }>,
): Promise<string> {
  if (transfers.length === 0) return ''

  const defaultAmount = 1_000_000_000_000_000_000n
  let txHash: string = ''

  // A fresh client per call races with chopsticks subscription warmup: the
  // cold chainHead_follow stream can return a pre-finalization nonce, and
  // the tx gets rejected as Invalid::Stale. Reusing one client per endpoint
  // keeps the subscription warm after the first signAndSubmit. On transient
  // subscription death (ChainHeadDisjoint after a chopsticks rewind, WS
  // drop), recycle the cached client and retry once.
  const myTransfer = pendingTransfer.then(async () => {
    const miniSecret = mnemonicToMiniSecret(fromMnemonic, '')
    const derive = sr25519CreateDerive(miniSecret)
    const aliceWallet = derive('//Alice')
    const aliceSigner = createPeopleSigner(aliceWallet)

    const submit = async (): Promise<string> => {
      const { api } = getTransferClient(wsEndpoint)
      const calls = transfers.map(({ toAddress, amount }) =>
        api.tx.Balances.transfer_allow_death({
          dest: { type: 'Id', value: toAddress },
          value: amount ?? defaultAmount,
        }).decodedCall
      )
      const batchCall = api.tx.Utility.batch_all({ calls })
      const result = await batchCall.signAndSubmit(aliceSigner)
      return result.txHash
    }

    txHash = await submitWithStaleRetry(() => submit(), { maxRetries: 5, baseDelayMs: 800 })
  })

  pendingTransfer = myTransfer.catch(() => {})

  await myTransfer
  return txHash
}

/**
 * Transfer funds to a single address. For multiple transfers, prefer transferFundsBatch.
 */
export async function transferFunds(
  wsEndpoint: string,
  fromMnemonic: string,
  toAddress: string,
  amount: bigint = 1_000_000_000_000_000_000n,
): Promise<string> {
  return transferFundsBatch(wsEndpoint, fromMnemonic, [{ toAddress, amount }])
}

export function randomUsername(length = 13): string {
  return customAlphabet(lowercase)(length).toLowerCase()
}

export async function getStatus(
  app: {
    api: {
      v1: { usernames: { [':username']: { $get: (opts: { param: { username: string } }) => Promise<Response> } } }
    }
  },
  username: string,
): Promise<string | null> {
  const response = await app.api.v1.usernames[':username'].$get({ param: { username } })
  if (response.status !== 200) return null
  const data = (await response.json()) as { status: string }
  return data.status
}
