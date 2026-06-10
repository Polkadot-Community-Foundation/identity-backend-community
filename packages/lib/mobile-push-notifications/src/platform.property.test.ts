import { describe, it } from '@effect/vitest'
import { Effect, FastCheck as fc } from 'effect'
import { detectFromDeviceToken } from './platform.js'

const hexToken32to128 = fc.stringMatching(/^[0-9a-fA-F]{32,128}$/)

const nonIosToken = fc.oneof(
  fc.string({ minLength: 0, maxLength: 31 }),
  fc.string({ minLength: 129, maxLength: 300 }),
  fc.stringMatching(/^[a-zA-Z0-9_:-]{50,200}$/),
  fc.stringMatching(/^[0-9a-fA-F]{20}[^0-9a-fA-F][0-9a-fA-F]*$/),
)

describe('Platform Detection Property Tests', () => {
  describe('detectPlatformFromDeviceToken', () => {
    it.effect.prop(
      '→32≤len≤128∧Hex_Token_=IOS',
      [hexToken32to128],
      ([token]) => Effect.succeed(detectFromDeviceToken(token) === 'ios'),
      { fastCheck: { numRuns: 100 } },
    )

    it.effect.prop(
      '→¬IOSPattern_Token_=Android',
      [nonIosToken],
      ([token]) => Effect.succeed(detectFromDeviceToken(token) === 'android'),
      { fastCheck: { numRuns: 100 } },
    )
  })
})
