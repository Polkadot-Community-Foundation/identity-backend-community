import { Effect, Stream } from 'effect'
import type { Duration } from 'effect'
import type { ChildPolicyConfig, LockConfig, TickPolicyConfig, TickPolicyHooks, Worker } from './daemon-spec.js'
import { WorkerTypeId } from './daemon-spec.js'

export interface CommonOpts<L extends LockConfig> {
  readonly name: string
  readonly child?: typeof ChildPolicyConfig.Type
  readonly tick: typeof TickPolicyConfig.Type
  readonly tickHooks?: TickPolicyHooks
  readonly lock: L
}

const make = <E, R, L extends LockConfig>(
  common: CommonOpts<L>,
  loop: Worker<E, R>['loop'],
): Worker<E, R, L> => ({
  [WorkerTypeId]: WorkerTypeId,
  name: common.name,
  loop,
  child: common.child ?? {},
  tick: common.tick,
  tickHooks: common.tickHooks ?? {},
  lock: common.lock,
})

export const poll = <A, E, R, L extends LockConfig>(
  opts: CommonOpts<L> & {
    readonly work: Effect.Effect<A, E, R>
    readonly interval: Duration.DurationInput
  },
): Worker<E, R, L> => make(opts, { _tag: 'Poll', work: Effect.asVoid(opts.work), interval: opts.interval })

export const stream = <A, E, R, L extends LockConfig>(
  opts: CommonOpts<L> & {
    readonly stream: Stream.Stream<A, E, R>
  },
): Worker<E, R, L> =>
  make(opts, {
    _tag: 'Stream',
    stream: opts.stream,
  })

export const subscription = <A, E, R, L extends LockConfig>(
  opts: CommonOpts<L> & {
    readonly acquire: Effect.Effect<A, E, R>
  },
): Worker<E, R, L> => make(opts, { _tag: 'Subscription', acquire: Effect.asVoid(opts.acquire) })

export const Daemon = {
  poll,
  stream,
  subscription,
} as const
