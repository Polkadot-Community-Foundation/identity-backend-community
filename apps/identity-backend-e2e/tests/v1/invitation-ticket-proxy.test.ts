import { checkResponseWithBody } from '@identity-backend/testing/hono'
import { hc } from 'hono/client'
import type { App } from 'identity-backend-container/v1'
import { Binary, createClient } from 'polkadot-api'
import { getWsProvider } from 'polkadot-api/ws'
import type { StartedDockerComposeEnvironment } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { generateMnemonic, getEventsAtBlock, withPolkadotClient } from '../helpers.ts'
import { setupTestEnvironment, teardownTestEnvironment } from '../setup.ts'
import {
  createInvitedSigner,
  createProofOfInkSigner,
  generateClaimant,
  hexPublicKeyToSs58,
  setBalanceViaDevStorage,
  setupGameInRegistrationPhase,
  verifyInvitationTicketOnChain,
} from './invitation-ticket.helpers.ts'

const WAIT_CONFIG = {
  timeout: 600_000,
  interval: 5_000,
}

const INVITER_PUBLIC_KEY = 'd43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d'

const PROXY_LOOKBACK_BLOCKS = 60

/**
 * Walk back from the current finalized head and return true if any of the
 * recent N blocks emitted a Proxy.ProxyExecuted event. Used to assert that
 * the invitation ticket daemon submitted via Proxy.proxy rather than directly.
 */
async function findRecentProxyExecuted(wsEndpoint: string, lookbackBlocks: number): Promise<boolean> {
  const client = createClient(getWsProvider(wsEndpoint))
  try {
    let currentHash = await client._request<string>('chain_getFinalizedHead', [])
    for (let i = 0; i < lookbackBlocks; i++) {
      const events = await getEventsAtBlock(wsEndpoint, currentHash)
      const found = events.some(
        (e) => e.event.type === 'Proxy' && e.event.value.type === 'ProxyExecuted',
      )
      if (found) return true
      const header = await client._request<{ parentHash: string; number: string }>(
        'chain_getHeader',
        [currentHash],
      )
      if (header.number === '0x0') break
      currentHash = header.parentHash
    }
    return false
  } finally {
    client.destroy()
  }
}

describe('E2E: Invitation Ticket Claiming via Proxy Delegation', () => {
  describe('Happy Path: Daemon populates pool via proxy, ticket is claimed', () => {
    let environment: StartedDockerComposeEnvironment
    let app: ReturnType<typeof hc<App>>
    let wsEndpoint: string

    beforeAll(async () => {
      const result = await setupTestEnvironment<App>({
        peopleNetwork: 'pop-testnet',
        INVITATION_TICKET_DAEMON_ENABLED: 'true',
        PROXY_DELEGATION_ENABLED: 'true',
      })
      ;({ environment, app } = result)
      wsEndpoint = `ws://localhost:${result.chopsticksPort}`
    })

    afterAll(async () => {
      await teardownTestEnvironment(environment)
    })

    it('Should_ClaimInvitationTicketAndSignUpWithInvite_When_GameRequested', async () => {
      const mnemonic = generateMnemonic()
      const claimant = generateClaimant(mnemonic)
      await setBalanceViaDevStorage(wsEndpoint, claimant.address, '1000000000000000000')

      const claimResponse = await vi.waitUntil(
        async () => {
          const response = await app.api.v1['invitation-ticket'].claim.$post({
            json: { who: claimant.address, dim: 'Game' },
          })
          if (response.status === 200) {
            return response
          }
          return null
        },
        WAIT_CONFIG,
      )

      const data = await (await checkResponseWithBody(claimResponse, 200)).json()
      expect(data).toEqual(
        expect.objectContaining({
          inviter: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY',
          dim: 'Game',
          network: 'paseo',
          claimedBy: claimant.address,
          publicKey: expect.any(String),
          signature: expect.any(String),
          remaining: expect.any(Number),
          createdAt: expect.any(String),
          claimedAt: expect.any(String),
        }),
      )

      const ticketOnChain = await verifyInvitationTicketOnChain(wsEndpoint, data.publicKey, 'Game')
      expect(ticketOnChain).toBe(true)

      const hasProxyExecuted = await findRecentProxyExecuted(wsEndpoint, PROXY_LOOKBACK_BLOCKS)
      expect(
        hasProxyExecuted,
        'Proxy.ProxyExecuted event should exist in recent finalized blocks when daemon registers tickets via proxy',
      ).toBe(true)

      await setupGameInRegistrationPhase(wsEndpoint)

      const signUpResult = await withPolkadotClient(wsEndpoint, async (api) => {
        const inviterBytes = new Uint8Array(
          INVITER_PUBLIC_KEY.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16)),
        )
        const ticketBytes = new Uint8Array(
          data.publicKey.slice(2).match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16)),
        )
        const signatureBytes = new Uint8Array(
          data.signature.slice(2).match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16)),
        )

        const invitedSigner = createInvitedSigner(
          claimant.signer,
          0,
          inviterBytes,
          ticketBytes,
          signatureBytes,
        )

        const tx = api.tx.Game.sign_up_with_invite({
          identifier_key: Binary.toHex(claimant.identifierKey),
          airdrop: undefined,
        })
        return await tx.signAndSubmit(invitedSigner)
      })
      expect(signUpResult.ok).toBe(true)
    }, 600_000)

    it('Should_ClaimInvitationTicketAndApplyWithInvitation_When_ProofOfInkRequested', async () => {
      const mnemonic = generateMnemonic()
      const claimant = generateClaimant(mnemonic)
      await setBalanceViaDevStorage(wsEndpoint, claimant.address, '1000000000000000000')

      const claimResponse = await vi.waitUntil(
        async () => {
          const response = await app.api.v1['invitation-ticket'].claim.$post({
            json: { who: claimant.address, dim: 'ProofOfInk' },
          })
          if (response.status === 200) {
            return response
          }
          return null
        },
        WAIT_CONFIG,
      )

      const data = await (await checkResponseWithBody(claimResponse, 200)).json()
      expect(data).toEqual(
        expect.objectContaining({
          inviter: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY',
          dim: 'ProofOfInk',
          network: 'paseo',
          claimedBy: claimant.address,
          publicKey: expect.any(String),
          signature: expect.any(String),
          remaining: expect.any(Number),
          createdAt: expect.any(String),
          claimedAt: expect.any(String),
        }),
      )

      const ticketOnChain = await verifyInvitationTicketOnChain(wsEndpoint, data.publicKey, 'ProofOfInk')
      expect(ticketOnChain).toBe(true)

      const hasProxyExecuted = await findRecentProxyExecuted(wsEndpoint, PROXY_LOOKBACK_BLOCKS)
      expect(
        hasProxyExecuted,
        'Proxy.ProxyExecuted event should exist in recent finalized blocks when daemon registers tickets via proxy',
      ).toBe(true)

      const applyResult = await withPolkadotClient(wsEndpoint, async (api) => {
        const ticketAddress = hexPublicKeyToSs58(data.publicKey)

        const proofOfInkSigner = createProofOfInkSigner(claimant.signer, 0)

        const tx = api.tx.ProofOfInk.apply_with_invitation({
          inviter: data.inviter,
          ticket: ticketAddress,
          signature: { type: 'Sr25519', value: data.signature },
        })
        return await tx.signAndSubmit(proofOfInkSigner)
      })
      expect(applyResult.ok).toBe(true)
    }, 600_000)
  })
})
