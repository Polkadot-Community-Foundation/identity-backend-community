/**
 * Helpers specific to username-search E2E tests.
 * Re-exports common helpers and adds test-specific utilities for
 * full/lite username prioritization testing.
 */

import { pop_testnet } from '@identity-backend/descriptors'
import { checkResponseWithBody } from '@identity-backend/testing/hono'
import { getPolkadotSigner, type PolkadotSigner } from '@polkadot-api/signer'
import { sr25519CreateDerive } from '@polkadot-labs/hdkd'
import { type KeyPair, mnemonicToMiniSecret, ss58Encode } from '@polkadot-labs/hdkd-helpers'
import { Effect } from 'effect'
import { hc } from 'hono/client'
import type { App } from 'identity-backend-container/v1'
import { Binary, Enum, type TypedApi } from 'polkadot-api'
import { Enum as ScaleEnum, Option, u32, u64 } from 'scale-ts'
import { expect, vi } from 'vitest'

import { createPeopleSigner, formatParams, getStatus, getTransferClient, transferFunds } from '../helpers.js'
import type { LitePersonParams, PopTestnetApi } from '../helpers.js'

export {
  createPeopleSigner,
  deriveLitePersonParams,
  formatParams,
  generateMnemonic,
  getStatus,
  randomUsername,
  setupWallets,
  transferFunds,
  transferFundsBatch,
  waitForRegistration,
  withPolkadotClient,
} from '../helpers.ts'

export type { LitePersonParams, PopTestnetApi, SetupResult, WaitForRegistrationResult } from '../helpers.js'

/** Alice's well-known dev mnemonic */
export const ALICE_MNEMONIC = 'bottom drive obey lake curtain smoke basket hold race lonely fit walk'

/** Alice's SS58 address (verifier account) */
export const ALICE_ADDRESS = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY'

/**
 * Well-known test mnemonic for lite person registration.
 * This mnemonic's ring VRF key is included in the Chopsticks Root storage.
 */
export const LITE_TEST_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

/** Alice's public key as hex string */
export const ALICE_PUBLIC_KEY_HEX = 'd43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d'

/** Standard derivation paths used in the Individuality SDK */
export const DERIVATION_PATHS = {
  wallet: '//polkadot//0',
  candidate: '//wallet',
  internalPayout: '//internal_payout//0',
  mobRule: '//mob_rule//0',
  identity: '//identity//0',
  score: '//score//0',
  chat: '//wallet//chat',
} as const

const WAIT_CONFIG = {
  timeout: 45_000,
  interval: 1_000,
}

export interface RegisterLitePersonParams {
  api: TypedApi<typeof pop_testnet>
  signer: PolkadotSigner
  identifierKey: Uint8Array
  liteUsername: string
  reservedFullUsername?: string
}

export interface RegisterPersonParams {
  api: TypedApi<typeof pop_testnet>
  signer: PolkadotSigner
  linkedLiteIdentity: string
  liteKeypair: KeyPair
  usernameChoice: { type: 'Standalone'; username: string } | { type: 'Reservation'; username: string }
}

export type TestApp = ReturnType<typeof hc<App>>

export interface RegistrationResult {
  ok: boolean
  dispatchError?: unknown
}

export interface SearchPrioritizationResult {
  hasFullUsername: boolean
  hasLiteUsername: boolean
}

export function hexToBytes(hex: string): Uint8Array {
  return new Uint8Array(hex.match(/.{2}/g)!.map((byte) => parseInt(byte, 16)))
}

export const ALICE_PUBLIC_KEY = hexToBytes(ALICE_PUBLIC_KEY_HEX)

export function deriveLiteKeypair(mnemonic: string): KeyPair {
  const miniSecret = mnemonicToMiniSecret(mnemonic, '')
  const derive = sr25519CreateDerive(miniSecret)
  return derive(DERIVATION_PATHS.candidate)
}

export type { KeyPair }

const AsPersonalAliasWithAccount = ScaleEnum({ AsPersonalAliasWithAccount: u32 })
const AsPersonExtension = Option(AsPersonalAliasWithAccount)

const AsLitePerson = ScaleEnum({ AsLitePerson: u32 })
const PeopleLiteAuthExtension = Option(AsLitePerson)

const makeVerifyMultiSignature = (): {
  identifier: string
  value: Uint8Array
  additionalSigned: Uint8Array
} => ({
  identifier: 'VerifyMultiSignature',
  value: new Uint8Array([0]),
  additionalSigned: new Uint8Array([]),
})

const RESTRICT_ORIGINS_ENABLED = {
  identifier: 'RestrictOrigins',
  value: new Uint8Array([1]),
  additionalSigned: new Uint8Array([]),
}

