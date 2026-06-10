import { z } from '@hono/zod-openapi'

export const SearchUsernameDTO = z.object({
  accountId: z.string()
    .openapi({
      description: 'The SS58 address of the account that owns this username.',
      examples: ['5FbRAkhDvVecNzHLFxBNXFXNwvBaV69S1W3nfBbnxYypkkT'],
    }),
  username: z.string()
    .openapi({
      description: 'The username (full like "alice" or lite like "alice.42")',
      examples: ['alice', 'alice.42'],
    }),
  status: z
    .enum(['RESERVED', 'ASSIGNED', 'FAILED'])
    .openapi({
      description:
        'Registration state from individuality_usernames.status. ASSIGNED = on-chain; RESERVED = pending; FAILED = error.',
      examples: ['RESERVED', 'ASSIGNED', 'FAILED'],
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
}).openapi({
  title: 'SearchUsernameDTO',
})

export const SearchUsernamesV1QuerySchema = z.object({
  prefix: z.string()
    .min(1, 'Prefix is required')
    .max(64, 'Prefix must be at most 64 characters')
    .regex(
      /^[a-zA-Z0-9]+(\.\d*)?$/,
      'Prefix must be letters/digits, optionally followed by a dot and digits (e.g. "alice", "alice.", "alice.10")',
    )
    .openapi({
      description:
        'The prefix to search for usernames. Search is case-insensitive. A prefix containing "." restricts results to lite usernames (e.g. "alice." matches "alice.10" but not the full username "alice").',
      examples: ['alice', 'alice.', 'alice.10'],
    }),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .transform((val) => Math.min(val, 1000))
    .optional()
    .openapi({
      description: 'Maximum number of results to return (default: 100, max: 1000)',
      examples: [100],
    }),
  cursor: z.string()
    .optional()
    .openapi({
      description: 'Base64-encoded JSON cursor for pagination',
      examples: ['eyJ1c2VybmFtZSI6ImFsaWNlIiwiZGlnaXRzIjoiMTEifQ=='],
    }),
  includeOnchainData: z.coerce
    .boolean()
    .optional()
    .openapi({
      description: 'Whether to include onchain data in the response (default: false)',
      examples: [false],
    }),
})

export const SearchUsernamesV1ResponseSchema = z.object({
  usernames: z.array(SearchUsernameDTO)
    .openapi({
      description: 'List of usernames matching the search criteria',
    }),
  nextCursor: z.string().nullable()
    .openapi({
      description: 'Cursor for the next page of results, or null if no more results',
      examples: [null, 'eyJ1c2VybmFtZSI6ImJvYiIsImRpZ2l0cyI6IjEyIn0='],
    }),
})
