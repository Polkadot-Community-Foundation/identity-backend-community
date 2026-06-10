/**
 * @module
 * Helpers for dim-ticket E2E tests: address generation and on-chain verification.
 */

import { pop_testnet } from '@identity-backend/descriptors'
import { blake2b256, ss58Encode } from '@polkadot-labs/hdkd-helpers'
import { sr25519_pubkey, sr25519_secret_from_seed } from '@polkadot-labs/schnorrkel-wasm'
import { Match } from 'effect'
import type { TypedApi } from 'polkadot-api'

import { withPolkadotClient } from '../helpers.js'

const SS58_PREFIX = 42

/** Inviter address used by the backend - MUST match PROXY_PRIVATE_KEY derivation */
const DIM_INVITER = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY' as const

/**
 * Generate a deterministic unique SS58 address for DIM ticket tests.
 * Derives from a hash of the id so each test gets a distinct address.
 *
 * @param id - Unique identifier for the test scenario (e.g. 'game-happy-path')
 * @returns SS58 address string
 */
export function generateDIMTestAddress(id: string): string {
  const seed = blake2b256(new TextEncoder().encode(id))
  const keypair = sr25519_secret_from_seed(seed)
  const publicKey = sr25519_pubkey(keypair)
  return ss58Encode(publicKey, SS58_PREFIX)
}

function getPendingInvitesPallet(
  api: TypedApi<typeof pop_testnet>,
  dim: 'Game' | 'ProofOfInk',
) {
  return Match.value(dim).pipe(
    Match.when('Game', () => api.query.Game),
    Match.when('ProofOfInk', () => api.query.ProofOfInk),
    Match.exhaustive,
  )
}

/**
 * Verify that a DIM ticket has been registered on-chain for the given invitee.
 *
 * @param wsEndpoint - WebSocket endpoint for the chain (e.g. Chopsticks)
 * @param inviteeAddress - SS58 address of the ticket holder
 * @param dim - 'Game' or 'ProofOfInk'
 * @returns true if the ticket exists in PendingInvites(inviter, ticket)
 */
export async function verifyDimTicketOnChain(
  wsEndpoint: string,
  inviteeAddress: string,
  dim: 'Game' | 'ProofOfInk',
): Promise<boolean> {
  return withPolkadotClient(wsEndpoint, async (api) => {
    const pallet = getPendingInvitesPallet(api, dim)
    const entry = await pallet.PendingInvites.getValue(DIM_INVITER, inviteeAddress)
    return entry !== undefined
  })
}
