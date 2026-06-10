import { PushDeliveryFailed } from '@identity-backend/mobile-push-notifications'
import { Schema as S } from 'effect'

export { PushDeliveryFailed }

export class SubscriptionNotFoundError extends S.TaggedError<SubscriptionNotFoundError>()(
  'SubscriptionNotFoundError',
  {
    identifier: S.String,
  },
) {
  override get message() {
    return `Subscription not found: ${this.identifier}`
  }
}

export class StatementValidationError extends S.TaggedError<StatementValidationError>()(
  'StatementValidationError',
  {
    cause: S.Unknown,
  },
) {}

export class BroadcastFailedError extends S.TaggedError<BroadcastFailedError>()(
  'BroadcastFailedError',
  { cause: S.Unknown },
) {}

export type BroadcastError = BroadcastFailedError

export type SubscriptionError =
  | SubscriptionNotFoundError
  | StatementValidationError
  | BroadcastError
