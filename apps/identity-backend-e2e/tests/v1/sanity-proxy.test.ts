import { checkResponseWithBody } from '@identity-backend/testing/hono'
import { hc } from 'hono/client'
import type { App } from 'identity-backend-container/v1'
import { Binary } from 'polkadot-api'
import type { StartedDockerComposeEnvironment } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  deriveLitePersonParams,
  formatParams,
  generateMnemonic,
  getEventsAtBlock,
  getStatus,
  randomUsername,
  transferFunds,
  withPolkadotClient,
} from '../helpers.ts'

import { setupTestEnvironment, teardownTestEnvironment } from '../setup.ts'

const ALICE_MNEMONIC = 'bottom drive obey lake curtain smoke basket hold race lonely fit walk'
const VERIFIER_ADDRESS = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY'

const WAIT_CONFIG = {
  timeout: 180_000,
  interval: 2_000,
}

type UsernameData = {
  candidateAccountId: string
  username: string
  status: 'RESERVED' | 'ASSIGNED' | 'FAILED'
  onchainData: {
    blockHash: string
    blockNumber: number
    blockIndex: number
    eventIndex?: number
  } | null
  createdAt: string
  updatedAt: string | null
}
;(['pop-testnet'] as const).map((chain) => {
  return describe(`E2E: Proxy Delegation Username Registration on ${chain}`, () => {
    let environment: StartedDockerComposeEnvironment
    let app: ReturnType<typeof hc<App>>
    let chopsticksPort: number
    let wsEndpoint: string

    beforeAll(async () => {
      ;({ environment, app, chopsticksPort } = await setupTestEnvironment<App>({
        peopleNetwork: chain,
        PROXY_DELEGATION_ENABLED: 'true',
      }))
      wsEndpoint = `ws://localhost:${chopsticksPort}`
    })

    afterAll(async () => {
      await teardownTestEnvironment(environment)
    })

    describe('Proxy Delegation: Full Registration Flow', () => {
      it('Should_CompleteRegistration_When_ProxyDelegationEnabled', { timeout: 120_000 }, async () => {
        // ARRANGE
        const mnemonic = generateMnemonic()
        const username = randomUsername()
        const params = deriveLitePersonParams(mnemonic, username, VERIFIER_ADDRESS)

        await transferFunds(wsEndpoint, ALICE_MNEMONIC, params.candidateAccountId)

        // ACT: Submit registration via proxy delegation path
        const registrationResponse = await app.api.v1.usernames.$post({
          header: {},
          json: formatParams(params),
        })
        const registrationData = await (await checkResponseWithBody(registrationResponse, 202)).json()
        const fullUsername = registrationData.username

        expect(registrationData).toMatchObject({
          base_username: username,
          digits: expect.stringMatching(/^\d{2}$/),
          username: expect.stringMatching(new RegExp(`^${username}\\.\\d{2}$`)),
        })

        // ASSERT: Wait for ASSIGNED status through the proxy path
        const finalData: UsernameData = await vi.waitUntil(
          async () => {
            const status = await getStatus(app, fullUsername)
            if (status === 'ASSIGNED') {
              const response = await app.api.v1.usernames[':username'].$get({
                param: { username: fullUsername },
              })
              return (await response.json()) as UsernameData
            }
            return null
          },
          WAIT_CONFIG,
        ) as UsernameData

        expect(finalData.status, 'Registration should reach ASSIGNED via proxy delegation').toBe('ASSIGNED')
        expect(finalData.candidateAccountId).toBe(params.candidateAccountId)
        expect(finalData.onchainData, 'On-chain data should be populated').not.toBeNull()

        // ASSERT: Verify on-chain state and proxy delegation
        await withPolkadotClient(wsEndpoint, async (api) => {
          const usernameBinary = Binary.fromText(fullUsername)
          await vi.waitFor(
            async () => {
              const [litePeople, owner] = await Promise.all([
                api.query.PeopleLite.LitePeople.getValue(params.candidateAccountId),
                api.query.Resources.UsernameOwnerOf.getValue(usernameBinary),
              ])
              return litePeople != null && owner != null
            },
            { timeout: 60_000 },
          )
          const owner = await api.query.Resources.UsernameOwnerOf.getValue(usernameBinary)
          expect(owner, 'Blockchain should map username to owner').toBe(params.candidateAccountId)

          // Verify the transaction was submitted via proxy delegation
          const { blockHash } = finalData.onchainData as NonNullable<
            UsernameData['onchainData']
          >
          const events = await getEventsAtBlock(wsEndpoint, blockHash)
          expect(
            events.length,
            'Events should be decoded from the registration block',
          ).toBeGreaterThan(0)
          const hasProxyExecuted = events.some(
            (e) => e.event.type === 'Proxy' && e.event.value.type === 'ProxyExecuted',
          )
          expect(
            hasProxyExecuted,
            'Proxy.ProxyExecuted event should exist at the registration block',
          ).toBe(true)
        })
      })
    })
  })
})
