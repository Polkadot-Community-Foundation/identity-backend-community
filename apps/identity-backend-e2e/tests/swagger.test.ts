import { checkResponseWithBody } from '@identity-backend/testing/hono'
import type { StartedDockerComposeEnvironment } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { setupTestEnvironment, teardownTestEnvironment } from './setup.ts'

describe.concurrent('E2E: Swagger OpenAPI Endpoint', () => {
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

  describe('GET /api/swagger/json', () => {
    it('Should_ReturnOpenAPI31Spec_When_Requested', async () => {
      // --- @act: Request OpenAPI spec (public — no auth; the schema is open source) ---
      const response = await fetch(`${baseUrl}/api/swagger/json`)

      // --- @assert: Verify response structure ---
      const spec = await (await checkResponseWithBody(response, 200)).json()

      expect(spec, 'OpenAPI spec must have version').toHaveProperty('openapi')
      expect(spec.openapi, 'Must be OpenAPI 3.1').toMatch(/^3\.1\./)
      expect(spec, 'OpenAPI spec must have info').toHaveProperty('info')
      expect(spec, 'OpenAPI spec must have paths').toHaveProperty('paths')
      expect(spec.info, 'Info must have title').toHaveProperty('title')
      expect(spec.info, 'Info must have version').toHaveProperty('version')

      const pathCount = Object.keys(spec.paths || {}).length
      expect(pathCount, 'Should have API paths defined').toBeGreaterThan(0)
    })
  })
})
