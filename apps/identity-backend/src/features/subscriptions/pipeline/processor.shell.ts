import { DB, schema } from '#root/db/mod.js'
import { SelectPushSubscriptionACL } from '#root/features/subscriptions/subscriptions.adapter.js'
import { type StatementStoreError, StatementStoreService } from '@identity-backend/statement-store/live'
import { and, eq, inArray } from 'drizzle-orm'
import {
  Context,
  Duration,
  Effect,
  HashMap,
  HashSet,
  Layer,
  Match,
  Metric,
  Option,
  Redacted,
  Ref,
  Schedule,
  Schema as S,
  Stream,
} from 'effect'
import { fromHex, toHex } from 'polkadot-api/utils'
import {
  pushDeduplicationCounter,
  pushRateLimitCounter,
  SpanAttributes,
  subscriptionProcessingCounter,
} from '../telemetry.js'
import {
  type DeliveryPlan,
  PipelineRateLimitConfig,
  PipelineRateState,
  ProcessStatementCommand,
  PublicKey,
  StatementHash,
  Subscription,
  SubscriptionRule,
  type VerifiedStatement,
} from '../types.js'
import { PushDeliveryShell } from './delivery.shell.js'
import { buildRateLimitMap, calculateRateLimitOutput, DEFAULT_RATE_LIMIT_CONFIG } from './rate-limit.js'
import { processStatement as runProcessStatementPipeline } from './workflow.js'

export class StatementSubscriber extends Context.Tag('@app/StatementSubscriber')<
  StatementSubscriber,
  StatementStoreService['Type']['subscribeStatements']
>() {
  static readonly Default: Layer.Layer<StatementSubscriber, never, StatementStoreService> = Layer.effect(
    StatementSubscriber,
    Effect.map(StatementStoreService, (s) => s.subscribeStatements),
  )
}

const dbRetry = Schedule.exponential(Duration.millis(100), 2).pipe(
  Schedule.jittered,
  Schedule.compose(Schedule.recurs(3)),
)

