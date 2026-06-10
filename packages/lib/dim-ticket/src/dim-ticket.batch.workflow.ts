import { Array, Either } from 'effect'
import {
  type BatchProcessingConfig,
  type BatchProcessingPlan,
  BatchReadyForSubmission,
  NoTicketsFound,
  TicketsMarkedExhausted,
  TicketsRecovered,
} from './dim-ticket.batch.types.js'
import type { DimTicketRecord } from './dim-ticket.types.js'

const extractTicketIds = <T extends { readonly ticket: string }>(tickets: readonly T[]): readonly string[] =>
  tickets.map(t => t.ticket)

const isRetryExhausted = (maxRetries: number) => <T extends { readonly retryCount: number | null }>(ticket: T) =>
  (ticket.retryCount ?? 0) >= maxRetries

const isOrphaned = <T extends { readonly status: string }>(ticket: T) =>
  ticket.status === 'SUBMITTED' || ticket.status === 'SUBMITTING'

export const planBatchProcessing = (
  tickets: readonly DimTicketRecord[],
  config: BatchProcessingConfig,
): Either.Either<readonly BatchProcessingPlan[], NoTicketsFound> => {
  if (tickets.length === 0) {
    return Either.left(new NoTicketsFound({}))
  }

  const plan: BatchProcessingPlan[] = []

  const [processable, exhausted] = Array.partition(tickets, isRetryExhausted(config.maxRetries))

  if (exhausted.length > 0) {
    plan.push(new TicketsMarkedExhausted({ tickets: extractTicketIds(exhausted) }))
  }

  if (processable.length === 0) {
    return Either.right(plan)
  }

  const [pending, orphaned] = Array.partition(processable, isOrphaned)

  if (orphaned.length > 0) {
    plan.push(new TicketsRecovered({ tickets: extractTicketIds(orphaned) }))
  }

  const batchTickets = [...pending, ...orphaned]
  const maxRetryCount = batchTickets.reduce((max, t) => Math.max(max, t.retryCount ?? 0), 0)
  const retryAt = new Date(config.now + config.retryDelayMs(maxRetryCount + 1))
  plan.push(new BatchReadyForSubmission({ tickets: extractTicketIds(batchTickets), retryAt }))

  return Either.right(plan)
}
