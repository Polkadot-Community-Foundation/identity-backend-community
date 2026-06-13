import { DB } from '#root/db/mod.js'
import { ChallengeServiceLive } from '#root/infrastructure/adapters/challenge.service.js'
import { AppAttestationRepositoryLive } from '#root/infrastructure/adapters/repositories/app-attest.repository.js'
import { AndroidAttestationCrlService } from '#root/infrastructure/android-attestation-crl.service.js'
import {
  AttestationChallenge,
  GRAPHENEOS_VERIFIED_BOOT_KEYS,
  PackageName,
  SigningDigestHex,
  verifyAndroidAttestation as verifyAndroidAttestationLib,
} from '@identity-backend/android-attest'
import {
  AppAttestEnvironment,
  layerAppAttestMiddleware,
  makeAppAttestMiddleware,
} from '@identity-backend/hono-auth/app-attest'
import { AndroidAttestationOutcome } from '@identity-backend/hono-auth/auth'
import {
  AndroidAttestationMiddlewareConfig,
  AuthMiddlewareConfig,
  makeAndroidAttestationMiddleware,
  makeAuthMiddleware,
} from '@identity-backend/hono-auth/auth'
import {
  layerPlayIntegrityMiddleware,
  makePlayIntegrityMiddleware,
  PlayIntegrityEnvironment,
} from '@identity-backend/hono-auth/play-integrity'
import { PlayIntegrityServiceConfig } from '@identity-backend/play-integrity'
import { decodeHex, encodeBase64Url } from '@std/encoding'
import { Config, Context, Effect, Layer, pipe, Schema as S } from 'effect'
import { createMiddleware } from 'hono/factory'

const toDigestSet = (
  playstoreDigest: string,
  websiteDigest: string,
): ReadonlySet<string> =>
  new Set([
    encodeBase64Url(decodeHex(playstoreDigest)),
    encodeBase64Url(decodeHex(websiteDigest)),
  ])

export class AuthPluginConfig extends Context.Tag('app/AuthPluginConfig')<
  AuthPluginConfig,
  {
    enabled: boolean
  }
>() {}

