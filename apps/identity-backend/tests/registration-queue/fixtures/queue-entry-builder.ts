import { PriorityGroup } from '#root/username-registration/registration-queue/priority-group.schema.js'
import { Clock, Effect } from 'effect'

export type QueueEntryBuildState = {
  readonly seed: number
  readonly priorityGroup: PriorityGroup
  readonly username: string | undefined
  readonly candidateAccountId: string | undefined
  readonly enqueuedAt: Date | undefined
}

export type QueueEntryBuilder = {
  readonly withPriorityGroup: (group: PriorityGroup) => QueueEntryBuilder
  readonly withUsername: (username: string) => QueueEntryBuilder
  readonly withCandidateAccountId: (id: string) => QueueEntryBuilder
  readonly withEnqueuedAt: (date: Date) => QueueEntryBuilder
  readonly build: () => Effect.Effect<QueueEntryBuildResult>
}

export type QueueEntryBuildResult = {
  candidateAccountId: string
  username: string
  priorityGroup: PriorityGroup
  enqueuedAt: Date
}

const makeBuilder = (state: QueueEntryBuildState): QueueEntryBuilder => ({
  withPriorityGroup: (group) => makeBuilder({ ...state, priorityGroup: group }),
  withUsername: (username) => makeBuilder({ ...state, username }),
  withCandidateAccountId: (id) => makeBuilder({ ...state, candidateAccountId: id }),
  withEnqueuedAt: (date) => makeBuilder({ ...state, enqueuedAt: date }),
  build: () => buildEntry(state),
})

export const addressFromSeed = (seed: number): string => `0x${seed.toString(16).padStart(2, '0').repeat(32)}`

const buildEntry = (state: QueueEntryBuildState): Effect.Effect<QueueEntryBuildResult> =>
  Effect.gen(function*() {
    const now = yield* Clock.currentTimeMillis
    return {
      candidateAccountId: state.candidateAccountId ?? addressFromSeed(state.seed),
      username: state.username ?? `user${state.seed}`,
      priorityGroup: state.priorityGroup,
      enqueuedAt: state.enqueuedAt ?? new Date(now),
    }
  })

export const QueueEntryBuilder = {
  fromSeed: (seed: number): QueueEntryBuilder =>
    makeBuilder({
      seed,
      priorityGroup: PriorityGroup.make(1),
      username: undefined,
      candidateAccountId: undefined,
      enqueuedAt: undefined,
    }),
}
