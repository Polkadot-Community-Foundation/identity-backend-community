import {
  ClassificationToAction,
  ClassifyTokenCommand,
  ClassifyTokenInput,
  RefreshAction,
  TokenClassification,
} from '#root/jwt/core/jwt.types.js'
import { describe, it } from '@effect/vitest'
import { Effect, Either, FastCheck as fc, Option, Schema as S } from 'effect'

const safeDate = fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') })

const revokedAndExpiredInput = fc.tuple(safeDate, safeDate).chain(([revokedAt, now]) =>
  fc.integer({ min: 1, max: 86_400_000 }).map((ms) =>
    ClassifyTokenInput.make({
      revokedAt: Option.some(revokedAt),
      expiresAt: new Date(now.getTime() - ms),
      now,
    })
  )
)

const expiredInput = safeDate.chain((now) =>
  fc.integer({ min: 1, max: 86_400_000 }).map((ms) =>
    ClassifyTokenInput.make({
      revokedAt: Option.none(),
      expiresAt: new Date(now.getTime() - ms),
      now,
    })
  )
)

const validInput = safeDate.chain((now) =>
  fc.integer({ min: 0, max: 86_400_000 }).map((ms) =>
    ClassifyTokenInput.make({
      revokedAt: Option.none(),
      expiresAt: new Date(now.getTime() + ms),
      now,
    })
  )
)

const anyInput = fc.oneof(revokedAndExpiredInput, expiredInput, validInput)

const classify = S.encode(ClassifyTokenCommand)
const toAction = S.encode(ClassificationToAction)

describe('validateRefreshToken', () => {
  it.effect.prop(
    '→x_PrioritizeReuseOverExpiryBothConditionsHold_=x',
    [revokedAndExpiredInput],
    ([input]) =>
      Effect.gen(function*() {
        const result = yield* classify(input)
        return result === 'revoked'
      }),
    { fastCheck: { numRuns: process.env.CI ? 1000 : 100 } },
  )
})

describe('ClassifyTokenCommand', () => {
  it.effect.prop(
    '→x_PrioritizeRevokedOverExpiredBothConditionsHold_=x',
    [revokedAndExpiredInput],
    ([input]) =>
      Effect.gen(function*() {
        const result = yield* classify(input)
        return result === 'revoked'
      }),
    { fastCheck: { numRuns: process.env.CI ? 1000 : 100 } },
  )

  it.effect.prop('∀x_AlwaysClassifyAnyValidInput_=x', [anyInput], ([input]) =>
    Effect.gen(function*() {
      const result = yield* Effect.either(classify(input))
      return Either.isRight(result)
    }))

  it.effect.prop('∀x_ReturnValidNotRevokedAndNotExpired_=x', [validInput], ([input]) =>
    Effect.gen(function*() {
      return (yield* classify(input)) === 'valid'
    }))

  it.effect.prop('∀x_ReturnExpiredNotRevokedAndExpired_=x', [expiredInput], ([input]) =>
    Effect.gen(function*() {
      return (yield* classify(input)) === 'expired'
    }))

  it.effect.prop(
    '∀x_ReturnRevokedRevokedRegardlessOfExpiry_=x',
    [revokedAndExpiredInput],
    ([input]) =>
      Effect.gen(function*() {
        return (yield* classify(input)) === 'revoked'
      }),
  )
})

describe('ClassificationToAction', () => {
  it.effect.prop('∀x_MapToUniqueActionAnyClassification_=x', [anyInput], ([input]) =>
    Effect.gen(function*() {
      const classification = yield* classify(input)
      const action = yield* toAction(classification)
      const expected = { valid: 'rotate', expired: 'reject', revoked: 'revoke-family' } as const
      return action === expected[classification]
    }))

  it.effect.prop(
    '∀x_BeABijectionMappingClassificationToAction_=x',
    [fc.constantFrom<S.Schema.Type<typeof TokenClassification>>('valid', 'expired', 'revoked')],
    ([classification]) =>
      Effect.gen(function*() {
        const action = yield* toAction(classification)
        const inverseMap = { rotate: 'valid', reject: 'expired', 'revoke-family': 'revoked' } as const
        return inverseMap[action as S.Schema.Type<typeof RefreshAction>] === classification
      }),
  )
})
