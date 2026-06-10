import { Metric } from 'effect'

export const SpanAttributes = Object.freeze(
  {
    SUBSCRIPTION_ID: 'subscription.id',
    SUBSCRIPTION_NOTIFICATION_TYPE: 'subscription.notification_type',
    TOPIC_COUNT: 'subscription.topic_count',
    MATCH_COUNT: 'subscription.match_count',
    HAS_SENDER: 'subscription.has_sender',
    PROCESS_RESULT: 'subscription.process_result',
    POLL_INTERVAL_MS: 'subscription.poll_interval_ms',
    TIMEOUT_MS: 'subscription.timeout_ms',
    DELIVERY_CHANNEL: 'delivery.channel',
    TOKEN_MISSING: 'token.missing',
    TOKEN_TERMINAL: 'token.terminal',
    TOKEN_TERMINAL_REASON: 'token.terminal_reason',
    TOKEN_PROVIDER_CODE: 'token.provider_code',
    RULES_COUNT: 'rules.count',
    RULES_ADDED: 'rules.added',
    RULES_REMOVED: 'rules.removed',
    RULES_REPLACED: 'rules.replaced',
    RULES_TOTAL: 'rules.total',
    ERROR_TYPE: 'error.type',
    ERROR_CATEGORY: 'error.category',
    ERROR_SUBCATEGORY: 'error.subcategory',
    ERROR_RETRYABLE: 'error.retryable',
    // [HC] High-cardinality — only record hash, never raw value
    STATEMENT_HASH: 'statement.hash',
    // [HC] High-cardinality — sender pubkey is unique per user
    SENDER_PUBKEY: 'sender.pubkey',
    PIPELINE_STAGE: 'pipeline.stage',
    RETRY_ATTEMPT: 'retry.attempt',
    BATCH_STATEMENTS: 'batch.statements',
    BATCH_DELIVERIES: 'batch.deliveries',
    BATCH_FAILURES: 'batch.failures',
    BATCH_TIMEOUTS: 'batch.timeouts',
  } as const,
)

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

export const subscriptionProcessingCounter = Metric.counter(
  'app.push_notification.subscription.processing',
  { description: 'Total subscription processing attempts' },
)

export const subscriptionCreationsCounter = Metric.counter(
  'app.push_notification.subscription.creation',
  { description: 'Total subscription creation attempts' },
)

export const pushDeliveryCounter = Metric.counter(
  'app.push_notification.delivery',
  { description: 'Total push notification delivery attempts' },
)

export const pushDeliveryLatencyHistogram = Metric.timerWithBoundaries(
  'app.push_notification.delivery.duration',
  [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 15, 30],
  'Histogram of push notification delivery latency',
)

export const pushDeduplicationCounter = Metric.counter(
  'app.push_notification.deduplication',
  { description: 'Total push notification deduplication hits' },
)

export const pushRateLimitCounter = Metric.counter(
  'app.push_notification.rate_limit',
  { description: 'Total push notifications blocked by rate limiting' },
)

export const subscriptionRuleMatchCounter = Metric.counter(
  'app.push_notification.subscription.rule_match',
  { description: 'Total subscription rule match evaluations' },
)

export const broadcastCounter = Metric.counter(
  'app.push_notification.broadcast',
  { description: 'Broadcast outcomes by terminal decision (delivered / skip_<reason> / no_matches)' },
)
