import { DB } from '#root/db/mod.js'
import * as schema from '#root/db/schema.js'
import { sr25519 } from '@identity-backend/crypto'
import { ss58Decode } from '@polkadot-labs/hdkd-helpers'
import { decodeBase64 } from '@std/encoding'
import { and, asc, count, eq } from 'drizzle-orm'
import { Clock, Context, Duration, Effect, Layer, Redacted, Schedule, Schema as S } from 'effect'
import { UnknownException } from 'effect/Cause'

import { Dim, Network, Ss58String } from './invitation-ticket.schema.js'

class InvitationTicketNetworkConfig extends Context.Tag('InvitationTicketNetworkConfig')<
  InvitationTicketNetworkConfig,
  { readonly network: Network }
>() {}

export class PoolExhaustedError extends S.TaggedError<PoolExhaustedError>()('PoolExhaustedError', {}) {}

export class TicketRaceError extends S.TaggedError<TicketRaceError>()('TicketRaceError', {}) {}

export const ClaimInvitationTicketError = S.Union(PoolExhaustedError, TicketRaceError)
export type ClaimInvitationTicketError = S.Schema.Type<typeof ClaimInvitationTicketError>

export class ClaimTicketConfig extends Context.Reference<ClaimTicketConfig>()(
  'ClaimTicketConfig',
  {
    defaultValue: () => ({
      dbRetryMaxRetries: 3,
      dbRetryBaseDelay: Duration.millis(200),
      dbRetryFactor: 2,
    }),
  },
) {}

const ClaimCommandTypeId: unique symbol = Symbol.for('@identity-backend/invitation-ticket/ClaimCommand')
type ClaimCommandTypeId = typeof ClaimCommandTypeId

export class ClaimCommand extends S.Class<ClaimCommand>('ClaimCommand')({
  who: Ss58String,
  dim: Dim,
}) {
  readonly [ClaimCommandTypeId] = ClaimCommandTypeId
}

const ClaimResultTypeId: unique symbol = Symbol.for('@identity-backend/invitation-ticket/ClaimResult')
type ClaimResultTypeId = typeof ClaimResultTypeId

export class ClaimResult extends S.Class<ClaimResult>('ClaimResult')({
  publicKey: S.Uint8ArrayFromSelf,
  inviter: Ss58String,
  dim: Dim,
  network: Network,
  claimedBy: Ss58String,
  createdAt: S.Date,
  claimedAt: S.Date,
  signature: S.Uint8ArrayFromSelf,
  remaining: S.Number,
}) {
  readonly [ClaimResultTypeId] = ClaimResultTypeId
}

export namespace ClaimInvitationTicketShell {
  export interface Definition {
    readonly execute: (
      cmd: ClaimCommand,
    ) => Effect.Effect<ClaimResult, ClaimInvitationTicketError, never>
  }
}

