import { createOpenAPIHono } from '#root/lib/problem-details.js'
import { createRoute, z } from '@hono/zod-openapi'
import { StatementApnsPayloadWire, StatementFcmPayloadWire } from '@identity-backend/mobile-push-notifications'
import { VerifiedStatement } from '@identity-backend/statement-store/live'
import { Effect, JSONSchema } from 'effect'

const JsonSchemaDocument = z.any()

const statementSchemaDocument = JSONSchema.make(VerifiedStatement)
const iosPushPayloadSchemaDocument = JSONSchema.make(StatementApnsPayloadWire)
const androidPushPayloadSchemaDocument = JSONSchema.make(StatementFcmPayloadWire)

const statementSchemaRoute = createRoute({
  method: 'get',
  path: '/statement',
  tags: ['v1'],
  summary: 'Get statement payload JSON Schema',
  description: 'Authoritative schema for verified statements parsed from the statement store stream.',
  responses: {
    200: {
      description: 'JSON Schema document',
      content: {
        'application/schema+json': { schema: JsonSchemaDocument },
        'application/json': { schema: JsonSchemaDocument },
      },
    },
  },
})

const iosPushPayloadSchemaRoute = createRoute({
  method: 'get',
  path: '/push-payload/ios',
  tags: ['v1'],
  summary: 'Get iOS push payload JSON Schema',
  description:
    'Authoritative schema for custom keys in the APNs notification payload (`statement`, etc.) as sent on the wire.',
  responses: {
    200: {
      description: 'JSON Schema document',
      content: {
        'application/schema+json': { schema: JsonSchemaDocument },
        'application/json': { schema: JsonSchemaDocument },
      },
    },
  },
})

const androidPushPayloadSchemaRoute = createRoute({
  method: 'get',
  path: '/push-payload/android',
  tags: ['v1'],
  summary: 'Get Android push payload JSON Schema',
  description: 'Authoritative schema for FCM `data` fields for statement pushes as sent on the wire;',
  responses: {
    200: {
      description: 'JSON Schema document',
      content: {
        'application/schema+json': { schema: JsonSchemaDocument },
        'application/json': { schema: JsonSchemaDocument },
      },
    },
  },
})

export const makeSchemaRoute = Effect.fn('v1.make_schema_route')(() =>
  Effect.succeed(
    createOpenAPIHono()
      .openapi(statementSchemaRoute, (c) => {
        c.header('Content-Type', 'application/schema+json')
        return c.json(statementSchemaDocument, 200)
      })
      .openapi(iosPushPayloadSchemaRoute, (c) => {
        c.header('Content-Type', 'application/schema+json')
        return c.json(iosPushPayloadSchemaDocument, 200)
      })
      .openapi(androidPushPayloadSchemaRoute, (c) => {
        c.header('Content-Type', 'application/schema+json')
        return c.json(androidPushPayloadSchemaDocument, 200)
      }),
  )
)
