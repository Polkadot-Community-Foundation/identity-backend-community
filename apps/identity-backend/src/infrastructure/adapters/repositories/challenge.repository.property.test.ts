import { DBTest } from '#root/db/drizzle.js'
import { afterEach, describe, expect, it, type Mock, vi } from '@effect/vitest'
import { ChallengeService } from '@identity-backend/auth/services'
import { Effect, Layer, Schema as S } from 'effect'
import { ChallengeServiceLiveConfig, ChallengeServiceLiveWithoutDependencies } from './challenge.repository.js'

describe('ChallengeService', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  const getRandomValues_ = vi.fn()
  const getRandomValues = getRandomValues_ satisfies Mock<ChallengeServiceLiveConfig['Type']['getRandomValues']>

  const layer = Layer.provide(
    ChallengeServiceLiveWithoutDependencies,
    Layer.mergeAll(
      Layer.succeed(ChallengeServiceLiveConfig, {
        getRandomValues,
        ttlSeconds: 300,
      }),
      DBTest,
    ),
  )

  it.layer(layer)((it) => {
    it.effect.prop(
      '∀x_Generate16ByteChallenge_=x',
      [S.Uint8Array],
      ([mockChallenge]) =>
        Effect.gen(function*() {
          vi.clearAllMocks()

          const expectedChallenge = new Uint8Array(16)
          expectedChallenge.set(mockChallenge.slice(0, Math.min(mockChallenge.length, 16)))
          getRandomValues.mockImplementation((array) => {
            array.set(mockChallenge.slice(0, Math.min(mockChallenge.length, array.length)))
            return array
          })

          const challengeService = yield* ChallengeService

          const challenge = yield* challengeService.makeChallenge()

          expect(challenge).toStrictEqual(expectedChallenge)
        }),
    )
  })
})