export function createPersonSigner(
  keyPair: KeyPair,
  nonce: number,
): PolkadotSigner {
  const baseSigner = getPolkadotSigner(keyPair.publicKey, 'Sr25519', keyPair.sign)
  const asPersonValue = AsPersonExtension.enc({ tag: 'AsPersonalAliasWithAccount', value: nonce })

  return {
    publicKey: baseSigner.publicKey,
    signBytes: baseSigner.signBytes,
    signTx: async (callData, signedExtensions, metadata, atBlockNumber, hasher) => {
      return baseSigner.signTx(
        callData,
        {
          ...signedExtensions,
          VerifyMultiSignature: makeVerifyMultiSignature(),
          AsPerson: { identifier: 'AsPerson', value: asPersonValue, additionalSigned: new Uint8Array([]) },
          RestrictOrigins: RESTRICT_ORIGINS_ENABLED,
        },
        metadata,
        atBlockNumber,
        hasher,
      )
    },
  }
}

export function createLitePersonSigner(
  keyPair: KeyPair,
  nonce: number,
): PolkadotSigner {
  const baseSigner = getPolkadotSigner(keyPair.publicKey, 'Sr25519', keyPair.sign)
  const peopleLiteAuthValue = PeopleLiteAuthExtension.enc({ tag: 'AsLitePerson', value: nonce })

  return {
    publicKey: baseSigner.publicKey,
    signBytes: baseSigner.signBytes,
    signTx: async (callData, signedExtensions, metadata, atBlockNumber, hasher) => {
      return baseSigner.signTx(
        callData,
        {
          ...signedExtensions,
          PeopleLiteAuth: {
            identifier: 'PeopleLiteAuth',
            value: peopleLiteAuthValue,
            additionalSigned: new Uint8Array([]),
          },
          RestrictOrigins: RESTRICT_ORIGINS_ENABLED,
          VerifyMultiSignature: makeVerifyMultiSignature(),
        },
        metadata,
        atBlockNumber,
        hasher,
      )
    },
  }
}

export function createAliceSigner(
  nonce?: number,
): PolkadotSigner {
  const miniSecret = mnemonicToMiniSecret(ALICE_MNEMONIC, '')
  const derive = sr25519CreateDerive(miniSecret)
  const aliceKeypair = derive('//Alice')

  if (nonce !== undefined) {
    return createPersonSigner(aliceKeypair, nonce)
  }
  return createPeopleSigner(aliceKeypair)
}

/**
 * Grant personhood to an account via dev_setStorage.
 * For test environments only.
 */
export async function grantPersonhoodViaDummyDim(
  wsEndpoint: string,
  personalId: number,
  accountId: string,
): Promise<{ blockHash: string }> {
  const { client, api } = getTransferClient(wsEndpoint)

  const existingPersonalId = await api.query.People.AccountToPersonalId.getValue(accountId)

  if (existingPersonalId !== undefined && existingPersonalId !== null) {
    if (Number(existingPersonalId) === personalId) {
      return { blockHash: 'pre-configured' }
    }
    console.log(`[DummyDim] WARNING: Existing PersonalId ${existingPersonalId} differs from requested ${personalId}`)
  }

  const encodedPersonalId = '0x' + Buffer.from(u64.enc(BigInt(personalId))).toString('hex')

  await client._request('dev_setStorage', [
    {
      People: {
        AccountToPersonalId: [[[accountId], encodedPersonalId]],
      },
    },
  ])

  const storedPersonalId = await api.query.People.AccountToPersonalId.getValue(accountId)
  if (storedPersonalId === undefined || storedPersonalId === null) {
    throw new Error(`Failed to set AccountToPersonalId storage - value is ${storedPersonalId}`)
  }
  if (Number(storedPersonalId) !== personalId) {
    throw new Error(`AccountToPersonalId mismatch - expected ${personalId}, got ${storedPersonalId}`)
  }

  return { blockHash: 'storage-set' }
}

export async function registerLitePerson(params: RegisterLitePersonParams) {
  const { api, signer, identifierKey, liteUsername, reservedFullUsername } = params

  return api.tx.Resources.register_lite_person({
    identifier_key: Binary.toHex(identifierKey),
    username: Binary.fromText(liteUsername),
    reserved_username: reservedFullUsername ? Binary.fromText(reservedFullUsername) : undefined,
  }).signAndSubmit(signer)
}

export async function registerPerson(params: RegisterPersonParams) {
  const { api, signer, linkedLiteIdentity, liteKeypair, usernameChoice } = params

  const signerAddress = ss58Encode(signer.publicKey)
  const aliasEntry = await api.query.People.AccountToAlias.getValue(signerAddress)

  if (!aliasEntry) {
    throw new Error(`No alias found for signer address ${signerAddress}`)
  }

  const liteIdentityProofSignature = liteKeypair.sign(Binary.fromHex(aliasEntry.ca.alias))

  return api.tx.Resources.register_person({
    linked_lite_identity: linkedLiteIdentity,
    lite_identity_proof: Enum('Sr25519', Binary.toHex(liteIdentityProofSignature)),
    username_choice: Enum(usernameChoice.type, Binary.fromText(usernameChoice.username)),
  }).signAndSubmit(signer)
}

/**
 * Initialize verifiable WASM module.
 * Note: For Node.js environments using verifiablejs/nodejs, this is a no-op
 * since the Node.js binding handles initialization automatically.
 */
