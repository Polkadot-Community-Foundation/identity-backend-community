import { z } from '@hono/zod-openapi'

export const CheckUsernameAvailabilityV1Request = z.object({
  usernames: z.readonly(z.array(z.string())).openapi({
    description: 'Base usernames to check. Do not include digit suffixes (e.g. `"alice"`, not `"alice.42"`).',
  }),
}).openapi({
  title: 'CheckUsernameAvailabilityV1Request',
  examples: [{
    usernames: ['alice', 'bobsmith', 'invalid123', 'x'],
  }],
})

export type CheckUsernameAvailabilityV1Request = z.output<typeof CheckUsernameAvailabilityV1Request>

export const CheckUsernameAvailabilityVersionQuery = z.object({
  version: z.enum(['v0', 'v1']).optional().default('v0').openapi({
    description: '`v0` returns status only, `v1` includes available digit suffixes.',
    example: 'v1',
  }),
})

export type CheckUsernameAvailabilityVersionQuery = z.output<typeof CheckUsernameAvailabilityVersionQuery>

const V1StatusResponse = z.union([
  z.object({
    status: z.literal('INVALID'),
  }),
  z.object({
    status: z.literal('EXHAUSTED'),
  }),
  z.object({
    status: z.literal('AVAILABLE'),
    availableDigits: z.array(z.number().int().min(1).max(99)).openapi({
      description: 'Registerable digit suffixes (1–99), sorted ascending.',
      example: [1, 2, 42, 99],
    }),
  }),
])

export const CheckUsernameAvailabilityV0Response = z.record(
  z.string(),
  z.union([
    z.literal('INVALID'),
    z.literal('EXHAUSTED'),
    z.literal('AVAILABLE'),
  ]),
).openapi({
  title: 'CheckUsernameAvailabilityV0Response',
  description: 'Map of username → availability status.',
  examples: [
    {
      alice: 'AVAILABLE',
      bobsmith: 'EXHAUSTED',
      invalid123: 'INVALID',
    },
  ],
})

export type CheckUsernameAvailabilityV0Response = z.output<typeof CheckUsernameAvailabilityV0Response>

export const CheckUsernameAvailabilityV1Response = z.object({
  _tag: z.literal('v1'),
  value: z.record(z.string(), V1StatusResponse),
}).openapi({
  title: 'CheckUsernameAvailabilityV1Response',
  description: 'Map of username → availability status. `AVAILABLE` entries include `availableDigits`.',
  examples: [
    {
      _tag: 'v1',
      value: {
        alice: { status: 'AVAILABLE', availableDigits: [1, 2, 3, 42] },
        bobsmith: { status: 'EXHAUSTED' },
        invalid123: { status: 'INVALID' },
      },
    },
  ],
})

export type CheckUsernameAvailabilityV1Response = z.output<typeof CheckUsernameAvailabilityV1Response>

export const CheckUsernameAvailabilityResponse = z.union([
  CheckUsernameAvailabilityV0Response,
  CheckUsernameAvailabilityV1Response,
])

export type CheckUsernameAvailabilityResponse = z.output<typeof CheckUsernameAvailabilityResponse>
