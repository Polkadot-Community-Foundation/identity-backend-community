import { hc } from 'hono/client'
import type { App } from 'identity-backend-container/v1'
import type { StartedDockerComposeEnvironment } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  deriveLitePersonParams,
  formatParams,
  generateMnemonic,
  getStatus,
  randomUsername,
  transferFundsBatch,
} from '../helpers.ts'

import { checkResponseWithBody } from '@identity-backend/testing/hono'
import { setupTestEnvironment, teardownTestEnvironment } from '../setup.ts'

const ALICE_MNEMONIC = 'bottom drive obey lake curtain smoke basket hold race lonely fit walk'
const VERIFIER_ADDRESS = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY'

const WAIT_CONFIG = {
  timeout: 180_000,
  interval: 2_000,
}
;(['pop-testnet'] as const).map((chain) => {
  return describe(`E2E: Concurrent Registration on ${chain}`, () => {
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

    it('Should_HandleConcurrentRegistrations_When_MultipleSimultaneousRequests', async () => {
      const registrationCount = 3
      const registrations = Array.from({ length: registrationCount }, () => ({
        mnemonic: generateMnemonic(),
        username: randomUsername(),
      }))

      const paramsArray = registrations.map(({ mnemonic, username }) =>
        deriveLitePersonParams(mnemonic, username, VERIFIER_ADDRESS)
      )

      await transferFundsBatch(
        wsEndpoint,
        ALICE_MNEMONIC,
        paramsArray.map((params) => ({ toAddress: params.candidateAccountId })),
      )

      const responses = await Promise.all(
        paramsArray.map((params) =>
          app.api.v1.usernames.$post({
            header: {},
            json: formatParams(params),
          })
        ),
      )

      const fullUsernames: string[] = []
      for (const response of responses) {
        const data =
          (await (await checkResponseWithBody(response, 202, 'Concurrent registration should be accepted')).json()) as {
            username: string
          }
        fullUsernames.push(data.username)
      }

      await Promise.all(
        fullUsernames.map((username) =>
          vi.waitUntil(async () => (await getStatus(app, username)) === 'ASSIGNED', WAIT_CONFIG)
        ),
      )

      const uniqueUsernames = new Set(fullUsernames)
      expect(uniqueUsernames.size, 'All concurrent registrations should produce unique usernames').toBe(
        registrationCount,
      )
    })
  })
})
