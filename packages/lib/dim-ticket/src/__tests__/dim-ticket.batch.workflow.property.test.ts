import { describe, it } from '@effect/vitest'
import { Arbitrary, Either, FastCheck as fc, Match } from 'effect'
import type { BatchProcessingConfig, BatchProcessingPlan } from '../dim-ticket.batch.types.js'
import {
  BatchReadyForSubmission,
  NoTicketsFound,
  TicketsMarkedExhausted,
  TicketsRecovered,
} from '../dim-ticket.batch.types.js'
import { planBatchProcessing } from '../dim-ticket.batch.workflow.js'
import { DimTicketRecord } from '../dim-ticket.types.js'

const makeConfig = (now: Date, retryDelayMs = constantDelay): BatchProcessingConfig => ({
  now: now.getTime(),
  maxRetries: MAX_RETRIES,
  retryDelayMs,
})

const isExhausted = (e: BatchProcessingPlan): e is TicketsMarkedExhausted => e._tag === 'TicketsMarkedExhausted'

const isRecovered = (e: BatchProcessingPlan): e is TicketsRecovered => e._tag === 'TicketsRecovered'

const isBatchReady = (e: BatchProcessingPlan): e is BatchReadyForSubmission => e._tag === 'BatchReadyForSubmission'

const isNoTicketsFound = (e: NoTicketsFound): boolean =>
  Match.value(e).pipe(Match.tag('NoTicketsFound', () => true), Match.orElse(() => false))

const MAX_RETRIES = 5
const constantDelay = (_attempt: number) => 1_000

const safeDateArb = fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') })

const pendingArb = Arbitrary.make(DimTicketRecord).map(r => ({
  ...r,
  status: 'PENDING' as const,
  retryCount: 0,
  retryAt: null,
}))

const submittedArb = Arbitrary.make(DimTicketRecord).map(r => ({
  ...r,
  status: 'SUBMITTED' as const,
  retryCount: 0,
  retryAt: null,
}))

const submittingArb = Arbitrary.make(DimTicketRecord).map(r => ({
  ...r,
  status: 'SUBMITTING' as const,
  retryCount: 1,
  retryAt: null,
}))

const exhaustedArb = Arbitrary.make(DimTicketRecord).map(r => ({
  ...r,
  status: 'PENDING' as const,
  retryCount: MAX_RETRIES,
  retryAt: null,
}))

const ticketWithRetryArb = Arbitrary.make(DimTicketRecord).chain(base =>
  fc.integer({ min: 0, max: MAX_RETRIES + 5 }).map(retryCount => ({
    ...base,
    retryCount,
    status: 'PENDING' as const,
    retryAt: null,
  }))
)

