import { Context, Effect } from 'effect'
import type { ChallengeNotFoundError, ConsumeChallengeError, PersistChallengeError } from './types.js'

export class ChallengeService extends Context.Tag('ChallengeService')<ChallengeService, {
  makeChallenge: () => Effect.Effect<Uint8Array, never, never>
  persistChallenge: (_: Uint8Array) => Effect.Effect<void, PersistChallengeError>
  consumeChallenge: (_: Uint8Array) => Effect.Effect<void, ChallengeNotFoundError | ConsumeChallengeError>
}>() {}
