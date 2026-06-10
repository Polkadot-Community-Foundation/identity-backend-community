import { DB } from '@identity-backend/db'
import { Context, Effect, Either, Exit, Layer, Metric, Runtime, Schema as S } from 'effect'

import { dotToPlanck } from '#root/schema/balance.js'
import { Option as O } from 'effect'
import { AlreadyInQueueError, CandidateAccountId, QueueEntryId, QueueFullError } from './entry.schema.js'
import { queueEnqueueFailures, queueEnqueueTotal } from './metrics.js'
import { RegistrationQueueNetworkConfig } from './network.config.js'
import { QueuePriorityRules } from './priority-group.schema.js'
import { countQueuedEntries, getQueuePosition, insertEntry } from './store.js'

export class UsernameRegistrationEnqueueRuntimeConfig
  extends Context.Reference<UsernameRegistrationEnqueueRuntimeConfig>()(
    'EnqueueQueueCapacityConfig',
    {
      defaultValue: () => ({
        maxQueueSize: 100_000,
        rules: S.decodeSync(QueuePriorityRules)({
          initialGroup: 1,
          balanceThresholds: [
            { group: 4, minBalance: dotToPlanck(1000n) },
            { group: 3, minBalance: dotToPlanck(100n) },
            { group: 2, minBalance: dotToPlanck(10n) },
          ],
          slots: [
            { id: 1, eligibleGroups: [4] },
            { id: 2, eligibleGroups: [4, 3] },
            { id: 3, eligibleGroups: [4, 3, 2] },
            { id: 4, eligibleGroups: [4, 3, 2, 1] },
          ],
        }),
      }),
    },
  )
{}

export class UsernameRegistrationEnqueueConfig extends Context.Tag('UsernameRegistrationEnqueueConfig')<
  UsernameRegistrationEnqueueConfig,
  { network: string }
>() {}

export class EnqueueCommand extends S.Class<EnqueueCommand>('EnqueueCommand')({
  username: S.String,
  candidateAccountId: CandidateAccountId,
}) {}

export class EnqueueOutput extends S.Class<EnqueueOutput>('EnqueueOutput')({
  id: QueueEntryId,
  position: S.Union(S.Null, S.Number),
}) {}

export namespace EnqueueUsernameRegistrationUseCase {
  export type Definition = (
    input: EnqueueCommand,
  ) => Effect.Effect<EnqueueOutput, QueueFullError | AlreadyInQueueError>
}

const make = Effect.gen(function*() {
  const db = yield* DB
  const { maxQueueSize, rules: priorityConfig } = yield* UsernameRegistrationEnqueueRuntimeConfig
  const { network } = yield* UsernameRegistrationEnqueueConfig
  const runPromise = Runtime.runPromise(yield* Effect.runtime())

  const enqueue: EnqueueUsernameRegistrationUseCase.Definition = (input) =>
    Effect.async<EnqueueOutput, QueueFullError | AlreadyInQueueError>((resume) => {
      db.transaction(
        async (tx) => {
          const exit = await runPromise(
            Effect.gen(function*() {
              const now = yield* Effect.clockWith((clock) => clock.currentTimeMillis)
              const queueSize = yield* countQueuedEntries().pipe(Effect.orDie)
              if (queueSize >= maxQueueSize) {
                return yield* Effect.fail(new QueueFullError({ capacity: maxQueueSize }))
              }

              const entry = yield* insertEntry({
                candidateAccountId: input.candidateAccountId,
                username: input.username,
                priorityGroup: priorityConfig.initialGroup,
                network,
                enqueuedAt: new Date(now),
                updatedAt: null,
              })

              const position = yield* getQueuePosition(entry.id).pipe(Effect.orDie)

              return yield* S.decode(EnqueueOutput)({
                id: entry.id,
                position: O.getOrNull(position),
              }).pipe(Effect.orDie)
            }).pipe(
              Effect.provideService(DB, tx),
              Effect.either,
              Effect.exit,
            ),
          )

          if (Exit.isFailure(exit)) {
            resume(Effect.die(exit.cause))
            return
          }

          const either = exit.value
          if (Either.isRight(either)) {
            resume(Effect.succeed(either.right))
            return
          }

          resume(Effect.fail(either.left))
        },
      ).catch((error) => resume(Effect.die(error)))
    }).pipe(
      Effect.ensuring(Metric.increment(queueEnqueueTotal)),
      Effect.tapErrorCause(() => Metric.increment(queueEnqueueFailures)),
    )

  return EnqueueUsernameRegistrationUseCase.of(enqueue)
})

export class EnqueueUsernameRegistrationUseCase extends Context.Tag('EnqueueUsernameRegistrationUseCase')<
  EnqueueUsernameRegistrationUseCase,
  EnqueueUsernameRegistrationUseCase.Definition
>() {
  static readonly DefaultWithoutDependencies = Layer.effect(EnqueueUsernameRegistrationUseCase, make)

  static readonly Default = Layer.suspend(() =>
    Layer.provideMerge(
      EnqueueUsernameRegistrationUseCase.DefaultWithoutDependencies,
      Layer.provideMerge(
        Layer.effect(
          UsernameRegistrationEnqueueConfig,
          Effect.gen(function*() {
            const { network } = yield* RegistrationQueueNetworkConfig
            return { network } satisfies UsernameRegistrationEnqueueConfig['Type']
          }),
        ),
        RegistrationQueueNetworkConfig.Default,
      ),
    )
  )
}
