import { z } from '@hono/zod-openapi'

const HEX_64_PATTERN = /^(0x)?[a-fA-F0-9]{64}$/

const normalizeHex = (val: string): string => val.startsWith('0x') ? val.toLowerCase() : `0x${val.toLowerCase()}`

export const Hex64String = z.string()
  .regex(HEX_64_PATTERN, 'Must be a valid 64-char hex string')
  .transform(normalizeHex)

export const NotificationTypeZod = z.enum(['apns', 'voip', 'fcm', 'web']).openapi({
  description: 'Notification delivery type.',
  examples: ['apns', 'voip', 'fcm', 'web'],
})
export type NotificationTypeZod = z.infer<typeof NotificationTypeZod>

const MobileTokenStringZod = z.string().min(1).max(4096)

const ContentEncodingZod = z.enum(['aes128gcm', 'aesgcm'])

const WebPushKeysZod = z.object({
  p256dh: z.string().min(1).max(1024),
  auth: z.string().min(1).max(512),
})

const WebPushSubscriptionRequestZod = z.object({
  notificationType: z.literal('web'),
  endpoint: z.string().url().max(4096).refine(
    (url) => url.startsWith('https://'),
    { message: 'Web push endpoint must be an HTTPS URL' },
  ),
  keys: WebPushKeysZod,
  contentEncoding: ContentEncodingZod.default('aes128gcm'),
})

const MobileSubscriptionRequestZod = z.object({
  notificationType: z.enum(['apns', 'voip', 'fcm']),
  token: MobileTokenStringZod,
})

const WebPushTokenResponseZod = z.object({
  endpoint: z.string(),
  keys: WebPushKeysZod,
  contentEncoding: ContentEncodingZod,
})

