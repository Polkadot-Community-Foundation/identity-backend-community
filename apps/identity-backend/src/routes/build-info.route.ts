import { EXPOSE_BUILD_INFO } from '#root/config.js'
import { BUILD_INFO_ENVIRONMENTS, BUILD_INFO_PATH, buildInfoFromEnv } from '#root/lib/build-info.js'
import { createOpenAPIHono } from '#root/lib/problem-details.js'
import { createRoute, z } from '@hono/zod-openapi'
import { Effect } from 'effect'

const BuildInfoResponseZod = z.object({
  service: z.string().openapi({ example: 'identity-backend' }),
  version: z.string().openapi({ example: '1.9.0' }),
  commit: z.string().openapi({ example: 'abc1234' }),
  buildTime: z.string().openapi({ example: '2026-06-10T12:00:00Z' }),
  environment: z.enum(BUILD_INFO_ENVIRONMENTS).openapi({ example: 'production' }),
}).openapi('BuildInfo')

const buildInfoRoute = createRoute({
  summary: 'Get build identity',
  description: 'Returns the deployed build identity: service, version, git commit, build time, and environment.',
  method: 'get',
  path: BUILD_INFO_PATH,
  tags: ['v1'],
  responses: {
    200: {
      content: { 'application/json': { schema: BuildInfoResponseZod } },
      description: 'Build identity of the running deployment',
    },
  },
})

export const makeBuildInfoRoute = Effect.gen(function*() {
  const enabled = yield* EXPOSE_BUILD_INFO

  const app = createOpenAPIHono()

  if (!enabled) {
    return app
  }

  const buildInfo = yield* buildInfoFromEnv

  return app.openapi(buildInfoRoute, async (c) => {
    return c.json(buildInfo, 200)
  })
})
