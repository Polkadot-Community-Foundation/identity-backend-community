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

type UsernameStatus = 'RESERVED' | 'ASSIGNED' | 'FAILED'

type UsernameData = {
  candidateAccountId: string
  username: string
  status: UsernameStatus
  onchainData: {
    blockHash: string
    blockNumber: number
    blockIndex: number
    eventIndex?: number
  } | null
  createdAt: string
  updatedAt: string | null
}

type AvailabilityStatus = 'AVAILABLE' | 'EXHAUSTED' | 'INVALID'

type V0Response = Record<string, AvailabilityStatus>
type V1Response = {
  _tag: 'v1'
  value: Record<
    string,
    { status: 'INVALID' } | { status: 'EXHAUSTED' } | { status: 'AVAILABLE'; availableDigits: number[] }
  >
}
type AvailabilityResponse = V0Response | V1Response
function getStatusFromResponse(
  data: AvailabilityResponse,
  username: string,
): AvailabilityStatus | undefined {
  const record = data as Record<string, unknown>
  if (record._tag === 'v1') {
    return ((data as V1Response).value[username] as { status: AvailabilityStatus } | undefined)?.status
  }
  return (data as V0Response)[username]
}

;(['pop-testnet'] as const).map((chain) => {
  return describe(`E2E: Username Registration on ${chain}`, () => {
    let environment: StartedDockerComposeEnvironment
    let app: ReturnType<typeof hc<App>>
    let chopsticksPort: number
    let wsEndpoint: string

    beforeAll(async () => {
      ;({ environment, app, chopsticksPort } = await setupTestEnvironment<App>({ peopleNetwork: chain }))
      wsEndpoint = `ws://localhost:${chopsticksPort}`
    })

    afterAll(async () => {
      await teardownTestEnvironment(environment)
    })

    it('Should_CompleteFullRegistrationAndAllocation_When_ValidRequests', async () => {
      // --- ARRANGE: first user ---
      const mnemonic1 = generateMnemonic()
      const username1 = randomUsername()
      const params1 = deriveLitePersonParams(mnemonic1, username1, VERIFIER_ADDRESS)

      // --- ACT & ASSERT: availability before registration ---
      const availabilityBefore = await app.api.v1.usernames.available.$post({
        query: {},
        json: { usernames: [username1] },
      })
      const beforeData = await (await checkResponseWithBody(availabilityBefore, 200)).json()
      expect(
        getStatusFromResponse(beforeData as AvailabilityResponse, username1),
        'Pre-condition: Username should be available before registration',
      ).toBe('AVAILABLE')

      // --- ACT: register first user ---
      await transferFunds(wsEndpoint, ALICE_MNEMONIC, params1.candidateAccountId)

      const registrationResponse = await app.api.v1.usernames.$post({
        header: {},
        json: formatParams(params1),
      })
      const registrationData = await (await checkResponseWithBody(registrationResponse, 202)).json()
      const fullUsername1 = registrationData.username

      expect(registrationData).toMatchObject({
        base_username: username1,
        digits: expect.stringMatching(/^\d{2}$/),
        username: expect.stringMatching(new RegExp(`^${username1}\\.\\d{2}$`)),
      })

      // --- ASSERT: wait for ASSIGNED + verify on-chain ---
      const finalData1: UsernameData = await vi.waitUntil(
        async () => {
          const status = await getStatus(app, fullUsername1)
          if (status === 'ASSIGNED') {
            const response = await app.api.v1.usernames[':username'].$get({
              param: { username: fullUsername1 },
            })
            return (await response.json()) as UsernameData
          }
          return null
        },
        WAIT_CONFIG,
      ) as UsernameData

      expect(finalData1.status).toBe('ASSIGNED')
      expect(finalData1.candidateAccountId).toBe(params1.candidateAccountId)
      expect(finalData1.onchainData).not.toBeNull()

      await withPolkadotClient(wsEndpoint, async (api) => {
        const usernameBinary = Binary.fromText(fullUsername1)
        await vi.waitFor(
          async () => {
            const [litePeople, owner] = await Promise.all([
              api.query.PeopleLite.LitePeople.getValue(params1.candidateAccountId),
              api.query.Resources.UsernameOwnerOf.getValue(usernameBinary),
            ])
            return litePeople != null && owner != null
          },
          { timeout: 60_000 },
        )
        const owner = await api.query.Resources.UsernameOwnerOf.getValue(usernameBinary)
        expect(owner).toBe(params1.candidateAccountId)
      })

      // --- ASSERT: availability still works after registration (99 slots remaining) ---
      const availabilityAfter = await app.api.v1.usernames.available.$post({
        query: {},
        json: { usernames: [username1] },
      })
      const afterData = await (await checkResponseWithBody(availabilityAfter, 200)).json()
      expect(
        getStatusFromResponse(afterData as AvailabilityResponse, username1),
        'Username should still be AVAILABLE after 1 registration (99 slots remaining)',
      ).toBe('AVAILABLE')

      // --- ACT: second user registers the same base username ---
      const mnemonic2 = generateMnemonic()
      const params2 = deriveLitePersonParams(mnemonic2, username1, VERIFIER_ADDRESS)

      await transferFunds(wsEndpoint, ALICE_MNEMONIC, params2.candidateAccountId)

      const response2 = await app.api.v1.usernames.$post({
        header: {},
        json: formatParams(params2),
      })
      const data2 = await (await checkResponseWithBody(response2, 202)).json()

      expect(data2.base_username).toBe(username1)
      expect(data2.digits, 'Second user should receive different digit suffix').not.toBe(
        registrationData.digits,
      )

      await vi.waitUntil(async () => (await getStatus(app, data2.username)) === 'ASSIGNED', WAIT_CONFIG)
    })
  })
})
