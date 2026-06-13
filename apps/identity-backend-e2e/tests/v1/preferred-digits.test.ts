import { pop_testnet } from '@identity-backend/descriptors'
import { checkResponseWithBody } from '@identity-backend/testing/hono'
import { hc } from 'hono/client'
import type { App } from 'identity-backend-container/v1'
import { Binary, createClient } from 'polkadot-api'
import { getWsProvider } from 'polkadot-api/ws'
import type { StartedDockerComposeEnvironment } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  deriveLitePersonParams,
  formatParams,
  generateMnemonic,
  getStatus,
  randomUsername,
  transferFunds,
  transferFundsBatch,
} from '../helpers.ts'
import { setupTestEnvironment, teardownTestEnvironment } from '../setup.ts'

type V0Response = Record<string, 'AVAILABLE' | 'EXHAUSTED' | 'INVALID'>
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
): 'AVAILABLE' | 'EXHAUSTED' | 'INVALID' | undefined {
  const v1 = data as V1Response
  if (v1._tag === 'v1') {
    return v1.value[username]?.status
  }
  return (data as V0Response)[username]
}

// #region Constants
const ALICE_MNEMONIC = 'bottom drive obey lake curtain smoke basket hold race lonely fit walk'
const VERIFIER_ADDRESS = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY'

const WAIT_CONFIG = {
  timeout: 180_000, // Max time to wait for blockchain finalization
  interval: 2_000, // Polling interval for status checks
} //
 // #endregion Constants

