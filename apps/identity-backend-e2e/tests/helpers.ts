import { pop_testnet } from '@identity-backend/descriptors'
import { p256 } from '@noble/curves/nist.js'
import { getDynamicBuilder, getLookupFn } from '@polkadot-api/metadata-builders'
import { type SystemEvent } from '@polkadot-api/observable-client'
import { getPolkadotSigner, type PolkadotSigner } from '@polkadot-api/signer'
import { decAnyMetadata, type HexString, unifyMetadata } from '@polkadot-api/substrate-bindings'

import { sr25519CreateDerive } from '@polkadot-labs/hdkd'
import {
  blake2b256,
  generateMnemonic,
  type KeyPair,
  mnemonicToEntropy,
  mnemonicToMiniSecret,
  ss58Decode,
  ss58Encode,
} from '@polkadot-labs/hdkd-helpers'
import {
  sr25519_derive_keypair_hard,
  sr25519_pubkey,
  sr25519_secret_from_seed,
  sr25519_sign,
} from '@polkadot-labs/schnorrkel-wasm'
import { Effect } from 'effect'
import { encodeHex } from 'effect/Encoding'
import { customAlphabet } from 'nanoid'
import { lowercase } from 'nanoid-dictionary'
import { Binary, createClient, type PolkadotClient, type TypedApi } from 'polkadot-api'
import { getWsProvider } from 'polkadot-api/ws'
import { combineLatest, firstValueFrom, timeout } from 'rxjs'
import { filter, map } from 'rxjs/operators'
import { Bytes, Option, str, Tuple } from 'scale-ts'
import { member_from_entropy, sign } from 'verifiablejs/nodejs'

const DERIVATION_PATHS = {
  wallet: '//polkadot//0',
  candidate: '//wallet',
  internalPayout: '//internal_payout//0',
  mobRule: '//mob_rule//0',
  identity: '//identity//0',
  score: '//score//0',
  chat: '//wallet//chat',
}

interface KeyPairWithPrivateKey {
  publicKey: Uint8Array
  privateKey: Uint8Array
  sign: (message: Uint8Array) => Uint8Array
}

function deriveKeyPairWithPrivateKey(
  miniSecret: Uint8Array,
  derivationPaths: string[],
): KeyPairWithPrivateKey {
  let keypair = sr25519_secret_from_seed(miniSecret)

  for (const path of derivationPaths) {
    const chainCode = new Uint8Array(32)
    const pathBytes = new TextEncoder().encode(path)
    chainCode.set(pathBytes.slice(0, 32), 0)

    const pubkey = sr25519_pubkey(keypair)
    const fullKeypair = new Uint8Array(96)
    fullKeypair.set(keypair, 0)
    fullKeypair.set(pubkey, 64)

    const derivedKeypair = sr25519_derive_keypair_hard(fullKeypair, chainCode)
    keypair = derivedKeypair.slice(0, 64)
  }

  const publicKey = sr25519_pubkey(keypair)
  const privateKey = keypair

  return {
    publicKey,
    privateKey,
    sign: (message: Uint8Array) => sr25519_sign(publicKey, privateKey, message),
  }
}

const REGISTER_SIGNATURE_MESSAGE_PREFIX = 'pop:people-lite:register using'

const P256_PUBLIC_KEY_SIZE = 65
const ACCOUNT_ID_SIZE = 32
const IDENTIFIER_KEY_SIZE = 65

function createVerifiableEntropy(mnemonic: string): Uint8Array {
  const entropy = mnemonicToEntropy(mnemonic)
  return blake2b256(entropy)
}

function deriveP256IdentifierKeyFromSr25519(privateKey: Uint8Array): Uint8Array {
  const p256PrivateKeySeed = blake2b256(privateKey)
  const p256PublicKeyUncompressed = p256.getPublicKey(p256PrivateKeySeed, false)
  const rawPublicKeyCoordinates = p256PublicKeyUncompressed.slice(1)

  const identifierKey = new Uint8Array(P256_PUBLIC_KEY_SIZE)
  identifierKey.set(rawPublicKeyCoordinates, 0)
  return identifierKey
}

function buildRegistrationMessage(
  candidatePublicKey: Uint8Array,
  ringVrfKey: Uint8Array,
): Uint8Array {
  const prefixBytes = new TextEncoder().encode(REGISTER_SIGNATURE_MESSAGE_PREFIX)
  return new Uint8Array([...prefixBytes, ...candidatePublicKey, ...ringVrfKey])
}

