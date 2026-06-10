import { outcomeFromCause } from '#root/batch-backoff/batch-backoff.acl.js'
import { DB, schema } from '#root/db/mod.js'
import type { DimTicket } from '#root/db/schema.js'
import {
  dimTicketRegistrationLatencyHistogram,
  dimTicketRegistrationsCounter,
} from '#root/features/dim/dim-ticket.metrics.js'
import { buildSpanLinks } from '#root/tracing/span-links.js'
import {
  BatchReadyForSubmission,
  computeRetryDelay,
  DIMLiteral,
  DimTicketRecord,
  planBatchProcessing,
} from '@identity-backend/dim-ticket'
import { eq, inArray } from 'drizzle-orm'
import {
  Array as Arr,
  Context,
  Duration,
  Effect,
  Either,
  HashSet,
  Layer,
  Match,
  Metric,
  Ref,
  Schema as S,
} from 'effect'
import { DimTicketBlockchainService } from './dim-ticket-blockchain.service.js'
import { InviterSignerService } from './inviter-signer.service.js'

export class DimTicketDaemonShellError extends S.TaggedError<DimTicketDaemonShellError>()(
  'DimTicketDaemonShellError',
  {
    message: S.String,
    category: S.Literal('db', 'blockchain', 'network'),
    retryable: S.Boolean,
    cause: S.optional(S.Unknown),
  },
) {}

export class DimTicketRetryConfig extends Context.Reference<DimTicketRetryConfig>()(
  'DimTicketRetryConfig',
  {
    defaultValue: () => ({
      maxRetries: 5,
      retryBaseMs: 1_000,
      retryMaxMs: 60_000,
      retryMaxExponent: 10,
    }),
  },
) {}

export namespace DimTicketDaemonShell {
  export interface Definition {
    readonly processTickets: (
      tickets: readonly DimTicket[],
      now: number,
      maxRetries: number,
    ) => Effect.Effect<void, DimTicketDaemonShellError>
    readonly fetchPendingTickets: (
      now: number,
      batchSize: number,
    ) => Effect.Effect<readonly DimTicket[], DimTicketDaemonShellError>
  }
}