export const RuleSchema = z.object({
  senderPubkey: Hex64String.openapi({
    description: 'Sender public key as a 64-character hex string. 0x prefix is optional and will be normalized.',
    examples: [
      '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    ],
  }),
  topic: Hex64String.openapi({
    description: 'Topic hash as a 64-character hex string. 0x prefix is optional and will be normalized.',
    examples: [
      '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
    ],
  }),
})

// Discriminator on notificationType picks the correct shape; the variant guarantees
// either `token` (mobile) or `endpoint`+`keys` (web) — never a mix or both.
export const CreateSubscriptionRequestZod = z
  .discriminatedUnion('notificationType', [MobileSubscriptionRequestZod, WebPushSubscriptionRequestZod])
  .openapi({ title: 'CreateSubscriptionRequest' })

export type CreateSubscriptionRequestZodType = z.infer<typeof CreateSubscriptionRequestZod>

export const DeleteSubscriptionsRequestZod = z
  .object({
    subscription_ids: z.array(z.string().uuid()).min(1).openapi({
      description: 'Array of subscription UUIDs to delete.',
      example: ['550e8400-e29b-41d4-a716-446655440000'],
    }),
  })
  .openapi({ title: 'DeleteSubscriptionsRequest' })

export type DeleteSubscriptionsRequestZodType = z.infer<typeof DeleteSubscriptionsRequestZod>

export const SubscriptionIdZod = z.string().uuid().openapi({
  description: 'Subscription UUID.',
  example: '550e8400-e29b-41d4-a716-446655440000',
})

export const RulesBodySchema = z.object({
  subscription_id: SubscriptionIdZod.openapi({
    description: 'The subscription to operate on.',
    example: '550e8400-e29b-41d4-a716-446655440001',
  }),
  rules: z.array(RuleSchema).min(1).openapi({
    description: 'Array of rules.',
  }),
}).openapi({ title: 'RulesBody' })

export type RulesBodyZodType = z.infer<typeof RulesBodySchema>

export const AddRulesRequestZod = RulesBodySchema.openapi({ title: 'AddRulesRequest' })
export type AddRulesRequestZodType = z.infer<typeof AddRulesRequestZod>

export const DeleteRulesRequestZod = RulesBodySchema.openapi({ title: 'DeleteRulesRequest' })
export type DeleteRulesRequestZodType = z.infer<typeof DeleteRulesRequestZod>

export const ReplaceRulesRequestZod = RulesBodySchema.openapi({ title: 'ReplaceRulesRequest' })
export type ReplaceRulesRequestZodType = z.infer<typeof ReplaceRulesRequestZod>

export const RuleResponseSchema = z.object({
  id: z.string().uuid().openapi({
    description: 'Unique rule identifier.',
    example: '550e8400-e29b-41d4-a716-446655440000',
  }),
  subscriptionId: z.string().uuid().openapi({
    description: 'Parent subscription identifier.',
    example: '550e8400-e29b-41d4-a716-446655440001',
  }),
  senderPubkey: z.string().openapi({
    description: 'Normalized sender public key (always with 0x prefix).',
    example: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
  }),
  topic: z.string().openapi({
    description: 'Normalized topic hash (always with 0x prefix).',
    example: '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
  }),
  createdAt: z.string().openapi({
    description: 'ISO 8601 timestamp when the rule was created.',
    example: '2024-01-15T09:30:00.000Z',
  }),
})

export const SubscriptionResponseZod = z.object({
  id: z.string().uuid().openapi({
    description: 'Unique subscription identifier.',
    example: '550e8400-e29b-41d4-a716-446655440000',
  }),
  notificationType: NotificationTypeZod.openapi({
    description: 'The notification channel for this subscription.',
    examples: ['apns', 'voip', 'fcm', 'web'],
  }),
  token: z.union([z.string(), WebPushTokenResponseZod]).nullable().openapi({
    description:
      'Mobile channels: opaque device token string. Web channel: { endpoint, keys, contentEncoding }. Null when the token has been invalidated by the upstream push service.',
  }),
  token_type: z.enum(['mobile', 'web']).nullable().openapi({
    description:
      'Discriminator for the token field: "mobile" for push tokens, "web" for Web Push subscription data, null if token has been invalidated.',
    example: 'mobile',
  }),
  rules: z.array(RuleResponseSchema).openapi({
    description: 'Active notification rules for this subscription.',
  }),
  createdAt: z.string().openapi({
    description: 'ISO 8601 timestamp when the subscription was created.',
    example: '2024-01-15T09:30:00.000Z',
  }),
  updatedAt: z.string().openapi({
    description: 'ISO 8601 timestamp when the subscription was last updated.',
    example: '2024-01-15T09:30:00.000Z',
  }),
}).openapi({ title: 'SubscriptionResponse' })

export type SubscriptionResponseZodType = z.infer<typeof SubscriptionResponseZod>

export const BroadcastContentZod = z.object({
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(512),
  deeplink: z.string().min(1).max(2048).optional(),
})

export const BroadcastRequestZod = z.object({
  signer: Hex64String,
  topics: z.array(Hex64String).min(1).max(100),
  content: BroadcastContentZod,
}).openapi({ title: 'BroadcastRequest' })
export type BroadcastRequestZodType = z.infer<typeof BroadcastRequestZod>

export const BroadcastResponseZod = z.object({
  message_hash: z.string(),
  delivered: z.number(),
}).openapi({ title: 'BroadcastResponse' })

export const VapidPublicKeyResponseZod = z.object({
  vapid_public_key: z.string().openapi({
    description: 'Base64url-encoded VAPID public key for the host to pass to PushManager.subscribe.',
  }),
  subject: z.string().openapi({
    description: 'VAPID subject sent with each push (typically a mailto: or https: URL).',
  }),
}).openapi({ title: 'VapidPublicKeyResponse' })

export const RulesOperationResponseZod = z.object({
  added: z.number().optional().openapi({
    description: 'Number of rules added (for add operations).',
    example: 3,
  }),
  removed: z.number().optional().openapi({
    description: 'Number of rules removed (for delete operations).',
    example: 2,
  }),
  replaced: z.number().optional().openapi({
    description: 'Number of rules replaced (for replace operations).',
    example: 5,
  }),
  total: z.number().openapi({
    description: 'Total number of rules after the operation.',
    example: 7,
  }),
}).openapi({ title: 'RulesOperationResponse' })

export type RulesOperationResponseZodType = z.infer<typeof RulesOperationResponseZod>
