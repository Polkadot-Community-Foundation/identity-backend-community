import { DB } from '#root/db/drizzle.js'
import * as schema from '#root/db/schema.js'
import { RefreshTokenResponse, TokenResponse } from '#root/routes/v1/token/types.js'
import { describe, expect, it } from '@effect/vitest'
import { buildAttestationExtensionValue, issueAttestationChain } from '@identity-backend/android-attest/testing'
import { AuthService, ChallengeService } from '@identity-backend/auth/services'
import { sr25519 } from '@identity-backend/crypto'
import { checkResponse } from '@identity-backend/testing/hono'
import { encodeBase64 } from '@std/encoding'
import { ConfigProvider, Effect, Layer, TestClock } from 'effect'
import { decodeJwt } from 'jose'

import {
  createRefreshClient,
  createTokenClient,
  PAST_DATE,
  refreshTokenTestLayer,
  seedToken,
  TEST_NOW,
  testConfigJson,
  TOKEN_B,
} from './helpers/refresh-token-test-layer.js'

const cleanUp = Effect.andThen(DB, (db) =>
  Effect.promise(async () => {
    await db.delete(schema.refreshTokens).execute()
  })).pipe(Effect.orDie)

const issueTokenPair = Effect.gen(function*() {
  const authService = yield* AuthService
  const keypair = yield* sr25519.generateKeypair()
  const challenge = crypto.getRandomValues(new Uint8Array(24))
  const proofPayload = yield* authService.buildClientDataHash({
    payload: new TextEncoder().encode('{}'),
    challenge,
    clientId: keypair.publicKey,
  })
  const clientProof = yield* keypair.sign(proofPayload)

  const tokenClient = yield* createTokenClient
  const res = yield* Effect.promise(() =>
    tokenClient.index.$post({
      header: {
        'Auth-ClientId': encodeBase64(keypair.publicKey),
        'Auth-ClientProof': encodeBase64(clientProof),
        'Auth-Challenge': encodeBase64(challenge),
      },
      json: {},
    })
  )
  checkResponse(res, 200)
  return yield* Effect.promise(() => res.json() as Promise<{ token: string; refreshToken: string }>)
})

describe('TokenRoute', () => {
  it.layer(refreshTokenTestLayer)((it) => {
    it.scoped('Should_Return200WithTokenResponseSchema_When_ValidRequest', () =>
      Effect.gen(function*() {
        yield* Effect.addFinalizer(() => cleanUp)

        const body = yield* issueTokenPair
        expect(body).toEqual(expect.schemaMatching(TokenResponse))
      }))
  })
})

const PLAY_STORE_DIGEST_HEX = testConfigJson.ANDROID_SIGNING_DIGEST_PLAYSTORE.replace(/:/g, '').toLowerCase()
const WEBSITE_DIGEST_HEX = testConfigJson.ANDROID_SIGNING_DIGEST_WEBSITE.replace(/:/g, '').toLowerCase()
const ATTESTED_PACKAGE_NAME = 'io.pcf.polkadotapp'

const withTrustedRoot = (rootPem: string) =>
  Layer.setConfigProvider(ConfigProvider.fromJson({ ...testConfigJson, ANDROID_ATTESTATION_ROOT_PEMS: [rootPem] }))

const mintFakeAttestation = (challenge: Uint8Array, signingDigestHex: string) =>
  Effect.promise(() =>
    issueAttestationChain({
      extensionValue: buildAttestationExtensionValue({
        challenge,
        packageName: ATTESTED_PACKAGE_NAME,
        signingDigestHex,
      }),
    })
  )

const encodeChain = (
  chain: { leafCert: { rawData: ArrayBuffer }; intermediates: ReadonlyArray<{ rawData: ArrayBuffer }> },
) => [
  encodeBase64(new Uint8Array(chain.leafCert.rawData)),
  ...chain.intermediates.map((cert) => encodeBase64(new Uint8Array(cert.rawData))),
]

const postTokenWithAttestationChain = (params: {
  readonly keypair: { readonly publicKey: Uint8Array; readonly sign: (m: Uint8Array) => Effect.Effect<Uint8Array> }
  readonly challenge: Uint8Array
  readonly attestationChain: ReadonlyArray<string>
}) =>
  Effect.gen(function*() {
    const authService = yield* AuthService
    const body = { attestationChain: [...params.attestationChain] }
    const bodyBytes = new TextEncoder().encode(JSON.stringify(body))
    const proofPayload = yield* authService.buildClientDataHash({
      payload: bodyBytes,
      challenge: params.challenge,
      clientId: params.keypair.publicKey,
    })
    const clientProof = yield* params.keypair.sign(proofPayload)

    const tokenClient = yield* createTokenClient
    return yield* Effect.promise(() =>
      tokenClient.index.$post({
        header: {
          'Auth-ClientId': encodeBase64(params.keypair.publicKey),
          'Auth-ClientProof': encodeBase64(clientProof),
          'Auth-Challenge': encodeBase64(params.challenge),
          'Auth-Attestation-Type': 'key-attestation',
        },
        json: body,
      })
    )
  })

