import { z } from '@hono/zod-openapi'

export const UsernameSchema = (usernameRegexp: RegExp) =>
  z.object({
    who: z.string()
      .openapi({
        description: 'The SS58 address of the user who registered this username.',
        examples: ['5FbRAkhDvNVecNzHLFxBNXFXNwvBaV69S1W3nfBbnxYypkkT'],
      }),
    username: z.string()
      .regex(usernameRegexp)
      .openapi({
        examples: ['alice.dot'],
      }),
    registered: z.boolean()
      .openapi({
        description: 'Whether the username is registered on-chain.',
        examples: [true],
      }),
    onchainData: z.nullable(z.object({
      blockHash: z.string()
        .openapi({
          description: 'The block hash at which we tried to register the username.',
          examples: [
            '0x44714605ccc6560af3d0c3e74543a3a6f77a6ae9e2d6c902aa27eb800a3b51a0',
          ],
        }),
      blockNumber: z.number()
        .openapi({
          description: 'The block number at which we tried to register the username.',
          examples: [2487964],
        }),
      blockIndex: z.number()
        .openapi({
          description: 'The index in the block at which we tried to register the username.',
          examples: [2],
        }),
      eventIndex: z.number()
        .optional()
        .openapi({
          description:
            'The event index in the `force_batch` call for which we tried to register the username as denoted by `utility.ItemCompleted` or `utility.ItemFailed`.',
          examples: [2],
        }),
    })),
    createdAt: z.date()
      .openapi({
        description: 'The timestamp when the username was first registered in the database.',
        examples: [new Date().toISOString()],
      }),
    updatedAt: z.nullable(
      z.date()
        .openapi({
          description: 'The timestamp when the username information was last updated in the database.',
          examples: [new Date().toISOString()],
        }),
    ),
  })
