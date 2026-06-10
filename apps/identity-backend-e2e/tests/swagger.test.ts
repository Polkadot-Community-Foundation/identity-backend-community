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
    it('Should_ReturnOpenAPI31Spec_When_Authenticated', async () => {
      // --- @arrange: Basic auth credentials ---
      const auth = { username: 'swagger', password: 'swagger' }

      // --- @act: Request OpenAPI spec ---
      const response = await fetch(`${baseUrl}/api/swagger/json`, {
        headers: { Authorization: `Basic ${btoa(`${auth.username}:${auth.password}`)}` },
      })

      // --- @assert: Verify response structure ---
      expect(response.status).toBe(200)
      const spec = await response.json()

      expect(spec, 'OpenAPI spec must have version').toHaveProperty('openapi')
      expect(spec.openapi, 'Must be OpenAPI 3.1').toMatch(/^3\.1\./)
      expect(spec, 'OpenAPI spec must have info').toHaveProperty('info')
      expect(spec, 'OpenAPI spec must have paths').toHaveProperty('paths')
      expect(spec.info, 'Info must have title').toHaveProperty('title')
      expect(spec.info, 'Info must have version').toHaveProperty('version')

      const pathCount = Object.keys(spec.paths || {}).length
      expect(pathCount, 'Should have API paths defined').toBeGreaterThan(0)
    })

    it('Should_Return401_When_MissingAuth', async () => {
      // --- @act: Request without authentication ---
      const response = await fetch(`${baseUrl}/api/swagger/json`)

      // --- @assert: Must return 401 Unauthorized ---
      expect(response.status).toBe(401)
    })

    it('Should_Return401_When_InvalidAuth', async () => {
      // --- @arrange: Wrong credentials ---
      const auth = { username: 'wrong', password: 'credentials' }

      // --- @act: Request with invalid auth ---
      const response = await fetch(`${baseUrl}/api/swagger/json`, {
        headers: { Authorization: `Basic ${btoa(`${auth.username}:${auth.password}`)}` },
      })

      // --- @assert: Must return 401 Unauthorized ---
      expect(response.status).toBe(401)
    })
  })
})