const make = Effect.gen(function*() {
  const db = yield* DB
  const blockchainService = yield* DimTicketBlockchainService
  const signerService = yield* InviterSignerService
  const signer = yield* signerService.getSigner()
  const retryConfig = yield* DimTicketRetryConfig
  const retryDelayMs = computeRetryDelay(retryConfig.retryBaseMs, retryConfig.retryMaxMs, retryConfig.retryMaxExponent)
  const knownMalformedRef = yield* Ref.make(HashSet.empty<string>())

  const markExhausted = (ticketIds: readonly string[]) =>
    Effect.gen(function*() {
      if (ticketIds.length === 0) return
      yield* Effect.logWarning('Marking tickets exhausted', { 'dim.ticket.exhausted_count': ticketIds.length })
      return yield* Effect.tryPromise({
        try: () =>
          db
            .update(schema.dimTickets)
            .set({ status: 'FAILED', updatedAt: new Date() })
            .where(inArray(schema.dimTickets.ticket, [...ticketIds])),
        catch: (cause) =>
          new DimTicketDaemonShellError({
            message: 'Failed to mark tickets exhausted',
            category: 'db',
            retryable: true,
            cause,
          }),
      })
    })

  const recoverOrphaned = (ticketIds: readonly string[]) =>
    Effect.gen(function*() {
      if (ticketIds.length === 0) return
      yield* Effect.logInfo('Recovering orphaned tickets', { 'dim.ticket.recovered_count': ticketIds.length })
      return yield* Effect.tryPromise({
        try: () =>
          db
            .update(schema.dimTickets)
            .set({ status: 'PENDING', retryAt: null, updatedAt: new Date() })
            .where(inArray(schema.dimTickets.ticket, [...ticketIds])),
        catch: (cause) =>
          new DimTicketDaemonShellError({
            message: 'Failed to recover orphaned tickets',
            category: 'db',
            retryable: true,
            cause,
          }),
      })
    })

  const updateToSubmitting = (
    ticketRows: readonly DimTicket[],
    retryAt: Date,
    now: number,
  ) =>
    Effect.tryPromise({
      try: () =>
        db
          .update(schema.dimTickets)
          .set({ status: 'SUBMITTING', updatedAt: new Date(now), retryAt })
          .where(inArray(schema.dimTickets.ticket, ticketRows.map((t) => t.ticket))),
      catch: (cause) =>
        new DimTicketDaemonShellError({
          message: 'Failed to update tickets to SUBMITTING',
          category: 'db',
          retryable: true,
          cause,
        }),
    })

  const updateToRegistered = (
    ticketRows: readonly { ticket: string }[],
    onchainData: { blockHash: string; blockNumber: number },
  ) => {
    if (ticketRows.length === 0) return Effect.void
    return Effect.tryPromise({
      try: () =>
        db
          .update(schema.dimTickets)
          .set({ status: 'REGISTERED', registered: true, onchainData })
          .where(inArray(schema.dimTickets.ticket, ticketRows.map((t) => t.ticket))),
      catch: (cause) =>
        new DimTicketDaemonShellError({
          message: 'Failed to update tickets to REGISTERED',
          category: 'db',
          retryable: true,
          cause,
        }),
    })
  }

  const updateToPendingWithRetry = (
    ticketRows: readonly DimTicket[],
    now: number,
    retryDelayMs: (attempt: number) => number,
  ) =>
    Effect.all(
      ticketRows.map((ticket: DimTicket) =>
        Effect.gen(function*() {
          const newRetryCount = (ticket.retryCount ?? 0) + 1
          const retryAfterMs = retryDelayMs(newRetryCount)

          return yield* Effect.tryPromise({
            try: () =>
              db
                .update(schema.dimTickets)
                .set({
                  status: 'PENDING',
                  retryCount: newRetryCount,
                  retryAt: new Date(now + retryAfterMs),
                  updatedAt: new Date(),
                })
                .where(eq(schema.dimTickets.ticket, ticket.ticket)),
            catch: (cause) =>
              new DimTicketDaemonShellError({
                message: 'Failed to update tickets to PENDING with retry',
                category: 'db',
                retryable: true,
                cause,
              }),
          })
        })
      ),
      { concurrency: 'unbounded' },
    )

  const executeBatchSubmission = (
    ticketRows: readonly DimTicket[],
    now: number,
  ) =>
    Effect.gen(function*() {
      const dimTickets: { ticket: string; dim: DIMLiteral }[] = ticketRows.map((ticket: DimTicket) => ({
        ticket: ticket.ticket,
        dim: ticket.dim,
      }))

      const result = yield* blockchainService.registerBatch(dimTickets, signer)

      const completedTickets = result.completedIndices
        .map((index) => ticketRows[index])
        .filter((t): t is DimTicket => t !== undefined)

      const failedTickets = result.failedIndices
        .map((index) => ticketRows[index])
        .filter((t): t is DimTicket => t !== undefined)

      yield* updateToRegistered(completedTickets, { blockHash: result.blockHash, blockNumber: result.blockNumber })

      yield* updateToPendingWithRetry(failedTickets, now, retryDelayMs)

      yield* Effect.forEach(
        completedTickets,
        (ticket: DimTicket) =>
          Effect.gen(function*() {
            const currentTime = yield* Effect.clockWith((c) => c.currentTimeMillis)
            const latencyMs = currentTime - ticket.createdAt.getTime()
            yield* Metric.update(dimTicketRegistrationLatencyHistogram, Duration.millis(latencyMs))
            yield* Metric.increment(Metric.tagged(dimTicketRegistrationsCounter, 'status', 'success'))
          }),
        { concurrency: 'unbounded' },
      )
      yield* Effect.forEach(
        failedTickets,
        () => Metric.increment(Metric.tagged(dimTicketRegistrationsCounter, 'status', 'failed')),
        { concurrency: 'unbounded' },
      )

      yield* Effect.logInfo('Batch submission completed', {
        'dim.ticket.registered_count': String(completedTickets.length),
        'dim.ticket.failed_count': String(failedTickets.length),
      })
    }).pipe(
      Effect.ensuring(Effect.linkSpanCurrent(buildSpanLinks(ticketRows, (t) => ({ 'dim.ticket.id': t.ticket })))),
    )

  const fetchPendingTickets = Effect.fn('DimTicketDaemon.fetchPendingTickets')(
    function*(now: number, batchSize: number) {
      const tickets = yield* Effect.tryPromise({
        try: () =>
          db.query.dimTickets.findMany({
            where: {
              status: { in: ['PENDING', 'SUBMITTING', 'SUBMITTED'] },
              OR: [
                { retryAt: { isNull: true } },
                { retryAt: { lte: new Date(now) } },
              ],
            },
            orderBy: (t, { asc }) => [asc(t.createdAt)],
            limit: batchSize,
          }),
        catch: (cause) =>
          new DimTicketDaemonShellError({
            message: 'Failed to fetch pending tickets',
            category: 'db',
            retryable: false,
            cause,
          }),
      })
      yield* Effect.annotateCurrentSpan({
        'batch.limit': batchSize,
        'ticket.status_filter': 'PENDING,SUBMITTING,SUBMITTED',
      })
      return tickets
    },
  )

  const executeSubmitBatch = (
    cmd: BatchReadyForSubmission,
    allTicketRows: readonly DimTicket[],
    now: number,
  ) =>
    Effect.gen(function*() {
      const batchTicketIds = HashSet.fromIterable(cmd.tickets)
      const batchTickets = allTicketRows.filter((t: DimTicket) => HashSet.has(batchTicketIds, t.ticket))

      yield* updateToSubmitting(batchTickets, cmd.retryAt, now)

      yield* executeBatchSubmission(batchTickets, now).pipe(
        Effect.withLogSpan('dim_ticket.batch_submission'),
        Effect.tapError((error) =>
          Effect.logError('Batch submission failed', {
            'error.type': error._tag,
            'error.category': 'category' in error ? error.category : 'unknown',
            'error.retryable': 'retryable' in error ? error.retryable : false,
            'batch_backoff.outcome': outcomeFromCause(error)._tag,
          })
        ),
        Effect.catchTags({
          RegisterDIMTicketsDaemonError: (error) =>
            new DimTicketDaemonShellError({
              message: error.message,
              category: error.category,
              retryable: error.retryable,
              cause: error.cause,
            }),
          OnChainTicketAPIError: (error) =>
            new DimTicketDaemonShellError({
              message: 'On-chain ticket API error',
              category: 'blockchain',
              retryable: true,
              cause: error.cause,
            }),
        }),
      )
    })

  const processTickets = Effect.fn('DimTicketDaemon.processTickets')(function*(
    tickets: readonly DimTicket[],
    now: number,
    maxRetries: number,
  ) {
    if (tickets.length > 0) {
      yield* Effect.logInfo('Processing batch', { 'dim.ticket.batch.input_count': tickets.length })
    }
    const decode = S.decodeUnknownEither(DimTicketRecord)
    const eithers = tickets.map((ticket) => decode(ticket))
    const [malformedEithers, valid] = Arr.partition(eithers, Either.isRight)

    if (malformedEithers.length > 0) {
      const malformedIds = tickets
        .filter((_, i) => Either.isLeft(eithers[i]!))
        .map((t) => t.ticket)
      const knownMalformed = yield* Ref.get(knownMalformedRef)
      const newMalformed = malformedIds.filter((id) => !HashSet.has(knownMalformed, id))
      if (newMalformed.length > 0) {
        yield* Ref.update(knownMalformedRef, (set) => newMalformed.reduce((s, id) => HashSet.add(s, id), set))
        yield* Effect.logWarning('Malformed ticket rows detected (first occurrence)', {
          'dim.ticket.malformed_count': newMalformed.length,
          'dim.ticket.malformed_ids': newMalformed.join(','),
        })
      }
    }

    const domainTickets = valid.map((r) => r.right)
    const batchResult = planBatchProcessing(domainTickets, { now, maxRetries, retryDelayMs })

    if (Either.isLeft(batchResult)) {
      return
    }

    const commands = batchResult.right

    for (const cmd of commands) {
      yield* Match.value(cmd).pipe(
        Match.tag('TicketsMarkedExhausted', (c) => markExhausted(c.tickets)),
        Match.tag('TicketsRecovered', (c) => recoverOrphaned(c.tickets)),
        Match.tag('BatchReadyForSubmission', (c) => executeSubmitBatch(c, tickets, now)),
        Match.exhaustive,
      )
    }

    yield* Effect.annotateCurrentSpan({ 'batch.size': tickets.length })
  })

  return DimTicketDaemonShell.of({ processTickets, fetchPendingTickets })
})

export class DimTicketDaemonShell extends Context.Tag('@app/DimTicketDaemonShell')<
  DimTicketDaemonShell,
  DimTicketDaemonShell.Definition
>() {
  static readonly DefaultWithoutDependencies = Layer.scoped(DimTicketDaemonShell, make)
  static readonly Default = Layer.suspend(() => DimTicketDaemonShell.DefaultWithoutDependencies).pipe(
    Layer.provideMerge(DimTicketBlockchainService.Default),
  )
}
