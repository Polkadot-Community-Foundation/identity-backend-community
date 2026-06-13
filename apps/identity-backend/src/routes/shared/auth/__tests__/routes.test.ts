import { it } from '@effect/vitest'
import { VerifyAttestationError } from '@identity-backend/app-attest/Attestation'
import { AppAttestError, ChallengeRejectedError } from '@identity-backend/auth/services'
import { checkResponse } from '@identity-backend/testing/hono'
import { encodeBase64 } from '@std/encoding'
import { Effect, Layer, pipe } from 'effect'
import { UnknownException } from 'effect/Cause'
import { Hono } from 'hono'
import { testClient } from 'hono/testing'
import { afterEach, describe, expect, vi } from 'vitest'
import { AuthRoutesConfig, makeAuthRoutesWithoutDependencies } from '../routes.js'

describe('AuthRoutes', () => {
  const textEncoder = new TextEncoder()
  const makeChallenge = vi.fn<AuthRoutesConfig['Type']['makeChallenge']>()
  const verifyAttestation = vi.fn<AuthRoutesConfig['Type']['verifyAttestation']>()
  const persistAttestation = vi.fn<AuthRoutesConfig['Type']['persistAttestation']>()

  const createPublicKey = Effect.promise(async () => {
    const keyPair = await crypto.subtle.generateKey(
      {
        name: 'ECDSA',
        namedCurve: 'P-256',
      },
      false,
      ['sign', 'verify'],
    )
    const rawKey = await crypto.subtle.exportKey('spki', keyPair.publicKey)
    return new Uint8Array(rawKey)
  })

  const config = Layer.succeed(
    AuthRoutesConfig,
    {
      makeChallenge,
      verifyAttestation,
      persistAttestation,
    },
  )

  afterEach(() => {
    makeChallenge.mockReset()
    verifyAttestation.mockReset()
    persistAttestation.mockReset()
  })

  const makeClient = Effect.gen(function*() {
    const routes = yield* makeAuthRoutesWithoutDependencies()

    return yield* Effect.sync(() => {
      const app = new Hono()
        .route('/', routes)

      return testClient(app)
    })
  })

  describe('/challenges', () => {
    it.effect('Should_CreateChallenge_When_ValidRequest', (c) =>
      Effect.gen(function*() {
        const client = yield* makeClient

        const challenge = yield* pipe(
          Effect.sync(() => textEncoder.encode('testChallenge')),
          Effect.tap((c) => {
            makeChallenge.mockImplementation(() => Effect.succeed(c))
          }),
        )

        const res = yield* Effect.promise(() => client.challenges.$post(undefined))
        checkResponse(res, 201)
        const resBody = yield* Effect.promise(() => res.json())
        c.expect(resBody).toEqual({ challenge: encodeBase64(challenge) })
        c.expect(makeChallenge).toHaveBeenCalled()
      }).pipe(
        Effect.provide(config),
      ))
  })

  describe('/app-attest/attestations', () => {
    it.effect('Should_VerifyAndPersistAttestation_When_ValidAttestation', (c) =>
      Effect.gen(function*() {
        const client = yield* makeClient

        const keyId = new Uint8Array([1, 2, 3, 4])
        const challenge = new Uint8Array([5, 6, 7, 8])
        const attestation = new Uint8Array([9, 10, 11, 12])
        const publicKey = yield* createPublicKey
        const mockReceipt = new Uint8Array([17, 18, 19, 20])

        verifyAttestation.mockImplementation(() => Effect.succeed({ publicKey, receipt: mockReceipt }))
        persistAttestation.mockImplementation(() => Effect.void)

        const res = yield* Effect.promise(() =>
          client['app-attest'].attestations.$post({
            json: {
              keyId: encodeBase64(keyId),
              challenge: encodeBase64(challenge),
              attestation: encodeBase64(attestation),
            },
          })
        )

        checkResponse(res, 202)
        c.expect(verifyAttestation).toHaveBeenCalledWith(
          c.expect.objectContaining({
            keyId,
            challenge,
            attestation,
          }),
        )
        c.expect(persistAttestation).toHaveBeenCalledWith(
          {
            attestation: c.expect.objectContaining({
              keyId,
              publicKey,
              receipt: mockReceipt,
            }),
            challenge,
          },
        )
      }).pipe(
        Effect.provide(config),
      ))

    it.effect('Should_Return401_When_AttestationVerificationFails', () =>
      Effect.gen(function*() {
        const client = yield* makeClient

        verifyAttestation.mockImplementation(() =>
          AppAttestError.make(new VerifyAttestationError({ cause: new UnknownException('invalid') }))
        )

        const res = yield* Effect.tryPromise(() =>
          client['app-attest'].attestations.$post({
            json: {
              keyId: encodeBase64(new Uint8Array([1])),
              challenge: encodeBase64(new Uint8Array([2])),
              attestation: encodeBase64(new Uint8Array([3])),
            },
          })
        )

        checkResponse(res, 401)
        const body = yield* Effect.promise(() => res.json())
        expect(body).toEqual(expect.objectContaining({
          _tag: 'VERIFY_ATTESTATION_FAILED',
        }))
      }).pipe(
        Effect.provide(config),
      ))

    it.effect('Should_Return401_When_ChallengeNotFound', () =>
      Effect.gen(function*() {
        const client = yield* makeClient

        verifyAttestation.mockImplementation(() =>
          Effect.gen(function*() {
            const publicKey = yield* createPublicKey
            return { publicKey, receipt: new Uint8Array([2]) }
          })
        )
        persistAttestation.mockImplementation(() => Effect.fail(ChallengeRejectedError.make({ reason: 'expired' })))

        const res = yield* Effect.promise(() =>
          client['app-attest'].attestations.$post({
            json: {
              keyId: encodeBase64(new Uint8Array([1])),
              challenge: encodeBase64(new Uint8Array([2])),
              attestation: encodeBase64(new Uint8Array([3])),
            },
          })
        )

        checkResponse(res, 401)
        const body = yield* Effect.promise(() => res.json())
        expect(body).toEqual(expect.objectContaining({
          _tag: 'CHALLENGE_NOT_FOUND',
        }))
      }).pipe(
        Effect.provide(config),
      ))
  })
})
