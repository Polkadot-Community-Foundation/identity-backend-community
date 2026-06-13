// Contract test in oracle-substitute form. The real attestation issuer is
// Apple Secure Enclave hardware, which cannot run locally, so a pairwise
// Fake-vs-Real issuer comparison is impossible. The production verifiers
// (verifyAttestation / verifyAssertion) are the oracle: the issuer is faithful
// iff its output earns the same verdict a hardware-issued attestation would.
// Residual risk: structure a hardware attestation carries that the verifier
// does not inspect is not exercised here.

import { describe, expect, it } from '@effect/vitest'
import { sha256 } from '@noble/hashes/sha2.js'
import { concat } from '@std/bytes'
import { Effect, Either } from 'effect'
import { verifyAssertion } from '../src/assertion.js'
import { verifyAttestation } from '../src/attestation.js'
import { issueAppleAssertion, issueAppleAttestation } from '../src/testing/mod.js'

const APP_ID = 'ABCDE12345.io.example.app'
const WRONG_APP_ID = 'ZZZZZ99999.io.example.other'

const buildClientDataHash = (
  params: { readonly payload: Uint8Array; readonly challenge: Uint8Array; readonly clientId: Uint8Array },
) => Effect.sync(() => sha256(concat([params.challenge, params.clientId, sha256(params.payload)])))

const randomBytes = (length: number): Uint8Array => crypto.getRandomValues(new Uint8Array(length))

