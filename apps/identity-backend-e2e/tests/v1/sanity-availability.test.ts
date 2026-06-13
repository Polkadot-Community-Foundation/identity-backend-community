import { checkResponseWithBody } from '@identity-backend/testing/hono'
import { hc } from 'hono/client'
import type { App } from 'identity-backend-container/v1'
import type { StartedDockerComposeEnvironment } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { setupTestEnvironment, teardownTestEnvironment } from '../setup.ts'

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
  return describe(`E2E: Username Availability Validation on ${chain}`, () => {
    let environment: StartedDockerComposeEnvironment
    let app: ReturnType<typeof hc<App>>

    beforeAll(async () => {
      ;({ environment, app } = await setupTestEnvironment<App>({ peopleNetwork: chain }))
    })

    afterAll(async () => {
      await teardownTestEnvironment(environment)
    })

    it('Should_RejectInvalidUsernameFormats_When_CheckedViaAvailabilityApi', async () => {
      const invalidUsernames = ['abc', 'ABC123', 'user123']

      const response = await app.api.v1.usernames.available.$post({
        query: {},
        json: { usernames: invalidUsernames },
      })
      const data = await (await checkResponseWithBody(response, 200)).json()
      for (const username of invalidUsernames) {
        const status = getStatusFromResponse(data as AvailabilityResponse, username)
        expect(status as AvailabilityStatus, `'${username}' should be INVALID`).toBe('INVALID')
      }
    })
  })
})
