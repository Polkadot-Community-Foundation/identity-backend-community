import { previewnet_people } from '@identity-backend/descriptors'
import { p256 } from '@noble/curves/nist.js'
import { getPolkadotSigner, type PolkadotSigner } from '@polkadot-api/signer'
import { sr25519CreateDerive } from '@polkadot-labs/hdkd'
import { blake2b256, mnemonicToMiniSecret, ss58Encode } from '@polkadot-labs/hdkd-helpers'
import { Match } from 'effect'
import { type TypedApi } from 'polkadot-api'
import { Bytes, Enum as ScaleEnum, Option, Struct, u32 } from 'scale-ts'

import { getTransferClient, withPolkadotClient } from '../helpers.js'

const DIM_INVITER = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY'
const SS58_PREFIX = 42

function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex
  return new Uint8Array(cleanHex.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16)))
}

export function hexPublicKeyToSs58(hexPublicKey: string): string {
  return ss58Encode(hexToBytes(hexPublicKey), SS58_PREFIX)
}

function getPendingInvitesPallet(
  api: TypedApi<typeof previewnet_people>,
  dim: 'Game' | 'ProofOfInk',
) {
  return Match.value(dim).pipe(
    Match.when('Game', () => api.query.Game),
    Match.when('ProofOfInk', () => api.query.ProofOfInk),
    Match.exhaustive,
  )
}

export function deriveIdentifierKeyFromMnemonic(mnemonic: string): Uint8Array {
  const miniSecret = mnemonicToMiniSecret(mnemonic, '')
  const p256PrivateKeySeed = blake2b256(miniSecret)
  const uncompressedPublicKey = p256.getPublicKey(p256PrivateKeySeed, false)
  const rawCoordinates = uncompressedPublicKey.slice(1)
  const identifierKey = new Uint8Array(65)
  identifierKey.set(rawCoordinates, 0)
  return identifierKey
}

export function generateClaimant(mnemonic: string): {
  address: string
  identifierKey: Uint8Array
  signer: PolkadotSigner
} {
  const miniSecret = mnemonicToMiniSecret(mnemonic, '')
  const derive = sr25519CreateDerive(miniSecret)
  const wallet = derive('//polkadot//0')
  const address = ss58Encode(wallet.publicKey)
  const identifierKey = deriveIdentifierKeyFromMnemonic(mnemonic)
  const signer = getPolkadotSigner(wallet.publicKey, 'Sr25519', wallet.sign)
  return { address, identifierKey, signer }
}

export async function verifyInvitationTicketOnChain(
  wsEndpoint: string,
  ticketPublicKey: string,
  dim: 'Game' | 'ProofOfInk',
): Promise<boolean> {
  return withPolkadotClient(wsEndpoint, async (api) => {
    const pallet = getPendingInvitesPallet(api, dim)
    const ticketAddress = hexPublicKeyToSs58(ticketPublicKey)
    const entry = await pallet.PendingInvites.getValue(DIM_INVITER, ticketAddress)
    return entry !== undefined
  })
}

export async function setBalanceViaDevStorage(
  wsEndpoint: string,
  address: string,
  balance: string,
): Promise<void> {
  const { client } = getTransferClient(wsEndpoint)
  await client._request('dev_setStorage', [
    {
      System: {
        Account: [
          [
            [address],
            {
              nonce: 0,
              consumers: 0,
              providers: 1,
              sufficients: 0,
              data: {
                free: balance,
                reserved: '0',
                frozen: '0',
                flags: '0',
              },
            },
          ],
        ],
      },
    },
  ])
}

const MultiSignature = ScaleEnum({
  Ed25519: Bytes(64),
  Sr25519: Bytes(64),
  Ecdsa: Bytes(65),
  Eth: Bytes(65),
})

const GameAsInvitedData = Struct({
  nonce: u32,
  inviter: Bytes(32),
  ticket: Bytes(32),
  signature: MultiSignature,
})

const GameAsInvited = Option(GameAsInvitedData)

function encodeGameAsInvited(
  nonce: number,
  inviter: Uint8Array,
  ticket: Uint8Array,
  signature: Uint8Array,
): Uint8Array {
  return GameAsInvited.enc({
    nonce,
    inviter,
    ticket,
    signature: { tag: 'Sr25519', value: signature },
  })
}

export function createInvitedSigner(
  baseSigner: PolkadotSigner,
  nonce: number,
  inviter: Uint8Array,
  ticket: Uint8Array,
  signature: Uint8Array,
): PolkadotSigner {
  const gameAsInvitedValue = encodeGameAsInvited(nonce, inviter, ticket, signature)

  return {
    publicKey: baseSigner.publicKey,
    signBytes: baseSigner.signBytes,
    signTx: async (callData, signedExtensions, metadata, atBlockNumber, hasher) => {
      return baseSigner.signTx(
        callData,
        {
          ...signedExtensions,
          GameAsInvited: {
            identifier: 'GameAsInvited',
            value: gameAsInvitedValue,
            additionalSigned: new Uint8Array([]),
          },
          VerifyMultiSignature: {
            identifier: 'VerifyMultiSignature',
            value: new Uint8Array([0]),
            additionalSigned: new Uint8Array([]),
          },
        },
        metadata,
        atBlockNumber,
        hasher,
      )
    },
  }
}

const AsProofOfInkParticipantInfo = ScaleEnum({
  AsApplyWithSig: u32,
  AsReferred: u32,
  AsInvited: u32,
})

const AsProofOfInkParticipant = Option(AsProofOfInkParticipantInfo)

function encodeAsProofOfInkParticipant(nonce: number): Uint8Array {
  return AsProofOfInkParticipant.enc({
    tag: 'AsInvited',
    value: nonce,
  })
}

export function createProofOfInkSigner(
  baseSigner: PolkadotSigner,
  nonce: number,
): PolkadotSigner {
  const asProofOfInkValue = encodeAsProofOfInkParticipant(nonce)

  return {
    publicKey: baseSigner.publicKey,
    signBytes: baseSigner.signBytes,
    signTx: async (callData, signedExtensions, metadata, atBlockNumber, hasher) => {
      return baseSigner.signTx(
        callData,
        {
          ...signedExtensions,
          AsProofOfInkParticipant: {
            identifier: 'AsProofOfInkParticipant',
            value: asProofOfInkValue,
            additionalSigned: new Uint8Array([]),
          },
          VerifyMultiSignature: {
            identifier: 'VerifyMultiSignature',
            value: new Uint8Array([0]),
            additionalSigned: new Uint8Array([]),
          },
        },
        metadata,
        atBlockNumber,
        hasher,
      )
    },
  }
}

export async function setupGameInRegistrationPhase(wsEndpoint: string): Promise<void> {
  const { client } = getTransferClient(wsEndpoint)
  const now = Math.floor(Date.now() / 1000)
  const future = now + 3600

  await client._request('dev_setStorage', [
    {
      Game: {
        Game: {
          index: 0,
          registration_ends: future,
          shuffle_deadline: future + 3600,
          game_date: future + 7200,
          report_ends: future + 10800,
          state: { Registration: { next_player_index: 0 } },
          max_group_size: 10,
          rounds: 1,
        },
      },
    },
  ])
}