describe('Apple App Attest issuance contract', () => {
  it.effect('Should_VerifyAttestation_When_IssuedByTestAuthority', () =>
    Effect.gen(function*() {
      const challenge = randomBytes(56)
      const issued = yield* Effect.promise(() => issueAppleAttestation({ appId: APP_ID, challenge }))

      const result = yield* verifyAttestation({
        appIds: [APP_ID],
        rootCert: issued.rootPem,
        now: Effect.succeed(new Date()),
      })({
        attestation: issued.attestation,
        challenge,
        keyId: issued.keyId,
      })

      expect(result.publicKey).toBeInstanceOf(Uint8Array)
    }))

  it.effect('Should_RejectAttestation_When_ChallengeDiffersFromAttested', () =>
    Effect.gen(function*() {
      const challenge = randomBytes(56)
      const issued = yield* Effect.promise(() => issueAppleAttestation({ appId: APP_ID, challenge }))

      const result = yield* Effect.either(
        verifyAttestation({ appIds: [APP_ID], rootCert: issued.rootPem, now: Effect.succeed(new Date()) })({
          attestation: issued.attestation,
          challenge: randomBytes(56),
          keyId: issued.keyId,
        }),
      )

      expect(result).toEqual(Either.left(expect.objectContaining({})))
    }))

  it.effect('Should_RejectAttestation_When_AppIdDoesNotMatch', () =>
    Effect.gen(function*() {
      const challenge = randomBytes(56)
      const issued = yield* Effect.promise(() => issueAppleAttestation({ appId: APP_ID, challenge }))

      const result = yield* Effect.either(
        verifyAttestation({ appIds: [WRONG_APP_ID], rootCert: issued.rootPem, now: Effect.succeed(new Date()) })({
          attestation: issued.attestation,
          challenge,
          keyId: issued.keyId,
        }),
      )

      expect(result).toEqual(Either.left(expect.objectContaining({})))
    }))

  it.effect('Should_RejectAttestation_When_CredentialCertificateIsExpired', () =>
    Effect.gen(function*() {
      const challenge = randomBytes(56)
      const issued = yield* Effect.promise(() =>
        issueAppleAttestation({
          appId: APP_ID,
          challenge,
          notBefore: new Date('2019-01-01'),
          notAfter: new Date('2020-01-01'),
        })
      )

      const result = yield* Effect.either(
        verifyAttestation({ appIds: [APP_ID], rootCert: issued.rootPem, now: Effect.succeed(new Date('2021-01-01')) })({
          attestation: issued.attestation,
          challenge,
          keyId: issued.keyId,
        }),
      )

      expect(result).toEqual(Either.left(expect.objectContaining({})))
    }))

  it.effect('Should_VerifyAssertion_When_IssuedByTestAuthority', () =>
    Effect.gen(function*() {
      const issued = yield* Effect.promise(() => issueAppleAttestation({ appId: APP_ID, challenge: randomBytes(56) }))
      const challenge = randomBytes(56)
      const clientId = randomBytes(32)
      const clientData = new TextEncoder().encode('{}')
      const assertion = yield* Effect.promise(() =>
        issueAppleAssertion({ credKey: issued.credKey, appId: APP_ID, challenge, clientData, clientId, signCount: 1 })
      )

      const nextSignCount = yield* verifyAssertion({ appIds: [APP_ID], buildClientDataHash })({
        publicKey: issued.credKey.publicKey,
        challenge,
        clientData,
        assertion,
        clientId,
        signCount: 0,
      })

      expect(nextSignCount).toBe(1)
    }))

  it.effect('Should_RejectAssertion_When_ClientDataIsTampered', () =>
    Effect.gen(function*() {
      const issued = yield* Effect.promise(() => issueAppleAttestation({ appId: APP_ID, challenge: randomBytes(56) }))
      const challenge = randomBytes(56)
      const clientId = randomBytes(32)
      const assertion = yield* Effect.promise(() =>
        issueAppleAssertion({
          credKey: issued.credKey,
          appId: APP_ID,
          challenge,
          clientData: new TextEncoder().encode('{}'),
          clientId,
          signCount: 1,
        })
      )

      const result = yield* Effect.either(
        verifyAssertion({ appIds: [APP_ID], buildClientDataHash })({
          publicKey: issued.credKey.publicKey,
          challenge,
          clientData: new TextEncoder().encode('{"tampered":true}'),
          assertion,
          clientId,
          signCount: 0,
        }),
      )

      expect(result).toEqual(Either.left(expect.objectContaining({})))
    }))

  it.effect('Should_RejectAssertion_When_AppIdDoesNotMatch', () =>
    Effect.gen(function*() {
      const issued = yield* Effect.promise(() => issueAppleAttestation({ appId: APP_ID, challenge: randomBytes(56) }))
      const challenge = randomBytes(56)
      const clientId = randomBytes(32)
      const clientData = new TextEncoder().encode('{}')
      const assertion = yield* Effect.promise(() =>
        issueAppleAssertion({ credKey: issued.credKey, appId: APP_ID, challenge, clientData, clientId, signCount: 1 })
      )

      const result = yield* Effect.either(
        verifyAssertion({ appIds: [WRONG_APP_ID], buildClientDataHash })({
          publicKey: issued.credKey.publicKey,
          challenge,
          clientData,
          assertion,
          clientId,
          signCount: 0,
        }),
      )

      expect(result).toEqual(Either.left(expect.objectContaining({})))
    }))

  it.effect('Should_RejectAssertion_When_SignCountDoesNotIncrease', () =>
    Effect.gen(function*() {
      const issued = yield* Effect.promise(() => issueAppleAttestation({ appId: APP_ID, challenge: randomBytes(56) }))
      const challenge = randomBytes(56)
      const clientId = randomBytes(32)
      const clientData = new TextEncoder().encode('{}')
      const assertion = yield* Effect.promise(() =>
        issueAppleAssertion({ credKey: issued.credKey, appId: APP_ID, challenge, clientData, clientId, signCount: 5 })
      )

      const result = yield* Effect.either(
        verifyAssertion({ appIds: [APP_ID], buildClientDataHash })({
          publicKey: issued.credKey.publicKey,
          challenge,
          clientData,
          assertion,
          clientId,
          signCount: 5,
        }),
      )

      expect(result).toEqual(Either.left(expect.objectContaining({})))
    }))
})
