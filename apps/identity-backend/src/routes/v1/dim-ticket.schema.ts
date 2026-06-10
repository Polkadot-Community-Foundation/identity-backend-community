import { z } from '@hono/zod-openapi'

export const GetTicketParams = z.object({
  who: z
    .string()
    .min(1)
    .openapi({
      param: {
        name: 'who',
        in: 'path',
      },
      example: '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty',
      description: 'SS58 address to query ticket status',
    }),
})

export const TicketResponse = z.object({
  ticket: z.string().openapi({ description: 'SS58 address of the ticket' }),
  inviter: z.string().openapi({ description: 'SS58 address of the inviter' }),
  network: z.enum(['westend2', 'paseo', 'polkadot']),
  dim: z.enum(['Game', 'ProofOfInk']),
  status: z.enum(['PENDING', 'SUBMITTED', 'REGISTERED', 'FAILED']).openapi({ description: 'Ticket status' }),
  registered: z.boolean().openapi({
    description: 'Whether ticket is registered on-chain. Use status instead',
    deprecated: true,
  }),
  onchainData: z
    .object({
      blockIndex: z.string().optional(),
      blockNumber: z.number().optional(),
      blockHash: z.string().optional(),
      eventIndex: z.number().optional(),
    })
    .optional()
    .nullable()
    .openapi({ description: 'On-chain registration data' }),
  createdAt: z.string().datetime().openapi({ description: 'ISO timestamp of ticket creation' }),
  updatedAt: z.string().datetime().openapi({ description: 'ISO timestamp of last update' }),
})

export const DIMTicketCreateResponse = TicketResponse.omit({ onchainData: true }).extend({
  who: z.string().openapi({ description: 'SS58 address who requested the ticket' }),
})

export const RequestTicketBody = z.object({
  who: z
    .string()
    .min(1)
    .openapi({ example: '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty' }),
  dim: z.enum(['Game', 'ProofOfInk']).openapi({ description: 'DIM to request ticket for' }),
})
