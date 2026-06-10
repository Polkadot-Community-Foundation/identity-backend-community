import type { VerifyAssertion, VerifyAttestation } from '@identity-backend/app-attest'
import { Context, Effect } from 'effect'
import { AuthService } from '../auth-service.js'
import { AppAttestationData, AppAttestRepository, ChallengeNotFoundError, ChallengeService } from '../mod.js'
import { AppAttestError } from './types.js'

export class AppAttestServiceConfig extends Context.Tag('AppAttestServiceConfig')<
  AppAttestServiceConfig,
  {
    readonly rootCert?: string | BufferSource
    readonly appIds: readonly string[]
  }
>() {
}

export namespace AppAttestService {
  export interface VerifyAttestationParams extends VerifyAttestation.Params {}
  export interface VerifiedAttestation extends VerifyAttestation.Result {}

  export interface VerifyAssertionParams extends VerifyAssertion.Params {}

  export interface PersistAttestationParams {
    attestation: AppAttestationData
    challenge: Uint8Array
  }

  export interface AppAttestService {
    verifyAttestation: (params: VerifyAttestationParams) => Effect.Effect<VerifiedAttestation, AppAttestError>
    verifyAssertion: (params: VerifyAssertionParams) => Effect.Effect<number, AppAttestError>
    persistAttestation: (
      params: PersistAttestationParams,
    ) => Effect.Effect<void, ChallengeNotFoundError | AppAttestError>
  }
}

export class AppAttestService extends Effect.Service<AppAttestService>()(
  '@identity-backend/app-attest',
  {
    effect: Effect.gen(function*() {
      const { buildClientDataHash } = yield* AuthService
      const repository = yield* AppAttestRepository
      const challengeService = yield* ChallengeService
      const {
        verifyAssertion: makeVerifyAssertion,
        verifyAttestation: makeVerifyAttestation,
      } = yield* Effect.promise(() => import('@identity-backend/app-attest'))
      const { appIds } = yield* AppAttestServiceConfig

      const verifyAttestation = (Effect.fn('app_attest.verifyAttestation')((params) =>
        makeVerifyAttestation({ appIds })(params)
          .pipe(Effect.mapError((cause) =>
            AppAttestError.make({ cause })
          ))
      )) satisfies AppAttestService.AppAttestService['verifyAttestation']

      const verifyAssertion = (Effect.fn('app_attest.verifyAssertion')((params) =>
        makeVerifyAssertion({ appIds, buildClientDataHash })(params)
          .pipe(
            Effect.mapError((cause) => AppAttestError.make({ cause })),
          )
      )) satisfies AppAttestService.AppAttestService['verifyAssertion']

      const persistAttestation = (Effect.fn('app_attest.persistAttestation')(
        function*(params) {
          yield* repository.create(params.attestation).pipe(
            Effect.mapError((err) => AppAttestError.make({ cause: err })),
          )
          yield* challengeService.consumeChallenge(params.challenge).pipe(
            Effect.catchTag('ConsumeChallengeError', (cause) => Effect.fail(AppAttestError.make({ cause }))),
          )
        },
      )) satisfies AppAttestService.AppAttestService['persistAttestation']

      return {
        verifyAttestation,
        verifyAssertion,
        persistAttestation,
      } satisfies AppAttestService.AppAttestService
    }),
    dependencies: [
      AuthService.Default,
    ],
  },
) {}
