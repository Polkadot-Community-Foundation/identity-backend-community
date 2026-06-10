import {
  AppAttestationData,
  AppAttestRepository,
  AppAttestService,
  AppAttestServiceConfig,
  AuthService,
  ChallengeService,
} from '@identity-backend/auth/services'
import { Context, Effect, Either, Layer } from 'effect'
import { encodeBase64 } from 'effect/Encoding'
import { AppAttestMiddlewareConfig } from './middleware.js'
import { AppAttestError } from './types.js'

export class AppAttestEnvironment extends Context.Tag('AppAttestEnvironment')<AppAttestEnvironment, {
  iosPackageNames: ReadonlySet<string>
  appIds: ReadonlySet<string>
}>() {}

export const layerAppAttestMiddlewareWithoutDependencies = Layer.effect(
  AppAttestMiddlewareConfig,
  Effect.gen(function*() {
    const { consumeChallenge } = yield* ChallengeService
    const repository = yield* AppAttestRepository
    const appAttestService = yield* AppAttestService
    const { iosPackageNames } = yield* AppAttestEnvironment

    const isPackageNameValid = Effect.fn('app_attest.isPackageNameValid')((pkgName) =>
      Effect.sync(() => {
        return iosPackageNames.has(pkgName)
      })
    ) satisfies AppAttestMiddlewareConfig['Type']['isPackageNameValid']

    const getAssertion = Effect.fn('app_attest.getAssertion')(
      ({ keyId }) =>
        Effect.gen(function*() {
          const attestation = yield* repository.findById(keyId).pipe(
            Effect.mapError((err) => AppAttestError.make({ cause: err, keyId: encodeBase64(keyId) })),
          )

          yield* Effect.annotateCurrentSpan({
            keyId: encodeBase64(keyId),
            publicKey: encodeBase64(attestation.publicKey),
            signCount: attestation.signCount,
          })

          const publicKey = yield* Effect.tryPromise(() =>
            crypto.subtle.importKey(
              'spki',
              new Uint8Array(attestation.publicKey),
              { name: 'ECDSA', namedCurve: 'P-256' },
              true,
              ['verify'],
            )
          ).pipe(
            Effect.orDie,
          )

          return {
            attestation: {
              publicKey: encodeBase64(attestation.publicKey),
              signCount: attestation.signCount ?? 0,
            },
            publicKey,
          }
        }),
    ) satisfies AppAttestMiddlewareConfig['Type']['getAssertion']

    const verifyAssertion = Effect.fn('app_attest.verifyAssertion')(
      ({ attestation, publicKey, clientData, assertion, challenge, clientId }) =>
        Effect.gen(function*() {
          const nextSignCountResult = yield* appAttestService.verifyAssertion({
            clientData,
            challenge,
            assertion,
            publicKey,
            signCount: attestation.signCount,
            clientId,
          }).pipe(
            Effect.mapError((err) => AppAttestError.make({ cause: err })),
            Effect.either,
          )

          if (Either.isLeft(nextSignCountResult)) {
            return yield* Effect.fail(AppAttestError.make({
              cause: { message: nextSignCountResult.left },
            }))
          }

          const nextSignCount = nextSignCountResult.right
          return { publicKey, nextSignCount }
        }),
    ) satisfies AppAttestMiddlewareConfig['Type']['verifyAssertion']

    const commitAssertion = Effect.fn('app_attest.commitAssertion')(
      ({ keyId, nextSignCount }) =>
        Effect.gen(function*() {
          yield* repository.update(keyId, (current) =>
            AppAttestationData.make({
              // oxlint-disable-next-line typescript/no-misused-spread
              ...current,
              signCount: nextSignCount,
            })).pipe(
              Effect.mapError((err) => AppAttestError.make({ cause: err, keyId: encodeBase64(keyId) })),
            )
        }),
    ) satisfies AppAttestMiddlewareConfig['Type']['commitAssertion']

    return {
      isPackageNameValid,
      consumeChallenge,
      getAssertion,
      verifyAssertion,
      commitAssertion,
    } satisfies AppAttestMiddlewareConfig['Type']
  }),
)

export const layerAppAttestMiddleware = Layer.unwrapEffect(
  Effect.sync(() =>
    layerAppAttestMiddlewareWithoutDependencies.pipe(
      Layer.provide(
        Layer.provide(
          AppAttestService.Default,
          Layer.effect(
            AppAttestServiceConfig,
            Effect.gen(function*() {
              const { appIds } = yield* AppAttestEnvironment

              return {
                appIds: [...appIds],
              }
            }),
          ),
        ),
      ),
      Layer.provide(AuthService.Default),
    )
  ),
)