function buildResourcesSignatureData(
  candidatePublicKey: Uint8Array,
  verifierAccountId: Uint8Array,
  identifierKey: Uint8Array,
  username: string,
): Uint8Array {
  const codec = Tuple(
    Bytes(ACCOUNT_ID_SIZE),
    Bytes(ACCOUNT_ID_SIZE),
    Bytes(IDENTIFIER_KEY_SIZE),
    str,
    Option(str),
  )

  return codec.enc([
    candidatePublicKey,
    verifierAccountId,
    identifierKey,
    username,
    undefined,
  ])
}

export interface SetupResult {
  mainWallet: KeyPair
  candidateWallet: KeyPair
  internalPayout: KeyPair
  mobRule: KeyPair
  identity: KeyPair
  score: KeyPair
  verifiableEntropy: Uint8Array
}

export function setupWallets(mnemonic: string): SetupResult {
  const miniSecret = mnemonicToMiniSecret(mnemonic, '')
  const derive = sr25519CreateDerive(miniSecret)
  const verifiableEntropy = createVerifiableEntropy(mnemonic)

  return {
    mainWallet: derive(DERIVATION_PATHS.wallet),
    candidateWallet: derive(DERIVATION_PATHS.candidate),
    internalPayout: derive(DERIVATION_PATHS.internalPayout),
    mobRule: derive(DERIVATION_PATHS.mobRule),
    identity: derive(DERIVATION_PATHS.identity),
    score: derive(DERIVATION_PATHS.score),
    verifiableEntropy,
  }
}

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

export interface LitePersonParams {
  username: string
  ringVrfKey: Uint8Array
  candidateAccountId: string
  candidateSignature: Uint8Array
  consumerRegistrationSignature: Uint8Array
  proofOfOwnership: Uint8Array
  identifierKey: Uint8Array
}

export function deriveLitePersonParams(
  mnemonic: string,
  username: string,
  verifierAddress: string,
): LitePersonParams {
  return createLitePersonSigner(mnemonic, verifierAddress)(username)
}

export function createLitePersonSigner(
  mnemonic: string,
  verifierAddress: string,
): (username: string) => LitePersonParams {
  const miniSecret = mnemonicToMiniSecret(mnemonic, '')
  const derive = sr25519CreateDerive(miniSecret)
  const verifiableEntropy = createVerifiableEntropy(mnemonic)

  const candidateWallet = derive(DERIVATION_PATHS.candidate)
  const candidatePublicKey = candidateWallet.publicKey

  const ringVrfKey = member_from_entropy(verifiableEntropy)

  const chatWallet = deriveKeyPairWithPrivateKey(miniSecret, ['wallet', 'chat'])
  const identifierKey = deriveP256IdentifierKeyFromSr25519(chatWallet.privateKey)

  const registrationMessage = buildRegistrationMessage(candidatePublicKey, ringVrfKey)
  const candidateSignature = candidateWallet.sign(registrationMessage)
  const proofOfOwnership = sign(verifiableEntropy, registrationMessage)

  const [verifierAccountId] = ss58Decode(verifierAddress)
  const candidateAccountId = ss58Encode(candidatePublicKey)

  return (username: string): LitePersonParams => {
    const resourcesSignatureData = buildResourcesSignatureData(
      candidatePublicKey,
      verifierAccountId,
      identifierKey,
      username,
    )
    const consumerRegistrationSignature = candidateWallet.sign(resourcesSignatureData)

    return {
      username,
      ringVrfKey,
      candidateAccountId,
      candidateSignature,
      consumerRegistrationSignature,
      proofOfOwnership,
      identifierKey,
    }
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

export { generateMnemonic }

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

/**
 * Retry a blockchain submission on Stale nonce errors.
 * The backend daemon races on Alice's account nonce, so transient Stale
 * failures are expected. Destroying the client forces a fresh nonce query.
 */
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

export function formatParams(params: LitePersonParams) {
  return {
    candidateAccountId: params.candidateAccountId,
    username: params.username,
    candidateSignature: `0x${encodeHex(params.candidateSignature)}`,
    ringVrfKey: `0x${encodeHex(params.ringVrfKey)}`,
    proofOfOwnership: `0x${encodeHex(params.proofOfOwnership)}`,
    consumerRegistrationSignature: `0x${encodeHex(params.consumerRegistrationSignature)}`,
    identifierKey: `0x${encodeHex(params.identifierKey)}`,
  }
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