export async function initializeVerifiableWasm(): Promise<void> {
  // No-op for Node.js environments using verifiablejs/nodejs
}

export async function buildChopsticksBlock(wsEndpoint: string): Promise<void> {
  const httpEndpoint = wsEndpoint.replace('ws://', 'http://')
  await fetch(httpEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'dev_newBlock', params: [] }),
  })
}

export async function registerLiteUsernameViaApi(
  app: TestApp,
  wsEndpoint: string,
  params: LitePersonParams,
): Promise<string> {
  await transferFunds(wsEndpoint, ALICE_MNEMONIC, params.candidateAccountId)

  const response = await app.api.v1.usernames.$post({
    header: {},
    json: formatParams(params),
  })
  const data = await (await checkResponseWithBody(response, 202)).json()
  return data.username
}

export async function waitForUsernameAssignment(
  app: TestApp,
  username: string,
  config = WAIT_CONFIG,
): Promise<void> {
  await vi.waitUntil(async () => {
    const status = await getStatus(app, username)
    return status === 'ASSIGNED'
  }, config)
}

export function isAlreadyRegisteredError(result: RegistrationResult): boolean {
  const dispatchError = result.dispatchError as {
    type?: string
    value?: { type?: string; value?: { type?: string } }
  } | undefined

  return dispatchError?.type === 'Module' &&
    dispatchError?.value?.type === 'Resources' &&
    dispatchError?.value?.value?.type === 'AlreadyRegistered'
}

export async function verifyConsumerHasFullUsername(
  api: PopTestnetApi,
  candidateAccountId: string,
  expectedUsername: string,
): Promise<boolean> {
  const consumerEntry = await api.query.Resources.Consumers.getValue(candidateAccountId)
  return consumerEntry?.full_username != null
    ? Binary.toText(consumerEntry.full_username) === expectedUsername
    : false
}

export async function assertRegistrationSucceededOrAlreadyHasUsername(
  result: RegistrationResult,
  api: PopTestnetApi,
  candidateAccountId: string,
  expectedUsername: string,
): Promise<void> {
  if (result.ok) return

  if (isAlreadyRegisteredError(result)) {
    const hasExpectedUsername = await verifyConsumerHasFullUsername(api, candidateAccountId, expectedUsername)
    if (!hasExpectedUsername) {
      throw new Error(`AlreadyRegistered but consumer does not have expected full username: ${expectedUsername}`)
    }
    return
  }

  expect(result, 'register_person should succeed').toBe(expect.objectContaining({ ok: true }))
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

export async function upgradeToFullPerson(
  wsEndpoint: string,
  liteParams: LitePersonParams,
  fullUsername: string,
): Promise<void> {
  const { api } = getTransferClient(wsEndpoint)
  const liteKeypair = deriveLiteKeypair(LITE_TEST_MNEMONIC)

  await grantPersonhoodViaDummyDim(wsEndpoint, 0, ALICE_ADDRESS)

  const maxRetries = 5
  const baseDelayMs = 800
  let lastErr: unknown

  for (let i = 0; i < maxRetries; i++) {
    try {
      const aliceAccount = await api.query.System.Account.getValue(ALICE_ADDRESS)
      const aliceNonce = Number(aliceAccount!.nonce)
      const aliceSigner = createAliceSigner(aliceNonce)

      const result = await registerPerson({
        api,
        signer: aliceSigner,
        linkedLiteIdentity: liteParams.candidateAccountId,
        liteKeypair,
        usernameChoice: { type: 'Standalone', username: fullUsername },
      })

      await assertRegistrationSucceededOrAlreadyHasUsername(
        result,
        api,
        liteParams.candidateAccountId,
        fullUsername,
      )
      return
    } catch (err) {
      lastErr = err
      const isStale = detectStaleError(err)
      if (!isStale || i === maxRetries - 1) throw err
      const delay = baseDelayMs * (i + 1)
      console.log(`[upgradeToFullPerson StaleRetry] attempt ${i + 1}/${maxRetries} failed, waiting ${delay}ms`)
      await Effect.runPromise(Effect.sleep(`${delay} millis`))
    }
  }
  throw lastErr
}

export async function waitForSearchPrioritization(
  app: TestApp,
  searchPrefix: string,
  fullUsername: string,
  liteUsername: string,
  config = WAIT_CONFIG,
): Promise<SearchPrioritizationResult> {
  return vi.waitUntil(
    async () => {
      const response = await app.api.v1.usernames.search.$get({
        header: {},
        query: { prefix: searchPrefix, limit: 10 },
      })

      if (response.status !== 200) return false
      const data = await (await checkResponseWithBody(response, 200)).json()
      const hasFullUsername = data.usernames.some((item: { username: string }) => item.username === fullUsername)
      const hasLiteUsername = data.usernames.some((item: { username: string }) => item.username === liteUsername)

      if (hasFullUsername && !hasLiteUsername) {
        return { hasFullUsername, hasLiteUsername }
      }
      return false
    },
    config,
  )
}
