import { checkResponseWithBody } from '@identity-backend/testing/hono'
import type { StartedDockerComposeEnvironment } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { setupTestEnvironment, teardownTestEnvironment } from './setup.ts'

describe.concurrent('E2E: Root Path Static Assets', () => {
  let environment: StartedDockerComposeEnvironment
  let baseUrl: string

  beforeAll(async () => {
    ;({ environment } = await setupTestEnvironment({ peopleNetwork: 'pop-testnet' }))
    const port = environment.getContainer('web-1').getMappedPort(8080)
    baseUrl = `http://localhost:${port}`
  })

  afterAll(async () => {
    await teardownTestEnvironment(environment)
  })

  describe('GET /', () => {
    it('Should_Return200WithHtmlContentType_When_RequestingRootPath', async () => {
      const response = await fetch(`${baseUrl}/`)

      await checkResponseWithBody(response, 200)
      expect(response.headers.get('content-type'), 'Must return HTML content-type').toMatch(/text\/html/)
    })
  })
})
