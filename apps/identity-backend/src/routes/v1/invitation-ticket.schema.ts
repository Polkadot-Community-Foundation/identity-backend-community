import { z } from '@hono/zod-openapi'
import { ss58Decode } from '@polkadot-labs/hdkd-helpers'

const ss58Address = z
  .string()
  .min(1)
  .refine((addr) => {
    try {
      ss58Decode(addr)
      return true
    } catch {
      return false
    }
  }, 'Invalid SS58 address format')

export const ClaimInvitationTicketBody = z.object({
  who: ss58Address.openapi({
    example: '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty',
    description: 'SS58 address to claim ticket for',
  }),
  dim: z.enum(['Game', 'ProofOfInk']).openapi({ description: 'DIM to claim ticket for' }),
})

export const ClaimInvitationTicketResponse = z.object({
  publicKey: z.string().openapi({ description: 'Public key of the claimed ticket' }),
  inviter: z.string().openapi({ description: 'SS58 address of the inviter' }),
  dim: z.enum(['Game', 'ProofOfInk']),
  network: z.enum(['westend2', 'polkadot', 'paseo']),
  claimedBy: z.string().openapi({ description: 'SS58 address of the claimant' }),
  createdAt: z.string().datetime().openapi({ description: 'ISO timestamp of ticket creation' }),
  claimedAt: z.string().datetime().openapi({ description: 'ISO timestamp of claim' }),
  signature: z.string().openapi({ description: 'sr25519 signature of the claimant address' }),
  remaining: z.number().int().openapi({ description: 'Number of remaining tickets in pool' }),
})
