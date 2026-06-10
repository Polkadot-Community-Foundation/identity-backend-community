import { HEX_STRING_REGEXP } from '#root/constants.js'
import { z } from '@hono/zod-openapi'
import { Schema as S } from 'effect'

// Device token validation patterns
const DeviceTokenPattern = /^[a-zA-Z0-9_\-+/=:]{64,326}$/
const PushIdPattern = /^[0-9a-fA-F]{32}$|^[0-9a-fA-F]{64}$/

// Push notification request schema
export const PushSendRequest = z.object({
  deviceToken: z.string()
    .regex(DeviceTokenPattern, 'Must be a valid device token')
    .openapi({
      description: 'Base64 string with colon separator between 64 and 326 characters',
      examples: [
        '123e4567e89b12d3a456426655440000123e4567e89b12d3a456426655440000',
        'dGhpc2lzYXZlcnlsb25nZmlyZWJhc2VjbG91ZG1lc3NhZ2luZ3Rva2VuZXhhbXBsZQ',
      ],
    }),
  pushId: z.string()
    .regex(PushIdPattern, 'Must be a 32 or 64 character hexadecimal hash')
    .openapi({
      description: 'Hash string: either 32 or 64 hexadecimal characters',
      examples: [
        '5d41402abc4b2a76b9719d911017c592',
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      ],
    }),
  platform: z.enum(['ios', 'android']).optional().openapi({
    description: 'Platform (optional, will be auto-detected if not provided)',
  }),
  bundlerId: z.string().optional().openapi({
    description: 'Bundle identifier (optional, overrides configured APN topics for iOS)',
    examples: ['com.example.app'],
  }),
  message: z.string()
    .regex(HEX_STRING_REGEXP, 'Must be a valid hexadecimal string')
    .openapi({
      description: 'Hex-encoded message to send',
      examples: ['0x1234567890abcdef', '1234567890abcdef'],
    }),
  voip: z.boolean()
    .optional()
    .openapi({
      description: 'Enable VoIP push type for voice calling.',
      examples: [true, false],
    }),
}).openapi({
  title: 'PushSendRequest',
})

// Push notification response schema
export const PushSendResponse = z.object({
  success: z.boolean().openapi({
    description: 'Whether the push notification was sent successfully',
  }),
  platform: z.enum(['ios', 'android']).openapi({
    description: 'Platform the notification was sent to',
  }),
  sent: z.number().optional().openapi({
    description: 'Number of notifications sent',
  }),
  failed: z.number().optional().openapi({
    description: 'Number of failed notifications',
  }),
  messageId: z.string().optional().openapi({
    description: 'Message ID from the push service',
  }),
  errors: z.array(z.object({
    device: z.string(),
    environment: z.enum(['development', 'production']).optional(),
    status: z.union([z.string(), z.number()]).optional(),
    response: z.unknown().optional(),
  })).optional().openapi({
    description: 'Array of errors if any occurred',
  }),
}).openapi({
  title: 'PushSendResponse',
})

// Effect Schema
const DeviceTokenSchema = S.String.pipe(
  S.pattern(DeviceTokenPattern),
  S.annotations({
    title: 'Device Token',
    description: 'Base64 string with colon separator between 64 and 326 characters',
    examples: [
      '123e4567e89b12d3a456426655440000123e4567e89b12d3a456426655440000',
      'dGhpc2lzYXZlcnlsb25nZmlyZWJhc2VjbG91ZG1lc3NhZ2luZ3Rva2VuZXhhbXBsZQ',
    ],
  }),
)

const PushIdSchema = S.String.pipe(
  S.pattern(PushIdPattern),
  S.annotations({
    title: 'Push ID',
    description: 'Hash string: either 32 or 64 hexadecimal characters',
    examples: [
      '5d41402abc4b2a76b9719d911017c592',
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    ],
  }),
)

const MessageSchema = S.String.pipe(
  S.pattern(HEX_STRING_REGEXP),
  S.annotations({
    title: 'Message',
    description: 'Hex-encoded message to send',
    examples: ['0x1234567890abcdef'],
  }),
)
export class PushSendRequestClass extends S.Class<PushSendRequestClass>('PushSendRequest')({
  deviceToken: DeviceTokenSchema,
  pushId: PushIdSchema,
  platform: S.optional(S.Literal('ios', 'android')),
  bundlerId: S.optional(S.String),
  message: MessageSchema,
  voip: S.optional(S.Boolean),
}) {}

export class PushSendResponseClass extends S.Class<PushSendResponseClass>('PushSendResponse')({
  success: S.Boolean,
  platform: S.Literal('ios', 'android'),
  sent: S.optional(S.Number),
  failed: S.optional(S.Number),
  messageId: S.optional(S.String),
  errors: S.optional(
    S.Array(
      S.Struct({
        device: S.String,
        environment: S.optional(S.Literal('development', 'production')),
        status: S.optional(S.Union(S.String, S.Number)),
        response: S.optional(S.Unknown),
      }),
    ),
  ),
}) {}