// #region Tests
;(['pop-testnet'] as const).map((chain) => {
  return describe.concurrent(`Username Registration with Preferred Digits on ${chain}`, () => {
    let environment: StartedDockerComposeEnvironment
    let app: ReturnType<typeof hc<App>>
    let chopsticksPort: number
    let wsEndpoint: string

    beforeAll(async () => {
      ;({ environment, app, chopsticksPort } = await setupTestEnvironment<App>({ peopleNetwork: chain }))
      wsEndpoint = `ws://localhost:${chopsticksPort}`
    })

    afterAll(async () => {
      // Cleanup: destroy containers to ensure test isolation
      await teardownTestEnvironment(environment)
    })

    it('Should_RegisterUsername_When_PreferredDigitsAvailable', async () => {
      // ARRANGE: Generate unique test data using Factory pattern
      const mnemonic = generateMnemonic()
      const username = randomUsername()
      const params = deriveLitePersonParams(mnemonic, username, VERIFIER_ADDRESS)

      // Fund the candidate account (prerequisite for blockchain transaction)
      await transferFunds(wsEndpoint, ALICE_MNEMONIC, params.candidateAccountId)

      // ACT & ASSERT Phase 1: Verify username availability (Pre-condition)
      const availabilityResponse = await app.api.v1.usernames.available.$post({
        query: {},
        json: { usernames: [username] },
      })
      const availabilityData = await (await checkResponseWithBody(availabilityResponse, 200)).json()
      expect(
        getStatusFromResponse(availabilityData, username),
        'Pre-condition: Username should be available before registration',
      ).toBe('AVAILABLE')

      // ACT & ASSERT Phase 2: Submit registration request with preferred digits
      const registrationResponse = await app.api.v1.usernames.$post({
        header: {},
        json: {
          ...formatParams(params),
          preferredDigits: '42',
        },
      })
      const registrationData = await (await checkResponseWithBody(registrationResponse, 202)).json()
      const fullUsername = registrationData.username

      expect(registrationData).toMatchObject({
        base_username: username,
        digits: '42',
        username: `${username}.42`,
      })

      // ACT & ASSERT Phase 3: Wait for ASSIGNED status (Explicit Wait)
      // Using explicit waits instead of hard-coded sleeps per flakiness guidelines
      const finalData = await vi.waitUntil(
        async () => {
          const status = await getStatus(app, fullUsername)
          if (status === 'ASSIGNED') {
            const response = await app.api.v1.usernames[':username'].$get({
              param: { username: fullUsername },
            })
            return await (await checkResponseWithBody(response, 200)).json()
          }
          return null
        },
        WAIT_CONFIG,
      )

      expect(finalData.status, 'Registration should reach ASSIGNED status').toBe('ASSIGNED')
      expect(finalData.candidateAccountId).toBe(params.candidateAccountId)
      expect(finalData.onchainData, 'On-chain data should be populated after assignment').not.toBeNull()

      // ACT & ASSERT Phase 4: Verify on-chain state (System Integration)
      // This verifies the full system integration including blockchain
      const client = createClient(getWsProvider(wsEndpoint, { heartbeatTimeout: 60_000 }))
      const api = client.getTypedApi(pop_testnet)

      try {
        // Verify PeopleLite storage entry
        const litePeopleEntry = await api.query.PeopleLite.LitePeople.getValue(params.candidateAccountId)
        expect(litePeopleEntry, 'Blockchain should contain LitePeople entry').not.toBeNull()

        // Verify username ownership mapping
        const usernameBinary = Binary.fromText(fullUsername)
        const usernameOwner = await api.query.Resources.UsernameOwnerOf.getValue(usernameBinary)
        expect(usernameOwner, 'Blockchain should map username to owner').toBe(params.candidateAccountId)
      } finally {
        client.destroy()
      }
    })

    it('Should_AssignBothUsernames_When_ConcurrentRegistrationsUseDifferentDigits', async () => {
      // ARRANGE: Generate shared base username with 2 different users
      const baseUsername = randomUsername()
      const user1Mnemonic = generateMnemonic()
      const user2Mnemonic = generateMnemonic()

      const user1Params = deriveLitePersonParams(user1Mnemonic, baseUsername, VERIFIER_ADDRESS)
      const user2Params = deriveLitePersonParams(user2Mnemonic, baseUsername, VERIFIER_ADDRESS)

      // Fund both accounts in a single batched transaction
      await transferFundsBatch(wsEndpoint, ALICE_MNEMONIC, [
        { toAddress: user1Params.candidateAccountId },
        { toAddress: user2Params.candidateAccountId },
      ])

      // ACT: Submit both registrations concurrently with different preferred digits
      const [reg1Response, reg2Response] = await Promise.all([
        app.api.v1.usernames.$post({
          header: {},
          json: {
            ...formatParams(user1Params),
            preferredDigits: '42',
          },
        }),
        app.api.v1.usernames.$post({
          header: {},
          json: {
            ...formatParams(user2Params),
            preferredDigits: '99',
          },
        }),
      ])

      // ASSERT: Both registrations should be accepted with correct digits
      const reg1Data = await (await checkResponseWithBody(reg1Response, 202, 'User1 registration should be accepted'))
        .json()
      const reg2Data = await (await checkResponseWithBody(reg2Response, 202, 'User2 registration should be accepted'))
        .json()

      expect(reg1Data).toMatchObject({
        base_username: baseUsername,
        digits: '42',
        username: `${baseUsername}.42`,
      })
      expect(reg2Data).toMatchObject({
        base_username: baseUsername,
        digits: '99',
        username: `${baseUsername}.99`,
      })

      // ACT & ASSERT: Wait for both registrations to reach ASSIGNED status
      // Use parallel vi.waitUntil for concurrent execution
      await Promise.all([
        vi.waitUntil(async () => (await getStatus(app, reg1Data.username)) === 'ASSIGNED', WAIT_CONFIG),
        vi.waitUntil(async () => (await getStatus(app, reg2Data.username)) === 'ASSIGNED', WAIT_CONFIG),
      ])

      // ACT & ASSERT: Verify on-chain state for both users
      const client = createClient(getWsProvider(wsEndpoint, { heartbeatTimeout: 60_000 }))
      const api = client.getTypedApi(pop_testnet)

      try {
        // Verify User1 on-chain state
        const user1LiteEntry = await api.query.PeopleLite.LitePeople.getValue(user1Params.candidateAccountId)
        expect(user1LiteEntry, 'User1 blockchain should contain LitePeople entry').not.toBeNull()

        const user1UsernameBinary = Binary.fromText(reg1Data.username)
        const user1UsernameOwner = await api.query.Resources.UsernameOwnerOf.getValue(user1UsernameBinary)
        expect(user1UsernameOwner, 'User1 blockchain should map username to owner').toBe(
          user1Params.candidateAccountId,
        )

        // Verify User2 on-chain state
        const user2LiteEntry = await api.query.PeopleLite.LitePeople.getValue(user2Params.candidateAccountId)
        expect(user2LiteEntry, 'User2 blockchain should contain LitePeople entry').not.toBeNull()

        const user2UsernameBinary = Binary.fromText(reg2Data.username)
        const user2UsernameOwner = await api.query.Resources.UsernameOwnerOf.getValue(user2UsernameBinary)
        expect(user2UsernameOwner, 'User2 blockchain should map username to owner').toBe(
          user2Params.candidateAccountId,
        )
      } finally {
        client.destroy()
      }
    })

    it('Should_RejectOneRegistration_When_ConcurrentRegistrationsUseSameDigits', async () => {
      // ----------------------------------------------------------------
      // ARRANGE: Two users want the same base username with same preferred digits
      // ----------------------------------------------------------------
      const sharedBaseUsername = randomUsername()
      const preferredDigits = '42'

      const user1 = {
        mnemonic: generateMnemonic(),
        params: null as ReturnType<typeof deriveLitePersonParams> | null,
      }
      const user2 = {
        mnemonic: generateMnemonic(),
        params: null as ReturnType<typeof deriveLitePersonParams> | null,
      }

      user1.params = deriveLitePersonParams(user1.mnemonic, sharedBaseUsername, VERIFIER_ADDRESS)
      user2.params = deriveLitePersonParams(user2.mnemonic, sharedBaseUsername, VERIFIER_ADDRESS)

      // Fund both accounts in a single batched transaction
      await transferFundsBatch(wsEndpoint, ALICE_MNEMONIC, [
        { toAddress: user1.params.candidateAccountId },
        { toAddress: user2.params.candidateAccountId },
      ])

      // ----------------------------------------------------------------
      // ACT: Race both registrations concurrently with same preferred digits
      // ----------------------------------------------------------------
      const [response1, response2] = await Promise.all([
        app.api.v1.usernames.$post({
          header: {},
          json: {
            ...formatParams(user1.params),
            preferredDigits,
          },
        }),
        app.api.v1.usernames.$post({
          header: {},
          json: {
            ...formatParams(user2.params),
            preferredDigits,
          },
        }),
      ])

      // ----------------------------------------------------------------
      // ASSERT: One must win (202) and one must lose (409)
      // ----------------------------------------------------------------
      const statuses = [response1.status, response2.status].sort((a, b) => a - b)
      expect(statuses, 'One registration should succeed (202) and one should fail (409)').toEqual([202, 409])
    })
  })
})
// #endregion Tests