describe('TokenRoute Android attestation', () => {
  it.layer(refreshTokenTestLayer)((it) => {
    it.scoped('Should_IssueAndroidJwt_When_PlayStoreSignedAttestation', () =>
      Effect.gen(function*() {
        yield* Effect.addFinalizer(() => cleanUp)
        yield* TestClock.setTime(Date.now())

        const challengeService = yield* ChallengeService
        const challenge = yield* challengeService.makeChallenge()
        const chain = yield* mintFakeAttestation(challenge, PLAY_STORE_DIGEST_HEX)
        const keypair = yield* sr25519.generateKeypair()

        const res = yield* postTokenWithAttestationChain({
          keypair,
          challenge,
          attestationChain: encodeChain(chain),
        }).pipe(Effect.provide(withTrustedRoot(chain.rootPem)))

        const resText = yield* Effect.promise(() => res.text())
        expect(res.status, `Expected 200, got ${res.status}: ${resText}`).toBe(200)
        const body = JSON.parse(resText) as Record<string, unknown>
        const claims = decodeJwt(body.token as string)
        expect(claims.plt).toBe('android')
      }))

    it.scoped('Should_IssueAndroidJwt_When_WebsiteSignedAttestation', () =>
      Effect.gen(function*() {
        yield* Effect.addFinalizer(() => cleanUp)
        yield* TestClock.setTime(Date.now())

        const challengeService = yield* ChallengeService
        const challenge = yield* challengeService.makeChallenge()
        const chain = yield* mintFakeAttestation(challenge, WEBSITE_DIGEST_HEX)
        const keypair = yield* sr25519.generateKeypair()

        const res = yield* postTokenWithAttestationChain({
          keypair,
          challenge,
          attestationChain: encodeChain(chain),
        }).pipe(Effect.provide(withTrustedRoot(chain.rootPem)))

        checkResponse(res, 200)
        const body: Record<string, unknown> = yield* Effect.promise(() => res.json())
        const claims = decodeJwt(body.token as string)
        expect(claims.plt).toBe('android')
      }))

    it.scoped('Should_Return403_When_ChallengeNotMintedByServer', () =>
      Effect.gen(function*() {
        yield* Effect.addFinalizer(() => cleanUp)
        yield* TestClock.setTime(Date.now())

        const forgedChallenge = crypto.getRandomValues(new Uint8Array(56))
        const chain = yield* mintFakeAttestation(forgedChallenge, PLAY_STORE_DIGEST_HEX)
        const keypair = yield* sr25519.generateKeypair()

        const res = yield* postTokenWithAttestationChain({
          keypair,
          challenge: forgedChallenge,
          attestationChain: encodeChain(chain),
        }).pipe(Effect.provide(withTrustedRoot(chain.rootPem)))

        checkResponse(res, 403)
        const body: { type: string; title: string; detail: string; status: number } = yield* Effect.promise(
          () => res.json() as Promise<{ type: string; title: string; detail: string; status: number }>,
        )
        expect(res.headers.get('content-type')).toContain('application/problem+json')
        expect(body.status).toBe(403)
      }))

    it.scoped('Should_Return401_When_BodyTamperedAfterSigning', () =>
      Effect.gen(function*() {
        yield* Effect.addFinalizer(() => cleanUp)
        yield* TestClock.setTime(Date.now())

        const challengeService = yield* ChallengeService
        const challenge = yield* challengeService.makeChallenge()
        const keypair = yield* sr25519.generateKeypair()

        const authService = yield* AuthService
        const signedBody = { attestationChain: [] }
        const signedBytes = new TextEncoder().encode(JSON.stringify(signedBody))
        const proofPayload = yield* authService.buildClientDataHash({
          payload: signedBytes,
          challenge,
          clientId: keypair.publicKey,
        })
        const clientProof = yield* keypair.sign(proofPayload)

        const tamperedBody = {}
        const tokenClient = yield* createTokenClient
        const res = yield* Effect.promise(() =>
          tokenClient.index.$post({
            header: {
              'Auth-ClientId': encodeBase64(keypair.publicKey),
              'Auth-ClientProof': encodeBase64(clientProof),
              'Auth-Challenge': encodeBase64(challenge),
            },
            json: tamperedBody,
          })
        )

        checkResponse(res, 401)
        const body: { type: string; title: string; detail: string; status: number } = yield* Effect.promise(
          () => res.json() as Promise<{ type: string; title: string; detail: string; status: number }>,
        )
        expect(body.title).toBe('Client Proof Verification Failed')
      }))

    it.scoped('Should_Return400_When_KeyAttestationHeaderPresentButNoBodyChain', () =>
      Effect.gen(function*() {
        yield* Effect.addFinalizer(() => cleanUp)
        const authService = yield* AuthService
        const challenge = crypto.getRandomValues(new Uint8Array(24))
        const keypair = yield* sr25519.generateKeypair()
        const body = {}
        const bodyBytes = new TextEncoder().encode(JSON.stringify(body))
        const proofPayload = yield* authService.buildClientDataHash({
          payload: bodyBytes,
          challenge,
          clientId: keypair.publicKey,
        })
        const clientProof = yield* keypair.sign(proofPayload)
        const tokenClient = yield* createTokenClient

        const res = yield* Effect.promise(() =>
          tokenClient.index.$post({
            header: {
              'Auth-ClientId': encodeBase64(keypair.publicKey),
              'Auth-ClientProof': encodeBase64(clientProof),
              'Auth-Challenge': encodeBase64(challenge),
              'Auth-Attestation-Type': 'key-attestation',
            },
            json: body,
          })
        )

        checkResponse(res, 400)
      }))

    it.scoped('Should_NotIssueToken_When_KeyAttestationHeaderPresentButNoBodyChain', () =>
      Effect.gen(function*() {
        yield* Effect.addFinalizer(() => cleanUp)
        const authService = yield* AuthService
        const challenge = crypto.getRandomValues(new Uint8Array(24))
        const keypair = yield* sr25519.generateKeypair()
        const body = {}
        const bodyBytes = new TextEncoder().encode(JSON.stringify(body))
        const proofPayload = yield* authService.buildClientDataHash({
          payload: bodyBytes,
          challenge,
          clientId: keypair.publicKey,
        })
        const clientProof = yield* keypair.sign(proofPayload)
        const tokenClient = yield* createTokenClient

        const res = yield* Effect.promise(() =>
          tokenClient.index.$post({
            header: {
              'Auth-ClientId': encodeBase64(keypair.publicKey),
              'Auth-ClientProof': encodeBase64(clientProof),
              'Auth-Challenge': encodeBase64(challenge),
              'Auth-Attestation-Type': 'key-attestation',
            },
            json: body,
          })
        )

        expect(res.status).not.toBe(200)
      }))
  })
})

