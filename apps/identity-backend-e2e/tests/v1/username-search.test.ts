import { hc } from 'hono/client'
import type { App } from 'identity-backend-container/v1'
import type { StartedDockerComposeEnvironment } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { setupTestEnvironment, teardownTestEnvironment } from '../setup.js'
import {
  ALICE_ADDRESS,
  buildChopsticksBlock,
  deriveLitePersonParams,
  initializeVerifiableWasm,
  LITE_TEST_MNEMONIC,
  registerLiteUsernameViaApi,
  upgradeToFullPerson,
  waitForSearchPrioritization,
  waitForUsernameAssignment,
} from './username-search.helpers.js'

type TestApp = ReturnType<typeof hc<App>>
;(['pop-testnet'] as const).map((chain) => {
  return describe('Username Search', () => {
    let environment: StartedDockerComposeEnvironment
    let app: TestApp
    let chopsticksPort: number
    let wsEndpoint: string

    beforeAll(async () => {
      await initializeVerifiableWasm()
      ;({ environment, app, chopsticksPort } = await setupTestEnvironment<App>({
        peopleNetwork: chain,
        USERNAME_INDEXER_ENABLED: 'true',
        USERNAME_INDEXER_SYNC_INTERVAL_MS: '5000',
      }))
      wsEndpoint = `ws://localhost:${chopsticksPort}`
    })

    afterAll(async () => {
      await teardownTestEnvironment(environment)
    })

    it('Should_PrioritizeFullUsernameOverLite_When_InSearchResults', async () => {
      // --- @arrange: Test Identities ---
      const baseUsername = 'indexertestuser'
      const liteParams = deriveLitePersonParams(LITE_TEST_MNEMONIC, baseUsername, ALICE_ADDRESS)

      // --- @act: Register Lite Username ---
      const liteUsername = await registerLiteUsernameViaApi(app, wsEndpoint, liteParams)
      await waitForUsernameAssignment(app, liteUsername)
      await buildChopsticksBlock(wsEndpoint)

      // --- @act: Upgrade to Full Person ---
      const fullUsername = baseUsername
      await upgradeToFullPerson(wsEndpoint, liteParams, fullUsername)
      await buildChopsticksBlock(wsEndpoint)

      // --- @assert: Full Username Shadows Lite ---
      const searchPrefix = baseUsername.substring(0, 5)
      const { hasFullUsername, hasLiteUsername } = await waitForSearchPrioritization(
        app,
        searchPrefix,
        fullUsername,
        liteUsername,
      )

      expect.soft(hasFullUsername, 'Full username should appear in search results').toBe(true)
      expect.soft(hasLiteUsername, 'Lite username should be shadowed by full username').toBe(false)
    }, 150_000)
  })
})
