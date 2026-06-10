import { DB } from '#root/db/drizzle.js'
import * as schema from '#root/db/schema.js'
import type { DimTicketStatus } from '@identity-backend/dim-ticket'
import {
  EncodableDimTicketStatus,
  FailedTicket,
  InviteeAddress,
  InviterAddress,
  PendingTicket,
  RegisteredTicket,
  SubmittedTicket,
  SubmittingTicket,
} from '@identity-backend/dim-ticket'
import { Context, Duration, Effect, Layer, Match, Schema as S } from 'effect'
import { DimTicketBlockchainService } from './dim-ticket-blockchain.service.js'

// ACL boundary transform — translates DB record to domain type
const toDecodableDimTicketStatus = (
  encodable: EncodableDimTicketStatus,
): DimTicketStatus => {
  const base = {
    ticket: encodable.ticket,
    inviter: encodable.inviter,
    dim: encodable.dim,
    network: encodable.network,
  }
  const stateTimestamp = encodable.updatedAt ?? encodable.createdAt

  return Match.value(encodable).pipe(
    Match.tag('PendingTicketRecord', () => new PendingTicket({ ...base, createdAt: encodable.createdAt })),
    Match.tag('SubmittedTicketRecord', () =>
      new SubmittedTicket({
        ...base,
        createdAt: encodable.createdAt,
        submittedAt: stateTimestamp,
        retryAt: encodable.retryAt ?? undefined,
      })),
    Match.tag('RegisteredTicketRecord', () =>
      new RegisteredTicket({
        ...base,
        createdAt: encodable.createdAt,
        retryAt: encodable.retryAt ?? undefined,
        onchainData: encodable.onchainData,
        registeredAt: stateTimestamp,
      })),
    Match.tag('SubmittingTicketRecord', () =>
      new SubmittingTicket({
        ...base,
        createdAt: encodable.createdAt,
        submittedAt: stateTimestamp,
      })),
    Match.tag('FailedTicketRecord', () =>
      new FailedTicket({
        ...base,
        createdAt: encodable.createdAt,
        error: 'Failed',
        failedAt: stateTimestamp,
      })),
    Match.exhaustive,
  )
}

export class DimTicketDbError extends S.TaggedError<DimTicketDbError>()('DimTicketDbError', {
  retryable: S.Boolean,
  cause: S.Unknown,
}) {}

export class DimTicketBlockchainError extends S.TaggedError<DimTicketBlockchainError>()('DimTicketBlockchainError', {
  retryable: S.Boolean,
  cause: S.Unknown,
}) {}

export class DimTicketValidationError extends S.TaggedError<DimTicketValidationError>()('DimTicketValidationError', {
  retryable: S.Literal(false),
  field: S.String,
  cause: S.Unknown,
}) {}

export class DimTicketAlreadyExistsError
  extends S.TaggedError<DimTicketAlreadyExistsError>()('DimTicketAlreadyExistsError', {
    retryable: S.Literal(false),
    ticket: S.String,
  })
{}

export class DimTicketNotFoundError extends S.TaggedError<DimTicketNotFoundError>()('DimTicketNotFoundError', {
  retryable: S.Literal(false),
  ticket: S.String,
}) {}

export class DimTicketQuotaExceededError extends S.TaggedError<DimTicketQuotaExceededError>()(
  'DimTicketQuotaExceededError',
  {
    retryable: S.Literal(false),
    inviter: S.String,
    available: S.Number,
    requested: S.Literal(1),
  },
) {}

export type DimTicketError =
  | DimTicketDbError
  | DimTicketBlockchainError
  | DimTicketValidationError
  | DimTicketAlreadyExistsError
  | DimTicketNotFoundError
  | DimTicketQuotaExceededError

export class DimTicketConfig extends Context.Tag('DimTicketConfig')<
  DimTicketConfig,
  { readonly inviterAddress: string }
>() {}

export class DimTicketQuotaConfig extends Context.Reference<DimTicketQuotaConfig>()(
  'DimTicketQuotaConfig',
  {
    defaultValue: () => ({
      checkQuotaTimeout: Duration.seconds(15),
    }),
  },
) {}

export namespace DimTicketShell {
  export interface Definition {
    readonly getTicket: (ticket: string) => Effect.Effect<DimTicketStatus | null, DimTicketError, never>
    readonly getTicketOrFail: (ticket: string) => Effect.Effect<DimTicketStatus, DimTicketError, never>
    readonly createTicket: (params: {
      ticket: string
      network: 'westend2' | 'paseo' | 'polkadot'
      dim: 'Game' | 'ProofOfInk'
    }) => Effect.Effect<DimTicketStatus, DimTicketError, never>
  }
}