const make = Effect.gen(function*() {
  const db = yield* DB
  const config = yield* ClaimTicketConfig
  const networkConfig = yield* InvitationTicketNetworkConfig

  const dbRetry = Effect.retry(
    Schedule.intersect(
      Schedule.exponential(config.dbRetryBaseDelay, config.dbRetryFactor).pipe(Schedule.jittered),
      Schedule.recurs(config.dbRetryMaxRetries),
    ),
  )

  const execute = Effect.fn('claim_invitation_ticket')(
    function*(cmd: ClaimCommand) {
      const now = new Date(yield* Clock.currentTimeMillis)

      yield* Effect.annotateCurrentSpan('invitation_ticket.dim', cmd.dim)
      yield* Effect.annotateCurrentSpan('invitation_ticket.network', networkConfig.network)

      const preCheck = yield* Effect.tryPromise(async () => {
        const result = await db
          .select({ count: count() })
          .from(schema.invitationTickets)
          .where(
            and(
              eq(schema.invitationTickets.dim, cmd.dim),
              eq(schema.invitationTickets.network, networkConfig.network),
              eq(schema.invitationTickets.state, 'available'),
            ),
          )
        return result[0]?.count ?? 0
      }).pipe(
        dbRetry,
        Effect.orDie,
        Effect.withSpan('db.postgresql.select', {
          attributes: {
            'db.operation': 'SELECT',
            'db.table': 'invitation_tickets',
          },
        }),
      )

      if (preCheck === 0) {
        yield* Effect.logDebug('Pool exhausted — no available tickets', {
          'invitation_ticket.dim': cmd.dim,
          'invitation_ticket.network': networkConfig.network,
        })
        return yield* new PoolExhaustedError()
      }

      const claimed = yield* Effect.async<
        {
          publicKey: string
          privateKey: string
          inviter: string
          createdAt: Date
          rowsAffected: number
        } | null
      >((resume) => {
        db.transaction(async (tx) => {
          const rows = await tx
            .select({
              publicKey: schema.invitationTickets.publicKey,
              privateKey: schema.invitationTickets.privateKey,
              inviter: schema.invitationTickets.inviter,
              createdAt: schema.invitationTickets.createdAt,
            })
            .from(schema.invitationTickets)
            .where(
              and(
                eq(schema.invitationTickets.dim, cmd.dim),
                eq(schema.invitationTickets.network, networkConfig.network),
                eq(schema.invitationTickets.state, 'available'),
              ),
            )
            .orderBy(asc(schema.invitationTickets.createdAt))
            .limit(1)
            .for('update', { skipLocked: true })

          const row = rows[0]
          if (!row) {
            resume(Effect.succeed(null))
            return
          }

          const updateResult = await tx
            .update(schema.invitationTickets)
            .set({
              state: 'claimed',
              claimedBy: cmd.who,
              claimedAt: now,
              updatedAt: now,
            })
            .where(eq(schema.invitationTickets.publicKey, row.publicKey))

          resume(Effect.succeed({ ...row, rowsAffected: updateResult.count }))
        }).catch((error) => resume(Effect.die(new UnknownException(error, 'Transaction failed'))))
      }).pipe(
        dbRetry,
        Effect.orDie,
        Effect.tap((result) => Effect.annotateCurrentSpan('db.rows_affected', result?.rowsAffected ?? 0)),
        Effect.withSpan('db.postgresql.update', {
          attributes: {
            'db.operation': 'UPDATE',
            'db.table': 'invitation_tickets',
          },
        }),
      )

      if (!claimed) {
        yield* Effect.logDebug('Ticket claimed by concurrent request', {
          'invitation_ticket.dim': cmd.dim,
          'invitation_ticket.network': networkConfig.network,
        })
        return yield* new TicketRaceError()
      }

      const privateKey = yield* S.decode(S.compose(S.Uint8ArrayFromBase64, sr25519.PrivateKey))(claimed.privateKey)
        .pipe(Effect.orDie)
      const keypair = yield* sr25519.fromPrivateKey({ privateKey: Redacted.make(privateKey) })

      const [whoBytes] = ss58Decode(cmd.who)
      const signature = yield* keypair.sign(whoBytes).pipe(
        Effect.withSpan('crypto.sign'),
      )

      const remaining = yield* Effect.tryPromise(async () => {
        const result = await db
          .select({ count: count() })
          .from(schema.invitationTickets)
          .where(
            and(
              eq(schema.invitationTickets.dim, cmd.dim),
              eq(schema.invitationTickets.network, networkConfig.network),
              eq(schema.invitationTickets.state, 'available'),
            ),
          )
        return result[0]!.count
      }).pipe(
        dbRetry,
        Effect.orDie,
        Effect.withSpan('db.postgresql.select', {
          attributes: {
            'db.operation': 'SELECT',
            'db.table': 'invitation_tickets',
          },
        }),
      )

      yield* Effect.logInfo('Ticket claimed successfully', {
        'invitation_ticket.dim': cmd.dim,
        'invitation_ticket.network': networkConfig.network,
        'invitation_ticket.remaining': remaining,
      })

      return new ClaimResult({
        publicKey: decodeBase64(claimed.publicKey),
        inviter: S.decodeUnknownSync(Ss58String)(claimed.inviter),
        dim: cmd.dim,
        network: networkConfig.network,
        claimedBy: cmd.who,
        createdAt: claimed.createdAt,
        claimedAt: now,
        signature,
        remaining,
      })
    },
  ) satisfies ClaimInvitationTicketShell['Type']['execute']

  return ClaimInvitationTicketShell.of({ execute })
})

export class ClaimInvitationTicketShell extends Context.Tag('@app/ClaimInvitationTicketShell')<
  ClaimInvitationTicketShell,
  ClaimInvitationTicketShell.Definition
>() {
  static readonly Default = Layer.scoped(ClaimInvitationTicketShell, make)
}
