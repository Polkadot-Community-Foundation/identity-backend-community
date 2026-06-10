import { Context, Effect, Redacted } from 'effect'
import {
  CreateGoogleAuthClientError,
  DecodeIntegrityTokenError,
  type IPlayIntegrityService,
  JWTInput,
} from './types.js'

export class PlayIntegrityServiceConfig extends Context.Tag('PlayIntegrityServiceLiveConfig')<
  PlayIntegrityServiceConfig,
  {
    googleCredentials: Redacted.Redacted<JWTInput>
  }
>() {}

export class PlayIntegrityService extends Effect.Service<PlayIntegrityService>()('PlayIntegrityService', {
  effect: Effect.gen(function*() {
    const { auth, playintegrity } = yield* Effect.promise(() => import('@googleapis/playintegrity'))
    const { googleCredentials } = yield* PlayIntegrityServiceConfig

    const authClient = yield* Effect.tryPromise({
      try: () =>
        auth.getClient({
          credentials: Redacted.value(googleCredentials),
          scopes: ['https://www.googleapis.com/auth/playintegrity'],
        }),
      catch: (err) => new CreateGoogleAuthClientError({ cause: err }),
    })

    const decodeIntegrityToken = Effect.fn('play_integrity.decodeIntegrityToken')((
      { packageName, integrityToken },
    ) =>
      Effect.tryPromise({
        try: async () => {
          const response = await playintegrity('v1').v1.decodeIntegrityToken({
            auth: authClient,
            packageName: packageName,
            requestBody: {
              integrityToken: integrityToken,
            },
          })
          return response.data
        },
        catch: (cause) => new DecodeIntegrityTokenError({ cause }),
      })
    ) satisfies IPlayIntegrityService['decodeIntegrityToken']

    return {
      decodeIntegrityToken,
    } satisfies IPlayIntegrityService as IPlayIntegrityService
  }),
}) {}
