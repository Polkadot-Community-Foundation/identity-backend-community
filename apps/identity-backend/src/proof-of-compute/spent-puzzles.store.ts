import { Clock, Effect, HashMap, Option, Ref } from 'effect'
import type { SessionId } from './proof-of-compute.schema.js'

export interface SpentPuzzles {
  readonly entries: HashMap.HashMap<SessionId, Date>
  readonly nextSweepMs: number
  readonly sweepIntervalMs: number
}

export const makeSpentPuzzles = (sweepIntervalMs: number): SpentPuzzles => ({
  entries: HashMap.empty<SessionId, Date>(),
  nextSweepMs: 0,
  sweepIntervalMs,
})

export const tryConsume = (
  state: Ref.Ref<SpentPuzzles>,
  sessionId: SessionId,
  expiresAt: Date,
): Effect.Effect<boolean> =>
  Effect.gen(function*() {
    const now = yield* Clock.currentTimeMillis
    return yield* Ref.modify(state, (cache) => {
      const live = Option.match(HashMap.get(cache.entries, sessionId), {
        onNone: () => false,
        onSome: (expiry) => expiry.getTime() > now,
      })
      if (live) {
        return [false, cache] as const
      }
      // An entry is only removable once expired, so sweeping more often than the validity window
      // (ttl + skew) is wasted work; amortize the O(n) filter to once per window.
      const dueForSweep = now >= cache.nextSweepMs
      const retained = dueForSweep
        ? HashMap.filter(cache.entries, (expiry) => expiry.getTime() > now)
        : cache.entries
      return [
        true,
        {
          ...cache,
          entries: HashMap.set(retained, sessionId, expiresAt),
          nextSweepMs: dueForSweep ? now + cache.sweepIntervalMs : cache.nextSweepMs,
        },
      ] as const
    })
  })
