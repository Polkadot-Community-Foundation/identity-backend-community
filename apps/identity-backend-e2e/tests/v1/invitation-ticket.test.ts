import { checkResponseWithBody } from '@identity-backend/testing/hono'
import { hc } from 'hono/client'
import type { App } from 'identity-backend-container/v1'
import { Binary } from 'polkadot-api'
import type { StartedDockerComposeEnvironment } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { generateMnemonic, withPolkadotClient } from '../helpers.ts'
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

describe('E2E: Invitation Ticket Claiming', () => {
  describe('Happy Path: Daemon populates pool, ticket is claimed', () => {
    let environment: StartedDockerComposeEnvironment
    let app: ReturnType<typeof hc<App>>
    let wsEndpoint: string

    beforeAll(async () => {
      const result = await setupTestEnvironment<App>({
        peopleNetwork: 'pop-testnet',
        INVITATION_TICKET_DAEMON_ENABLED: 'true',
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

  describe('Error Case: Pool exhausted when daemon is disabled', () => {
    let environment: StartedDockerComposeEnvironment
    let app: ReturnType<typeof hc<App>>

    beforeAll(async () => {
      const result = await setupTestEnvironment<App>({
        peopleNetwork: 'pop-testnet',
        INVITATION_TICKET_DAEMON_ENABLED: 'false',
      })
      ;({ environment, app } = result)
    })

    afterAll(async () => {
      await teardownTestEnvironment(environment)
    })

    it('Should_ReturnPoolExhausted_When_NoTicketsAvailable', async () => {
      const response = await app.api.v1['invitation-ticket'].claim.$post({
        json: { who: '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty', dim: 'Game' },
      })

      const data = await (await checkResponseWithBody(response, 422)).json()
      expect(data).toEqual(expect.objectContaining({ error: 'Pool exhausted' }))
    })
  })
})
