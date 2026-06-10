import { Schema as S } from 'effect'

export class NoTicketsFound extends S.TaggedClass<NoTicketsFound>()('NoTicketsFound', {}) {}

export class TicketsMarkedExhausted extends S.TaggedClass<TicketsMarkedExhausted>()(
  'TicketsMarkedExhausted',
  { tickets: S.Array(S.String) },
) {}

export class TicketsRecovered extends S.TaggedClass<TicketsRecovered>()(
  'TicketsRecovered',
  { tickets: S.Array(S.String) },
) {}

export class BatchReadyForSubmission extends S.TaggedClass<BatchReadyForSubmission>()(
  'BatchReadyForSubmission',
  {
    tickets: S.Array(S.String),
    retryAt: S.ValidDateFromSelf,
  },
) {}

export type BatchProcessingPlan =
  | TicketsMarkedExhausted
  | TicketsRecovered
  | BatchReadyForSubmission

export interface BatchProcessingConfig {
  readonly now: number
  readonly maxRetries: number
  readonly retryDelayMs: (attempt: number) => number
}
