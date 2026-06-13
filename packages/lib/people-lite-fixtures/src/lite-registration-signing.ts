import { p256 } from '@noble/curves/nist.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { hexToBytes } from '@noble/hashes/utils.js'
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
import { encodeHex } from 'effect/Encoding'
import { Bytes, Option, str, Tuple } from 'scale-ts'
import { member_from_entropy, sign } from 'verifiablejs/nodejs'

export const REGISTER_SIGNATURE_MESSAGE_PREFIX = 'pop:people-lite:register using' as const

const ACCOUNT_ID_SIZE = 32
const P256_PUBLIC_KEY_SIZE = 65
const IDENTIFIER_KEY_SIZE = 65

const DERIVATION_PATHS = {
  wallet: '//polkadot//0',
  candidate: '//wallet',
  internalPayout: '//internal_payout//0',
  mobRule: '//mob_rule//0',
  identity: '//identity//0',
  score: '//score//0',
  chat: '//wallet//chat',
} as const

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
  return {
    publicKey,
    privateKey: keypair,
    sign: (message: Uint8Array) => sr25519_sign(publicKey, keypair, message),
  }
}

function createVerifiableEntropy(mnemonic: string): Uint8Array {
  return blake2b256(mnemonicToEntropy(mnemonic))
}

function deriveP256IdentifierKeyFromSr25519(privateKey: Uint8Array): Uint8Array {
  const p256PrivateKeySeed = blake2b256(privateKey)
  const p256PublicKeyUncompressed = p256.getPublicKey(p256PrivateKeySeed, false)
  const rawPublicKeyCoordinates = p256PublicKeyUncompressed.slice(1)

  const identifierKey = new Uint8Array(P256_PUBLIC_KEY_SIZE)
  identifierKey.set(rawPublicKeyCoordinates, 0)
  return identifierKey
}

function buildRegistrationMessage(candidatePublicKey: Uint8Array, ringVrfKey: Uint8Array): Uint8Array {
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
  return codec.enc([candidatePublicKey, verifierAccountId, identifierKey, username, undefined])
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
  return {
    mainWallet: derive(DERIVATION_PATHS.wallet),
    candidateWallet: derive(DERIVATION_PATHS.candidate),
    internalPayout: derive(DERIVATION_PATHS.internalPayout),
    mobRule: derive(DERIVATION_PATHS.mobRule),
    identity: derive(DERIVATION_PATHS.identity),
    score: derive(DERIVATION_PATHS.score),
    verifiableEntropy: createVerifiableEntropy(mnemonic),
  }
}

export interface LitePersonParams {
  username: string
  ringVrfKey: Uint8Array
  candidatePublicKey: Uint8Array
  candidateAccountId: string
  candidateSignature: Uint8Array
  consumerRegistrationSignature: Uint8Array
  proofOfOwnership: Uint8Array
  identifierKey: Uint8Array
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
      candidatePublicKey,
      candidateAccountId,
      candidateSignature,
      consumerRegistrationSignature,
      proofOfOwnership,
      identifierKey,
    }
  }
}

export function deriveLitePersonParams(
  mnemonic: string,
  username: string,
  verifierAddress: string,
): LitePersonParams {
  return createLitePersonSigner(mnemonic, verifierAddress)(username)
}

export function verifierAddressFromPublicKeyHex(publicKeyHex: string): string {
  return ss58Encode(hexToBytes(publicKeyHex.replace(/^0x/, '')))
}

export function candidatePublicKeyHex(mnemonic: string): string {
  const derive = sr25519CreateDerive(mnemonicToMiniSecret(mnemonic, ''))
  return `0x${encodeHex(derive(DERIVATION_PATHS.candidate).publicKey)}`
}

export function litePersonParamsCandidatePublicKeyHex(params: LitePersonParams): string {
  return `0x${encodeHex(params.candidatePublicKey)}`
}

export interface ClientProof {
  clientId: Uint8Array
  proof: Uint8Array
}

export function buildClientProof(params: { mnemonic: string; challenge: Uint8Array; body: Uint8Array }): ClientProof {
  const candidate = sr25519CreateDerive(mnemonicToMiniSecret(params.mnemonic, ''))(DERIVATION_PATHS.candidate)
  const payloadHash = sha256(params.body)
  const proofPayload = sha256(new Uint8Array([...params.challenge, ...candidate.publicKey, ...payloadHash]))
  return { clientId: candidate.publicKey, proof: candidate.sign(proofPayload) }
}

export interface RegisterRequestBody {
  candidateAccountId: string
  username: string
  candidateSignature: string
  ringVrfKey: string
  proofOfOwnership: string
  consumerRegistrationSignature: string
  identifierKey: string
}

export function formatParams(params: LitePersonParams): RegisterRequestBody {
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

export { generateMnemonic, type KeyPair }
