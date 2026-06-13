import { DB, DBTest } from '#root/db/drizzle.js'
import * as schema from '#root/db/schema.js'
import { ChallengeServiceLive } from '#root/infrastructure/adapters/challenge.service.js'
import { AppAttestationRepositoryLive } from '#root/infrastructure/adapters/repositories/app-attest.repository.js'
import { AndroidAttestationCrlService } from '#root/infrastructure/android-attestation-crl.service.js'
import { layerAuthRoutes } from '#root/routes/shared/auth/layer.js'
import { makeAuthRoutes } from '#root/routes/shared/auth/routes.js'
import { it } from '@effect/vitest'
import { OpenAPIHono, z } from '@hono/zod-openapi'
import { zValidator } from '@hono/zod-validator'
import { issueAppleAssertion, issueAppleAttestation } from '@identity-backend/app-attest/testing'
import {
  AppAttestService,
  AppAttestServiceConfig,
  AuthService,
  ChallengeService,
} from '@identity-backend/auth/services'
import {
  AppAttestEnvironment,
  layerAppAttestMiddlewareWithoutDependencies,
  makeAppAttestMiddleware,
} from '@identity-backend/hono-auth/app-attest'
import { encodeBase64 } from '@std/encoding'
import { eq } from 'drizzle-orm'
import { ConfigProvider, Effect, Layer, pipe, TestClock } from 'effect'
import { testClient } from 'hono/testing'
import { describe } from 'vitest'

describe('App Attest', () => {
  const APP_ID = 'QXCVVJ6654.io.novasama.polkadotapp.develop'
  const IOS_PACKAGE = 'io.novasama.polkadotapp.develop'

  const TestLayers = pipe(
    Layer.provideMerge(
      Layer.mergeAll(ChallengeServiceLive, AppAttestationRepositoryLive),
      Layer.mergeAll(AuthService.Default, DBTest),
    ),
    Layer.provideMerge(Layer.setConfigProvider(ConfigProvider.fromJson({
      JWT_AUTH_SECRET: 'test-secret-for-app-attest-integration-tests-min-32-chars',
    }))),
  )

  const layerAndroidAttestationCrlStub = Layer.succeed(
    AndroidAttestationCrlService,
    AndroidAttestationCrlService.of({ getEntries: Effect.succeed({}) }),
  )

  const setupApp = (opts: { readonly appIds?: ReadonlyArray<string>; readonly rootCert: string }) => {
    const appIds = opts.appIds ?? [APP_ID]

    const sharedAppAttestService = Layer.provide(
      AppAttestService.Default,
      Layer.succeed(AppAttestServiceConfig, { appIds, rootCert: opts.rootCert }),
    )

    const dependencies = Layer.mergeAll(
      sharedAppAttestService,
      Layer.succeed(AppAttestEnvironment, { iosPackageNames: new Set([IOS_PACKAGE]), appIds: new Set(appIds) }),
      layerAndroidAttestationCrlStub,
    )

    return Effect.gen(function*() {
      const authRoutes = yield* makeAuthRoutes()
      const middleware = yield* makeAppAttestMiddleware

      const app = new OpenAPIHono()
        .route('/auth', authRoutes)
        .use(middleware)
        .post(
          '/',
          zValidator('json', z.object({ signature: z.string(), username: z.string(), who: z.string() })),
          async (c) => c.json({ result: 'OK' }, 200),
        )

      return app
    }).pipe(
      Effect.provide(
        Layer.provideMerge(
          Layer.mergeAll(layerAuthRoutes, layerAppAttestMiddlewareWithoutDependencies),
          dependencies,
        ),
      ),
    )
  }

  it.layer(TestLayers)((it) => {
    it.scoped('Should_Work_When_ValidCredentials', (c) =>
      Effect.gen(function*() {
        yield* TestClock.setTime(Date.now())
        const db = yield* DB
        const challengeService = yield* ChallengeService

        const attestationChallenge = yield* challengeService.makeChallenge()
        const fake = yield* Effect.promise(() =>
          issueAppleAttestation({ appId: APP_ID, challenge: attestationChallenge })
        )

        const client = testClient(yield* setupApp({ rootCert: fake.rootPem }))

        const attestationRes = yield* Effect.promise(() =>
          client.auth['app-attest'].attestations.$post({
            json: {
              keyId: encodeBase64(fake.keyId),
              attestation: encodeBase64(fake.attestation),
              challenge: encodeBase64(attestationChallenge),
            },
          })
        )
        const attestationText = yield* Effect.promise(() => attestationRes.text())
        c.expect(attestationRes.status, `attestation failed: ${attestationText}`).toEqual(202)

        const assertionChallenge = yield* challengeService.makeChallenge()
        const clientId = crypto.getRandomValues(new Uint8Array(32))
        const body = {
          signature: '0xabc',
          username: 'atest.dot',
          who: '5GTPUh5MU5shhcif5vpD6RqFpuPXoFkSFRgHsD56CihR5LJL',
        }
        const clientData = new TextEncoder().encode(JSON.stringify(body))
        const assertion = yield* Effect.promise(() =>
          issueAppleAssertion({
            credKey: fake.credKey,
            appId: APP_ID,
            challenge: assertionChallenge,
            clientData,
            clientId,
            signCount: 1,
          })
        )

        const assertionRes = yield* Effect.promise(() =>
          client.index.$post(
            { json: body },
            {
              headers: {
                'Auth-iOS-KeyId': encodeBase64(fake.keyId),
                'Auth-iOS-Package': IOS_PACKAGE,
                'Auth-Challenge': encodeBase64(assertionChallenge),
                'Auth-Payload': encodeBase64(assertion),
                'Auth-ClientId': encodeBase64(clientId),
              },
            },
          )
        )

        const assertionBody = yield* Effect.promise(() => assertionRes.json())
        c.expect(assertionBody).toEqual({ result: 'OK' })
        c.expect(assertionRes.status).toEqual(200)

        const stored = yield* Effect.tryPromise(() =>
          db.select()
            .from(schema.appleAttestations)
            .where(eq(schema.appleAttestations.keyId, encodeBase64(fake.keyId)))
            .limit(1)
        )
        c.expect(stored[0]?.signCount).toEqual(1)
      }))

    it.scoped('Should_Fail_When_NoAppIdsMatch', (c) =>
      Effect.gen(function*() {
        yield* TestClock.setTime(Date.now())
        const challengeService = yield* ChallengeService

        const attestationChallenge = yield* challengeService.makeChallenge()
        const fake = yield* Effect.promise(() =>
          issueAppleAttestation({ appId: APP_ID, challenge: attestationChallenge })
        )

        const client = testClient(yield* setupApp({ appIds: [], rootCert: fake.rootPem }))

        const res = yield* Effect.promise(() =>
          client.auth['app-attest'].attestations.$post({
            json: {
              keyId: encodeBase64(fake.keyId),
              attestation: encodeBase64(fake.attestation),
              challenge: encodeBase64(attestationChallenge),
            },
          })
        )

        const resBody = yield* Effect.promise(() => res.json())
        c.expect(resBody).toEqual(c.expect.objectContaining({ _tag: 'VERIFY_ATTESTATION_FAILED' }))
        c.expect(res.status).toEqual(401)
      }))
  })
})