const make = Effect.gen(function*() {
  const db = yield* DB
  const subscribeStatements = yield* StatementSubscriber
  const deliveryShell = yield* PushDeliveryShell

  const checkDuplicateRecords = Effect.fnUntraced(
    function*(subscriptionIds: readonly string[], statementHash: string) {
      return yield* Effect.tryPromise(() =>
        db
          .select({ statementHash: schema.pushRecord.statementHash })
          .from(schema.pushRecord)
          .where(
            and(
              inArray(schema.pushRecord.subscriptionId, subscriptionIds),
              eq(schema.pushRecord.statementHash, statementHash),
            ),
          )
      ).pipe(
        Effect.retry(dbRetry),
        Effect.orDie,
      )
    },
  )

  const fetchRateLimitState = Effect.fnUntraced(
    function*(senderPubkey: string, clientIds: readonly string[]) {
      return yield* Effect.tryPromise(() =>
        db
          .select()
          .from(schema.rateLimit)
          .where(
            and(
              eq(schema.rateLimit.senderPubkey, senderPubkey),
              inArray(schema.rateLimit.clientId, clientIds),
            ),
          )
      ).pipe(
        Effect.retry(dbRetry),
        Effect.orDie,
      )
    },
  )

  const findMatchingSubscriptionsBatch = Effect.fn('find_matching_subscriptions_batch')(
    function*(senderPubkey: string, topics: readonly string[]) {
      yield* Effect.annotateCurrentSpan({ [SpanAttributes.TOPIC_COUNT]: String(topics.length) })

      if (topics.length === 0) return []
      const rows = yield* Effect.tryPromise(() =>
        db
          .select({
            rule: schema.subscriptionRule,
            subscription: schema.pushSubscription,
          })
          .from(schema.subscriptionRule)
          .innerJoin(
            schema.pushSubscription,
            eq(schema.subscriptionRule.subscriptionId, schema.pushSubscription.id),
          )
          .where(
            and(
              eq(schema.subscriptionRule.senderPubkey, senderPubkey),
              inArray(schema.subscriptionRule.topic, topics),
            ),
          )
      ).pipe(
        Effect.retry(dbRetry),
        Effect.orDie,
      )
      return yield* Effect.all(
        rows.map((row) =>
          Effect.zip(
            S.decode(SelectPushSubscriptionACL)(row.subscription).pipe(Effect.orDie),
            S.decode(SubscriptionRule)({
              ...row.rule,
              senderPubkey: Redacted.make(PublicKey.make(fromHex(row.rule.senderPubkey))),
            }).pipe(Effect.orDie),
          ).pipe(
            Effect.map(([subscription, rule]) => ({ subscription, rule })),
          )
        ),
      )
    },
  )

  const processStatement = Effect.fnUntraced(
    function*(verified: VerifiedStatement) {
      yield* Metric.increment(subscriptionProcessingCounter)

      const topics = verified.topics
      const proofSignerHex = verified.proofSigner
      const senderPubkey = Redacted.make(PublicKey.make(fromHex(proofSignerHex)))
      const now = yield* Effect.clockWith((c) => c.currentTimeMillis)

      const allMatches = yield* findMatchingSubscriptionsBatch(
        proofSignerHex,
        topics,
      )

      if (allMatches.length === 0) return 0

      const subscriptionIds = [...HashSet.fromIterable(allMatches.map((m) => m.subscription.id))]
      const clientIds = [...HashSet.fromIterable(allMatches.map((m) => m.subscription.clientId))]

      const [existingPushRecordRows, rateLimitRows] = yield* Effect.all([
        checkDuplicateRecords(subscriptionIds, verified.statementHash),
        fetchRateLimitState(proofSignerHex, clientIds),
      ])

      const rateLimitMap = HashMap.fromIterable(buildRateLimitMap(rateLimitRows))

      const rateLimitConfig = yield* S.decode(PipelineRateLimitConfig)(DEFAULT_RATE_LIMIT_CONFIG).pipe(Effect.orDie)

      const cmd = new ProcessStatementCommand({
        rules: allMatches.map((m) => m.rule),
        existingHashes: yield* S.decodeUnknown(S.Array(StatementHash))(
          existingPushRecordRows.map((r) => r.statementHash),
        ).pipe(Effect.orDie),
        rateLimitConfig,
        now: new Date(now),
        statementHash: verified.statementHash,
      })

      const pipelineResult = runProcessStatementPipeline(cmd)

      return yield* Match.value(pipelineResult).pipe(
        Match.tag('NoMatches', () => Effect.succeed(0)),
        Match.tag(
          'Skip',
          (s) =>
            Effect.succeed(0).pipe(
              Effect.tap(() => {
                if (s.reason === 'duplicate') Metric.increment(pushDeduplicationCounter)
                return Effect.logDebug('Statement skipped', { 'skip.reason': s.reason })
              }),
            ),
        ),
        Match.tag('Deliver', (d) =>
          dispatchDeliveryPlans({
            plans: d.plans,
            allMatches,
            statementHash: verified.statementHash,
            statementData: toHex(verified.data),
            senderPubkey,
            rateLimitMap,
            rateLimitConfig,
            now,
          })),
        Match.exhaustive,
      )
    },
    Effect.scoped,
  )

  interface DispatchContext {
    readonly plans: readonly DeliveryPlan[]
    readonly allMatches: readonly { subscription: Subscription; rule: SubscriptionRule }[]
    readonly statementHash: StatementHash
    readonly statementData: string
    readonly senderPubkey: Redacted.Redacted<PublicKey>
    readonly rateLimitMap: HashMap.HashMap<string, { readonly windowStart: Date; readonly notificationCount: number }>
    readonly rateLimitConfig: S.Schema.Type<typeof PipelineRateLimitConfig>
    readonly now: number
  }

  const dispatchDeliveryPlans = (ctx: DispatchContext) => {
    const matchById = HashMap.fromIterable(ctx.allMatches.map((m) => [m.rule.id, m] as const))

    return Effect.gen(function*() {
      const delivered = yield* Ref.make(0)
      const failed = yield* Ref.make(0)

      for (const plan of ctx.plans) {
        const matchOption = HashMap.get(matchById, plan.ruleId)
        if (!Option.isSome(matchOption)) continue
        const match = matchOption.value

        const rawPlanRateState = Option.getOrUndefined(HashMap.get(ctx.rateLimitMap, match.subscription.clientId))
        if (rawPlanRateState) {
          const planRateState = yield* S.decodeUnknown(PipelineRateState)(rawPlanRateState).pipe(Effect.orDie)
          if (calculateRateLimitOutput(planRateState, new Date(ctx.now), ctx.rateLimitConfig) === 'blocked') {
            yield* Effect.annotateLogsScoped({
              [SpanAttributes.SUBSCRIPTION_ID]: match.subscription.id,
            })
            yield* Effect.logDebug('Subscription rate limited, skipping delivery')
            yield* Metric.increment(Metric.tagged(pushRateLimitCounter, 'reason', 'rate_limited'))
            continue
          }
        }

        const deliveredForPlan = yield* deliveryShell.deliverPlan({
          plan,
          subscription: match.subscription,
          rule: match.rule,
          statementHash: ctx.statementHash,
          statementData: ctx.statementData,
          // Statement pipeline carries opaque bytes; web push subscribers receive null
          // for the content body (existing behaviour: only broadcasts emit structured content).
          content: null,
          senderPubkey: ctx.senderPubkey,
          topic: plan.topic,
          rateState: Option.getOrUndefined(HashMap.get(ctx.rateLimitMap, match.subscription.clientId)),
          now: ctx.now,
        }).pipe(
          Effect.catchTags({
            PushDeliveryFailed: () => Effect.succeed(0),
            PushNotificationTokenInvalidError: () => Effect.succeed(0),
          }),
        )

        if (deliveredForPlan > 0) {
          yield* Ref.update(delivered, n => n + deliveredForPlan)
        } else {
          yield* Ref.update(failed, n => n + 1)
        }
      }

      const deliveredCount = yield* Ref.get(delivered)

      return deliveredCount
    }).pipe(
      Effect.scoped,
      Effect.withLogSpan('subscription.dispatch_delivery'),
    )
  }

  const subscribeToStatements = () => subscribeStatements()

  return SubscriptionDaemonShell.of({
    processStatement,
    subscribeToStatements,
  })
}).pipe(
  Effect.scoped,
)

export namespace SubscriptionDaemonShell {
  export interface Definition {
    readonly processStatement: (
      statement: VerifiedStatement,
    ) => Effect.Effect<number, never>
    readonly subscribeToStatements: () => Stream.Stream<VerifiedStatement, StatementStoreError>
  }
}

export class SubscriptionDaemonShell extends Context.Tag('@app/SubscriptionDaemonShell')<
  SubscriptionDaemonShell,
  SubscriptionDaemonShell.Definition
>() {
  static readonly DefaultWithoutDependencies = Layer.scoped(SubscriptionDaemonShell, make)

  static readonly Default = Layer.suspend(() =>
    SubscriptionDaemonShell.DefaultWithoutDependencies.pipe(
      Layer.provide(PushDeliveryShell.Default),
      Layer.provide(StatementSubscriber.Default),
    )
  )
}
