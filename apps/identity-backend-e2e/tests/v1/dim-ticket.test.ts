import { checkResponse } from '@identity-backend/testing/hono'
import { hc } from 'hono/client'
import type { App } from 'identity-backend-container/v1'
import type { StartedDockerComposeEnvironment } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { setupTestEnvironment, teardownTestEnvironment } from '../setup.ts'
import { generateDIMTestAddress, verifyDimTicketOnChain } from './dim-ticket.helpers.ts'

const WAIT_CONFIG = {
  timeout: 180_000,
  interval: 2_000,
}

describe.concurrent('E2E: DIM Ticket Granting', () => {
  let environment: StartedDockerComposeEnvironment
  let app: ReturnType<typeof hc<App>>
  let wsEndpoint: string

  beforeAll(async () => {
    const result = await setupTestEnvironment<App>({ peopleNetwork: 'pop-testnet' })
    ;({ environment, app } = result)
    wsEndpoint = `ws://localhost:${result.chopsticksPort}`
  })

  afterAll(async () => {
    await teardownTestEnvironment(environment)
  })

  describe('Critical User Journey: DIM Ticket Granting', () => {
    it.each([
      { dim: 'Game' as const, seed: 'game-happy-path' },
      { dim: 'ProofOfInk' as const, seed: 'proof-of-ink-happy-path' },
    ])('Should_GrantDIMTicket_When_$dim_Requested', async ({ dim, seed }) => {
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
    })
  })
})
