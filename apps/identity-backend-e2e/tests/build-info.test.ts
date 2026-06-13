import { checkResponseWithBody } from '@identity-backend/testing/hono'
import type { StartedDockerComposeEnvironment } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { setupTestEnvironment, teardownTestEnvironment } from './setup.ts'

const BUILD_INFO = {
  service: 'identity-backend',
  version: '1.2.3',
  commit: 'abc1234',
  buildTime: '2026-06-10T12:00:00Z',
  environment: 'test',
} as const

describe.concurrent('E2E: Build Info Endpoint', () => {
  let environment: StartedDockerComposeEnvironment
  let baseUrl: string

  beforeAll(async () => {
    ;({ environment } = await setupTestEnvironment({
      peopleNetwork: 'pop-testnet',
      EXPOSE_BUILD_INFO: 'true',
      APP_SERVICE: BUILD_INFO.service,
      APP_VERSION: BUILD_INFO.version,
      GIT_COMMIT: BUILD_INFO.commit,
      BUILD_TIME: BUILD_INFO.buildTime,
      DEPLOYMENT_ENVIRONMENT: BUILD_INFO.environment,
    }))
    const port = environment.getContainer('web-1').getMappedPort(8080)
    baseUrl = `http://localhost:${port}`
  })

  afterAll(async () => {
    await teardownTestEnvironment(environment)
  })

  describe('GET /api/v1/version', () => {
    it('Should_ReturnBuildIdentity_When_FlagEnabledAndVarsBaked', async () => {
      const response = await fetch(`${baseUrl}/api/v1/version`)

      await checkResponseWithBody(response, 200, 'endpoint must be reachable at the documented path')
      expect(response.headers.get('content-type'), 'must be JSON').toMatch(/application\/json/)
      expect(await response.json()).toEqual(BUILD_INFO)
    })
  })

  describe('GET /api/swagger/json', () => {
    it('Should_PublishVersionPath_When_FlagEnabled', async () => {
      const response = await fetch(`${baseUrl}/api/swagger/json`)

      const spec = await (await checkResponseWithBody(response, 200)).json() as { paths?: Record<string, unknown> }
      expect(Object.keys(spec.paths ?? {}), 'version endpoint must be discoverable in the OpenAPI spec')
        .toContain('/api/v1/version')
    })
  })
})