export const makeAuthPluginWithoutDependencies = Effect.gen(function*() {
  const config = yield* AuthPluginConfig

  if (!config.enabled) {
    return yield* Effect.sync(() => createMiddleware(async (c, next) => next()))
  }

  const db = yield* DB

  const layerAppAttestEnvironment = Layer.effect(
    AppAttestEnvironment,
    Effect.gen(function*() {
      const { IOS_PACKAGE_NAMES, APPLE_APP_ATTEST_APP_IDS } = yield* Effect.promise(() => import('#root/config.js'))

      const appConfig = yield* Config.all({
        IOS_PACKAGE_NAMES,
        APPLE_APP_ATTEST_APP_IDS,
      })

      return {
        iosPackageNames: appConfig.IOS_PACKAGE_NAMES,
        appIds: appConfig.APPLE_APP_ATTEST_APP_IDS,
      }
    }),
  )

  const layerPlayIntegrityEnvironment = Layer.effect(
    PlayIntegrityEnvironment,
    Effect.gen(function*() {
      const {
        PLAY_INTEGRITY_MODE,
        ANDROID_PACKAGE_NAMES,
        ANDROID_SIGNING_DIGEST_PLAYSTORE,
        ANDROID_SIGNING_DIGEST_WEBSITE,
      } = yield* Effect.promise(() => import('#root/config.js'))

      const playConfig = yield* Config.all({
        androidPackageNames: ANDROID_PACKAGE_NAMES,
        mode: PLAY_INTEGRITY_MODE,
        playstoreDigest: ANDROID_SIGNING_DIGEST_PLAYSTORE,
        websiteDigest: ANDROID_SIGNING_DIGEST_WEBSITE,
      })

      return {
        androidPackageNames: playConfig.androidPackageNames,
        mode: playConfig.mode,
        androidSigningDigests: toDigestSet(playConfig.playstoreDigest, playConfig.websiteDigest),
      }
    }),
  )

  const layerPlayIntegrityServiceConfig = Layer.effect(
    PlayIntegrityServiceConfig,
    Effect.gen(function*() {
      const { GOOGLE_CREDENTIALS } = yield* Effect.promise(() => import('#root/config.js'))
      const { GOOGLE_CREDENTIALS: googleCredentials } = yield* Config.all({ GOOGLE_CREDENTIALS })

      return {
        googleCredentials,
      }
    }),
  )

  const layerAuthMiddlewareConfig = Layer.effect(
    AuthMiddlewareConfig,
    Effect.gen(function*() {
      const { ENFORCE_AUTH } = yield* Effect.promise(() => import('#root/config.js'))
      const enforceAuth = yield* ENFORCE_AUTH

      return {
        enforceAuth,
      }
    }),
  )

  const layerAndroidAttestationMiddlewareConfig = Layer.effect(
    AndroidAttestationMiddlewareConfig,
    Effect.gen(function*() {
      const {
        ANDROID_PACKAGE_NAMES,
        ANDROID_SIGNING_DIGEST_PLAYSTORE,
        ANDROID_SIGNING_DIGEST_WEBSITE,
        ANDROID_ATTESTATION_ROOT_PEMS,
      } = yield* Effect.promise(() => import('#root/config.js'))

      const crlService = yield* AndroidAttestationCrlService

      const [packageNames, playStoreDigest, websiteDigest, rootPems] = yield* Config.all([
        ANDROID_PACKAGE_NAMES,
        ANDROID_SIGNING_DIGEST_PLAYSTORE,
        ANDROID_SIGNING_DIGEST_WEBSITE,
        ANDROID_ATTESTATION_ROOT_PEMS,
      ])

      const knownDigests = {
        playStore: yield* S.decode(SigningDigestHex)(playStoreDigest),
        website: yield* S.decode(SigningDigestHex)(websiteDigest),
      }

      const expectedPackageNames = yield* Effect.forEach(
        Array.from(packageNames),
        (n) => S.decode(PackageName)(n),
      )

      const decodeChallenge = S.decodeSync(AttestationChallenge)

      const verifyChain: AndroidAttestationMiddlewareConfig['Type']['verifyChain'] = (params) =>
        Effect.gen(function*() {
          const crlEntries = yield* crlService.getEntries
          yield* verifyAndroidAttestationLib({
            expectedPackageNames,
            expectedChallenge: decodeChallenge(params.challenge),
            crlEntries,
            knownDigests,
            trustedVerifiedBootKeys: GRAPHENEOS_VERIFIED_BOOT_KEYS,
            googleRootPems: rootPems,
          })({
            leafCertDer: params.leafCertDer,
            intermediateCertDers: params.intermediateCertDers,
          })
          return AndroidAttestationOutcome.Verified
        }).pipe(
          Effect.catchTags({
            CertificateChainError: () => Effect.succeed(AndroidAttestationOutcome.Rejected),
            CertificateRevokedError: () => Effect.succeed(AndroidAttestationOutcome.Rejected),
            AttestationStatementError: () => Effect.succeed(AndroidAttestationOutcome.Rejected),
            AppDistributionError: () => Effect.succeed(AndroidAttestationOutcome.Rejected),
            FetchCrlError: () => Effect.succeed(AndroidAttestationOutcome.Unavailable),
            ParseCrlError: () => Effect.succeed(AndroidAttestationOutcome.Unavailable),
          }),
        )

      return { verifyChain }
    }),
  )

  const layerServices = Layer.provide(
    Layer.mergeAll(
      ChallengeServiceLive,
      AppAttestationRepositoryLive,
    ),
    Layer.succeed(DB, db),
  )

  const layerAppAttestComplete = pipe(
    layerAppAttestMiddleware,
    Layer.provide(layerAppAttestEnvironment),
  )

  const layerPlayIntegrityComplete = pipe(
    layerPlayIntegrityMiddleware,
    Layer.provide(
      Layer.mergeAll(
        layerPlayIntegrityEnvironment,
        layerPlayIntegrityServiceConfig,
      ),
    ),
  )

  const layerAuthMiddleware = Layer.provide(
    Layer.mergeAll(
      layerAppAttestComplete,
      layerPlayIntegrityComplete,
      layerAndroidAttestationMiddlewareConfig,
      layerAuthMiddlewareConfig,
    ),
    Layer.mergeAll(
      layerServices,
    ),
  )

  return yield* Effect.gen(function*() {
    const playIntegrityMiddleware = yield* makePlayIntegrityMiddleware
    const appAttestMiddleware = yield* makeAppAttestMiddleware
    const androidAttestationMiddleware = yield* makeAndroidAttestationMiddleware

    return yield* makeAuthMiddleware(
      playIntegrityMiddleware,
      appAttestMiddleware,
      androidAttestationMiddleware,
    )
  }).pipe(
    Effect.provide(layerAuthMiddleware),
  )
})

export const makeAuthPlugin = makeAuthPluginWithoutDependencies.pipe(
  Effect.provide(
    Layer.effect(
      AuthPluginConfig,
      Effect.gen(function*() {
        const { AUTH_ENABLED } = yield* Effect.promise(() => import('#root/config.js'))

        const enabled = yield* AUTH_ENABLED

        return {
          enabled,
        }
      }),
    ),
  ),
)