describe('planBatchProcessing', () => {
  it.prop(
    '∀_EmptyInput_=∅',
    [safeDateArb],
    ([now]) => {
      const result = planBatchProcessing([], makeConfig(now))
      return Either.isLeft(result) && isNoTicketsFound(result.left)
    },
  )

  it.prop(
    '∀x_AllExhausted_→Exhausted',
    [fc.array(exhaustedArb, { minLength: 1, maxLength: 5 }), safeDateArb],
    ([tickets, now]) => {
      const result = planBatchProcessing(tickets, makeConfig(now))
      if (!Either.isRight(result)) return false
      const commands = result.right
      return commands.length === 1 &&
        isExhausted(commands[0]!) &&
        commands[0]!.tickets.length === tickets.length
    },
  )

  it.prop(
    '∀x_AllPending_→Batch',
    [fc.array(pendingArb, { minLength: 1, maxLength: 10 }), safeDateArb],
    ([tickets, now]) => {
      const result = planBatchProcessing(tickets, makeConfig(now))
      if (!Either.isRight(result)) return false
      const prepared = result.right.find(isBatchReady)
      return prepared?.tickets.length === tickets.length
    },
  )

  it.prop(
    '∃x_Submitted_→Recover',
    [fc.array(submittedArb, { minLength: 1, maxLength: 5 }), safeDateArb],
    ([tickets, now]) => {
      const result = planBatchProcessing(tickets, makeConfig(now))
      if (!Either.isRight(result)) return false
      const hasOrphaned = result.right.some(isRecovered)
      const hasBatch = result.right.some(isBatchReady)
      return hasOrphaned && hasBatch
    },
  )

  it.prop(
    '∃x_Submitting_→Recover',
    [fc.array(submittingArb, { minLength: 1, maxLength: 5 }), safeDateArb],
    ([tickets, now]) => {
      const result = planBatchProcessing(tickets, makeConfig(now))
      if (!Either.isRight(result)) return false
      const hasOrphaned = result.right.some(isRecovered)
      const hasBatch = result.right.some(isBatchReady)
      return hasOrphaned && hasBatch
    },
  )

  it.prop(
    '∀_NoSubmitted_¬Orphaned',
    [fc.array(pendingArb, { minLength: 1, maxLength: 10 }), safeDateArb],
    ([tickets, now]) => {
      const result = planBatchProcessing(tickets, makeConfig(now))
      if (!Either.isRight(result)) return false
      return !result.right.some(isRecovered)
    },
  )

  it.prop(
    '∀x_MixedTickets_∘Causal',
    [
      fc.array(fc.oneof(pendingArb, submittedArb, submittingArb, exhaustedArb), { minLength: 1, maxLength: 10 }),
      safeDateArb,
    ],
    ([tickets, now]) => {
      const result = planBatchProcessing(tickets, makeConfig(now))
      if (Either.isLeft(result)) return true

      const planTag = (plan: BatchProcessingPlan): string => {
        if (plan instanceof TicketsMarkedExhausted) return 'TicketsMarkedExhausted'
        if (plan instanceof TicketsRecovered) return 'TicketsRecovered'
        return 'BatchReadyForSubmission'
      }
      const tags = result.right.map(planTag)
      const exhaustedIdx = tags.indexOf('TicketsMarkedExhausted')
      const orphanedIdx = tags.indexOf('TicketsRecovered')
      const batchIdx = tags.indexOf('BatchReadyForSubmission')

      if (exhaustedIdx !== -1 && orphanedIdx !== -1 && exhaustedIdx > orphanedIdx) return false
      if (exhaustedIdx !== -1 && batchIdx !== -1 && exhaustedIdx > batchIdx) return false
      if (orphanedIdx !== -1 && batchIdx !== -1 && orphanedIdx > batchIdx) return false

      return true
    },
  )

  it.prop(
    '∀x_Batch_⊇Pending∪Orphaned',
    [fc.array(fc.oneof(pendingArb, submittedArb, submittingArb), { minLength: 1, maxLength: 10 }), safeDateArb],
    ([tickets, now]) => {
      const pendingCount = tickets.filter(t => t.status === 'PENDING').length
      const orphanedCount = tickets.filter(t => t.status === 'SUBMITTED' || t.status === 'SUBMITTING').length

      const result = planBatchProcessing(tickets, makeConfig(now))
      if (!Either.isRight(result)) return false

      const prepared = result.right.find(isBatchReady)
      return prepared?.tickets.length === pendingCount + orphanedCount
    },
  )

  it.prop(
    '∀x_Exhausted_=OnlyExhausted',
    [fc.array(ticketWithRetryArb, { minLength: 1, maxLength: 10 }), safeDateArb],
    ([tickets, now]) => {
      const expectedExhaustedCount = tickets.filter(t => (t.retryCount ?? 0) >= MAX_RETRIES).length

      const result = planBatchProcessing(tickets, makeConfig(now))
      if (!Either.isRight(result)) return false

      const exhausted = result.right.find(isExhausted)

      if (expectedExhaustedCount === 0) return exhausted === undefined
      return exhausted?.tickets.length === expectedExhaustedCount
    },
  )

  it.prop(
    '∀t_RetryAt_=Max+1',
    [
      fc.tuple(
        Arbitrary.make(DimTicketRecord).map(r => ({ ...r, status: 'PENDING' as const, retryCount: 1, retryAt: null })),
        Arbitrary.make(DimTicketRecord).map(r => ({ ...r, status: 'PENDING' as const, retryCount: 3, retryAt: null })),
      ),
      safeDateArb,
      fc.integer({ min: 1, max: 1_000 }),
    ],
    ([[ticketA, ticketB], now, baseDelayMs]) => {
      const retryDelayMs = (attempt: number) => baseDelayMs * attempt
      const result = planBatchProcessing([ticketA, ticketB], {
        now: now.getTime(),
        maxRetries: MAX_RETRIES,
        retryDelayMs,
      })

      if (!Either.isRight(result)) return false
      const prepared = result.right.find(isBatchReady)

      return prepared?.retryAt.getTime() === now.getTime() + baseDelayMs * 4
    },
  )
})
