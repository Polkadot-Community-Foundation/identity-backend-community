import { DB } from '#root/db/drizzle.js'
import * as schema from '#root/db/schema.js'
import { encodeBase64 } from '@std/encoding'
import { and, count, eq } from 'drizzle-orm'
import { Effect } from 'effect'
import { DIM_GAME, MOCK_INVITER, NETWORK_WESTEND2 } from './constants.js'
import { generateTestTicket } from './factories.js'

export type TicketOverrides = Partial<typeof schema.invitationTickets.$inferInsert>

export const insertAvailableTicket = (
  db: DB['Type'],
  overrides: Partial<Omit<typeof schema.invitationTickets.$inferInsert, 'publicKey'>> & { publicKey: Uint8Array },
  keypairOverrides?: { privateKey: Uint8Array },
) =>
  Effect.gen(function*() {
    if (!keypairOverrides) {
      const { privateKey } = yield* generateTestTicket
      keypairOverrides = { privateKey }
    }
    yield* Effect.tryPromise(() =>
      db.insert(schema.invitationTickets).values({
        privateKey: encodeBase64(keypairOverrides!.privateKey),
        dim: DIM_GAME,
        network: NETWORK_WESTEND2,
        inviter: MOCK_INVITER,
        state: 'available',
        createdAt: new Date('2025-01-01T00:00:00Z'),
        ...overrides,
        publicKey: encodeBase64(overrides.publicKey),
      })
    )
  })

export const insertClaimedTicket = (
  db: DB['Type'],
  overrides: Partial<Omit<typeof schema.invitationTickets.$inferInsert, 'publicKey'>> & {
    publicKey: Uint8Array
    claimedBy: string
  },
  keypairOverrides?: { privateKey: Uint8Array },
) =>
  Effect.gen(function*() {
    if (!keypairOverrides) {
      const { privateKey } = yield* generateTestTicket
      keypairOverrides = { privateKey }
    }
    yield* Effect.tryPromise(() =>
      db.insert(schema.invitationTickets).values({
        privateKey: encodeBase64(keypairOverrides!.privateKey),
        dim: DIM_GAME,
        network: NETWORK_WESTEND2,
        inviter: MOCK_INVITER,
        state: 'claimed',
        createdAt: new Date('2025-01-01T00:00:00Z'),
        claimedAt: new Date('2025-01-01T00:00:00Z'),
        ...overrides,
        publicKey: encodeBase64(overrides.publicKey),
      })
    )
  })

export const readTicket = (db: DB['Type'], publicKey: Uint8Array) =>
  Effect.tryPromise(() =>
    db.query.invitationTickets.findFirst({
      where: { publicKey: { eq: encodeBase64(publicKey) } },
    })
  )

export const countTickets = (
  db: DB['Type'],
  dim: 'Game' | 'ProofOfInk',
  network: 'westend2' | 'polkadot',
  state?: 'available' | 'claimed',
) =>
  Effect.tryPromise(async () => {
    const conditions = [eq(schema.invitationTickets.dim, dim), eq(schema.invitationTickets.network, network)]
    if (state) {
      conditions.push(eq(schema.invitationTickets.state, state))
    }
    const result = await db
      .select({ count: count() })
      .from(schema.invitationTickets)
      .where(and(...conditions))
    return result[0]?.count ?? 0
  })

export const cleanUp = Effect.andThen(
  DB,
  (db) => Effect.tryPromise(() => db.delete(schema.invitationTickets).execute()),
).pipe(Effect.orDie)

export const insertAvailableTickets = (
  db: DB['Type'],
  tickets: Array<
    (Partial<Omit<typeof schema.invitationTickets.$inferInsert, 'publicKey' | 'privateKey'>> & {
      publicKey: Uint8Array
    }) & { privateKey: Uint8Array }
  >,
) =>
  Effect.tryPromise(() =>
    db.insert(schema.invitationTickets).values(
      tickets.map((t) => ({
        ...t,
        publicKey: encodeBase64(t.publicKey),
        privateKey: encodeBase64(t.privateKey),
        dim: DIM_GAME,
        network: NETWORK_WESTEND2,
        inviter: MOCK_INVITER,
        state: 'available' as const,
        createdAt: new Date('2025-01-01T00:00:00Z'),
      })),
    )
  )

export const withCleanup = <A, E, R>(eff: Effect.Effect<A, E, R>) =>
  Effect.gen(function*() {
    yield* Effect.addFinalizer(() => cleanUp)
    return yield* eff
  })
