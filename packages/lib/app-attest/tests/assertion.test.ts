/**
 * @see {@link https://developer.apple.com/documentation/devicecheck/validating-apps-that-connect-to-your-server#Verify-the-assertion}
 */
import { verifyAssertion } from '@/assertion.js'
import { describe, expect, it } from '@effect/vitest'
import { sha256 } from '@noble/hashes/sha2.js'
import { decodeBase64 } from '@std/encoding'
import { Effect, Either } from 'effect'

describe('App Attest Assertion', async () => {
  const assertion = decodeBase64(
    'omlzaWduYXR1cmVYRzBFAiBB8BGAwkmFCg1M5J0mOYEun0SUN1/lse79/7ypG9WiMQIhAIHvqj7eg59B' +
      '1PMFX1CN4GMGlsgfFtdL30pHCf7G/dNRcWF1dGhlbnRpY2F0b3JEYXRhWCXKPdw7T3iujcFZbHVrHX0m' +
      'DSMrNms5PzEbrFbQPRA6rEAAAAAB',
  )
  const clientData = new TextEncoder().encode(
    '{"subject":"Lorem ipsum","message":"Lorem ipsum dolor sit amet, consectetur adipiscing elit."}',
  )
  const publicKey = await crypto.subtle.importKey(
    'spki',
    decodeBase64(
      'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEg69t2YzgcPTLUx8Zgu+rbcikeaEL8Ppb+HG0QTIulz8Y' +
        'UB9tgv1pDRruWk87nZC3our56pzIWaqXEbaWyamdzA==',
    ),
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['verify'],
  )

  const BUNDLE_IDENTIFIER = 'io.uebelacker.AppAttestExample'
  const TEAM_IDENTIFIER = 'V8H6LQ9448'
  const appId = `${TEAM_IDENTIFIER}.${BUNDLE_IDENTIFIER}`

  const runAssertion = (options: {
    readonly appIds?: readonly string[]
    readonly assertionBytes?: Uint8Array
    readonly signCount?: number
    readonly strictCryptoOption?: boolean
  }) =>
    verifyAssertion({
      appIds: options.appIds ?? [appId],
      buildClientDataHash: ({ payload }, config) =>
        Effect.sync(() => {
          if (options.strictCryptoOption && !config?.crypto) {
            return new Uint8Array(32)
          }
          return sha256(payload)
        }),
    })({
      assertion: options.assertionBytes ?? assertion,
      clientData,
      challenge: new Uint8Array(),
      publicKey,
      signCount: options.signCount ?? 0,
      clientId: new Uint8Array(32),
    })

  it.effect('Should_WorkWithExample_When_Apple', (c) =>
    Effect.gen(function*() {
      const assertionResult = yield* runAssertion({})

      c.expect(assertionResult).toEqual(1)
    }))

  it.effect('Should_FailWithVerifyAssertionError_When_SignatureInvalid', (c) =>
    Effect.gen(function*() {
      const tamperedAssertion = assertion.slice()
      const signatureByte = tamperedAssertion.at(20)
      if (signatureByte === undefined) {
        throw new Error('Expected fixture assertion to contain byte at index 20')
      }
      tamperedAssertion[20] = signatureByte ^ 0xff

      const result = yield* Effect.either(
        runAssertion({
          assertionBytes: tamperedAssertion,
        }),
      )

      c.expect(result).toEqual(Either.left(expect.objectContaining({})))
    }))

  it.effect('Should_FailWithVerifyAssertionError_When_AppIdDoesNotMatch', (c) =>
    Effect.gen(function*() {
      const result = yield* Effect.either(
        runAssertion({
          appIds: ['TEAM.WRONG_BUNDLE_ID'],
        }),
      )

      c.expect(result).toEqual(Either.left(expect.objectContaining({})))
    }))

  it.effect('Should_FailWithVerifyAssertionError_When_SignCountIsEqual', (c) =>
    Effect.gen(function*() {
      const result = yield* Effect.either(
        runAssertion({
          signCount: 1,
        }),
      )

      c.expect(result).toEqual(Either.left(expect.objectContaining({})))
    }))

  it.effect('Should_FailWithVerifyAssertionError_When_SignCountIsGreaterThanNextCount', (c) =>
    Effect.gen(function*() {
      const result = yield* Effect.either(
        runAssertion({
          signCount: 5,
        }),
      )

      c.expect(result).toEqual(Either.left(expect.objectContaining({})))
    }))

  it.effect('Should_UseCryptoOption_When_BuildingClientDataHash', (c) =>
    Effect.gen(function*() {
      const assertionResult = yield* runAssertion({
        strictCryptoOption: true,
      })

      c.expect(assertionResult).toEqual(1)
    }))

  it.effect('Should_FailWithDecodeAssertionError_When_AssertionCborIsMalformed', (c) =>
    Effect.gen(function*() {
      const result = yield* Effect.either(
        runAssertion({
          assertionBytes: new Uint8Array([0x58, 0x01]),
        }),
      )

      c.expect(result).toEqual(Either.left(expect.objectContaining({})))
    }))

  it.effect('Should_FailWithDecodeAssertionError_When_AssertionSchemaIsInvalid', (c) =>
    Effect.gen(function*() {
      const result = yield* Effect.either(
        runAssertion({
          assertionBytes: new Uint8Array([0x01]),
        }),
      )

      c.expect(result).toEqual(Either.left(expect.objectContaining({})))
    }))
})
