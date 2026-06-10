import { DB } from '#root/db/mod.js'
import { AppAttestationRepositoryLive } from '#root/infrastructure/adapters/repositories/app-attest.repository.js'
import { ChallengeServiceLive } from '#root/infrastructure/adapters/repositories/challenge.repository.js'
import {
  AppAttestEnvironment,
  layerAppAttestMiddleware,
  makeAppAttestMiddleware,
} from '@identity-backend/hono-auth/app-attest'
import { AuthMiddlewareConfig, makeAuthMiddleware } from '@identity-backend/hono-auth/auth'
import {
  layerPlayIntegrityMiddleware,
  makePlayIntegrityMiddleware,
  PlayIntegrityEnvironment,
} from '@identity-backend/hono-auth/play-integrity'
import { PlayIntegrityServiceConfig } from '@identity-backend/play-integrity'
import { Config, Context, Effect, Layer, pipe } from 'effect'
import { createMiddleware } from 'hono/factory'

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
      } = yield* Effect.promise(() => import('#root/config.js'))

      const playConfig = yield* Config.all({
        androidPackageNames: ANDROID_PACKAGE_NAMES,
        mode: PLAY_INTEGRITY_MODE,
      })

      return {
        androidPackageNames: playConfig.androidPackageNames,
        mode: playConfig.mode,
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
      layerAuthMiddlewareConfig,
    ),
    Layer.mergeAll(
      layerServices,
    ),
  )

  return yield* Effect.gen(function*() {
    const playIntegrityMiddleware = yield* makePlayIntegrityMiddleware
    const appAttestMiddleware = yield* makeAppAttestMiddleware

    return yield* makeAuthMiddleware(playIntegrityMiddleware, appAttestMiddleware)
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