describe('RefreshRoute', () => {
  it.layer(refreshTokenTestLayer)((it) => {
    it.scoped('Should_Return200WithRefreshTokenResponseSchema_When_ValidRefresh', () =>
      Effect.gen(function*() {
        yield* Effect.addFinalizer(() => cleanUp)
        yield* TestClock.setTime(TEST_NOW.getTime())

        const { refreshToken } = yield* issueTokenPair
        const refreshClient = yield* createRefreshClient

        const res = yield* Effect.promise(() => refreshClient.token.refresh.$post({ json: { refreshToken } }))

        checkResponse(res, 200)
        const body = yield* Effect.promise(() => res.json())
        expect(body).toEqual(expect.schemaMatching(RefreshTokenResponse))
      }))

    it.scoped('Should_Return401_When_RefreshTokenExpired', () =>
      Effect.gen(function*() {
        const db = yield* DB
        yield* Effect.addFinalizer(() => cleanUp)
        yield* TestClock.setTime(TEST_NOW.getTime())

        yield* seedToken(db, { tokenHash: TOKEN_B.hash, expiresAt: PAST_DATE })

        const refreshClient = yield* createRefreshClient
        const res = yield* Effect.promise(() =>
          refreshClient.token.refresh.$post({ json: { refreshToken: TOKEN_B.base64 } })
        )

        checkResponse(res, 401)
        expect(res.headers.get('content-type')).toContain('application/problem+json')
      }))

    it.scoped('Should_Return400_When_RefreshTokenMissing', () =>
      Effect.gen(function*() {
        yield* Effect.addFinalizer(() => cleanUp)

        const refreshClient = yield* createRefreshClient

        const res = yield* Effect.promise(() =>
          // @ts-expect-error -- intentionally omitting refreshToken
          refreshClient.token.refresh.$post({ json: {} })
        )

        checkResponse(res, 400)
      }))
  })
})