const make = Effect.gen(function*() {
  const db = yield* DB
  const { inviterAddress } = yield* DimTicketConfig
  const quotaConfig = yield* DimTicketQuotaConfig
  const blockchainService = yield* DimTicketBlockchainService

  const getTicket = Effect.fn('dim_ticket.get')(
    function*(ticket) {
      const rows = yield* Effect.tryPromise({
        try: () =>
          db.query.dimTickets.findMany({
            where: { ticket: { eq: ticket } },
            limit: 1,
          }),
        catch: (cause) => new DimTicketDbError({ retryable: true, cause }),
      })

      const row = rows[0]
      if (!row) {
        yield* Effect.annotateCurrentSpan('dim.ticket.found', false)
        return null
      }

      yield* Effect.annotateCurrentSpan('dim.ticket.found', true)
      yield* Effect.annotateCurrentSpan('dim.ticket.status', row.status)
      yield* Effect.annotateCurrentSpan('dim.network.id', row.network)
      yield* Effect.annotateCurrentSpan('dim.type', row.dim)

      const status = yield* S.decodeUnknown(EncodableDimTicketStatus)(row).pipe(
        Effect.mapError((cause) => new DimTicketValidationError({ retryable: false, field: 'db_row', cause })),
        Effect.map(toDecodableDimTicketStatus),
      )

      return status
    },
  ) satisfies DimTicketShell['Type']['getTicket']

  const getTicketOrFail = Effect.fnUntraced(function*(ticket: string) {
    const result = yield* getTicket(ticket)
    if (result === null) {
      return yield* new DimTicketNotFoundError({ retryable: false, ticket })
    }
    return result
  }) satisfies DimTicketShell['Type']['getTicketOrFail']

  const createTicket = Effect.fn('dim_ticket.create')(
    function*(params: {
      ticket: string
      network: 'westend2' | 'paseo' | 'polkadot'
      dim: 'Game' | 'ProofOfInk'
    }) {
      yield* Effect.annotateCurrentSpan('dim.network.id', params.network)
      yield* Effect.annotateCurrentSpan('dim.type', params.dim)
      yield* Effect.annotateLogsScoped({ 'dim.ticket.network': params.network, 'dim.ticket.type': params.dim })

      const now = yield* Effect.clockWith((clock) => clock.currentTimeMillis)

      if (params.ticket === inviterAddress) {
        return yield* Effect.die(new Error(`Inviter matches ticket: ${params.ticket}`))
      }

      const ticketResult = yield* S.decode(InviteeAddress)(params.ticket).pipe(
        Effect.mapError((cause) => new DimTicketValidationError({ retryable: false, field: 'ticket', cause })),
      )
      const inviterResult = yield* S.decode(InviterAddress)(inviterAddress).pipe(
        Effect.mapError((cause) => new DimTicketValidationError({ retryable: false, field: 'inviter', cause })),
      )

      const availableInvites = yield* blockchainService.checkQuota({
        inviter: inviterAddress,
        dim: params.dim,
      }).pipe(
        Effect.timeout(quotaConfig.checkQuotaTimeout),
        Effect.mapError((cause) => new DimTicketBlockchainError({ retryable: true, cause })),
      )

      if (availableInvites <= 0) {
        yield* Effect.logWarning('DIM ticket quota exceeded', {
          'dim.ticket.available': availableInvites,
        })
        return yield* new DimTicketQuotaExceededError({
          retryable: false,
          inviter: inviterAddress,
          available: availableInvites,
          requested: 1,
        })
      }

      const trace = yield* Effect.currentSpan.pipe(Effect.orElse(() => Effect.succeed(null)))
      if (trace) {
        yield* Effect.annotateCurrentSpan({
          'dim.ticket.trace_id': trace.traceId,
          'dim.ticket.span_id': trace.spanId,
        })
      }

      const inserted = yield* Effect.tryPromise({
        try: () =>
          db
            .insert(schema.dimTickets)
            .values({
              ticket: params.ticket,
              network: params.network,
              dim: params.dim,
              status: 'PENDING',
              inviter: inviterAddress,
              traceId: trace?.traceId ?? null,
              spanId: trace?.spanId ?? null,
            })
            .onConflictDoNothing()
            .returning(),
        catch: (cause) => new DimTicketDbError({ retryable: true, cause }),
      })

      if (inserted.length === 0) {
        yield* Effect.annotateCurrentSpan('dim.ticket.conflict', true)
        return yield* new DimTicketAlreadyExistsError({ retryable: false, ticket: params.ticket })
      }

      yield* Effect.annotateCurrentSpan('dim.ticket.created', true)
      yield* Effect.annotateCurrentSpan('dim.ticket.status', 'PENDING')
      yield* Effect.logInfo('DIM ticket created', {
        'dim.ticket.created': 'true',
        'dim.ticket.network': params.network,
        'dim.ticket.type': params.dim,
      })

      return new PendingTicket({
        ticket: ticketResult,
        inviter: inviterResult,
        dim: params.dim,
        network: params.network,
        createdAt: new Date(now),
      })
    },
    Effect.scoped,
  )

  return DimTicketShell.of({ getTicket, getTicketOrFail, createTicket: (p) => createTicket(p) })
})

export class DimTicketShell extends Context.Tag('@app/DimTicketShell')<
  DimTicketShell,
  DimTicketShell.Definition
>() {
  static readonly Default = Layer.scoped(DimTicketShell, make)
}
