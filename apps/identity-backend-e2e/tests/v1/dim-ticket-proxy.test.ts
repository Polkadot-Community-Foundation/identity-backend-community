import { checkResponse } from '@identity-backend/testing/hono'
import { hc } from 'hono/client'
import type { App } from 'identity-backend-container/v1'
import type { StartedDockerComposeEnvironment } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { getEventsAtBlock } from '../helpers.ts'
import { setupTestEnvironment, teardownTestEnvironment } from '../setup.ts'
import { generateDIMTestAddress, verifyDimTicketOnChain } from './dim-ticket.helpers.ts'

const WAIT_CONFIG = {
  timeout: 180_000,
  interval: 2_000,
}

describe('E2E: DIM Ticket Granting via Proxy Delegation', () => {
  let environment: StartedDockerComposeEnvironment
  let app: ReturnType<typeof hc<App>>
  let wsEndpoint: string

  beforeAll(async () => {
    const result = await setupTestEnvironment<App>({
      peopleNetwork: 'pop-testnet',
      PROXY_DELEGATION_ENABLED: 'true',
    })
    ;({ environment, app } = result)
    wsEndpoint = `ws://localhost:${result.chopsticksPort}`
  })

  afterAll(async () => {
    await teardownTestEnvironment(environment)
  })

  describe('Critical User Journey: DIM Ticket Granting', () => {
    it.each([
      { dim: 'Game' as const, seed: 'proxy-game-happy-path' },
      { dim: 'ProofOfInk' as const, seed: 'proxy-proof-of-ink-happy-path' },
    ])('Should_GrantDIMTicket_When_$dim', { timeout: 300_000 }, async ({ dim, seed }) => {
      const who = generateDIMTestAddress(seed)

      const response = await app.api.v1['dim-ticket'].$post({ json: { who, dim } })
      checkResponse(response, 200)

      const data = await response.json()
      expect(data).toEqual(expect.objectContaining({ ticket: who, dim, status: 'PENDING' }))

      const finalData = await vi.waitUntil(
        async () => {
          const statusResponse = await app.api.v1['dim-ticket'][':who'].$get({ param: { who } })
          if (statusResponse.status === 200) {
            const statusData = await statusResponse.json()
            if (statusData.status === 'REGISTERED') return statusData
          }
          return null
        },
        WAIT_CONFIG,
      )

      expect(finalData).toEqual(expect.objectContaining({ status: 'REGISTERED' }))

      const ticketOnChain = await verifyDimTicketOnChain(wsEndpoint, who, dim)
      expect(ticketOnChain).toBe(true)

      // Assert the transaction was submitted via Proxy.proxy (not directly)
      const blockHash = finalData.onchainData?.blockHash
      expect(blockHash, 'Registration block hash should be persisted').toBeDefined()
      const events = await getEventsAtBlock(wsEndpoint, blockHash as string)
      expect(events.length, 'Events should be decoded from the registration block').toBeGreaterThan(0)
      const hasProxyExecuted = events.some(
        (e) => e.event.type === 'Proxy' && e.event.value.type === 'ProxyExecuted',
      )
      expect(
        hasProxyExecuted,
        'Proxy.ProxyExecuted event should exist at the DIM ticket registration block',
      ).toBe(true)
    })
  })
})
