import type { playintegrity_v1 } from '@googleapis/playintegrity'
import { Effect, Schema as S } from 'effect'

export const JWTInput = S.Struct({
  type: S.optionalWith(S.String, { exact: true }),
  client_email: S.optionalWith(S.String, { exact: true }),
  private_key: S.optionalWith(S.String, { exact: true }),
  private_key_id: S.optionalWith(S.String, { exact: true }),
  project_id: S.optionalWith(S.String, { exact: true }),
  client_id: S.optionalWith(S.String, { exact: true }),
  client_secret: S.optionalWith(S.String, { exact: true }),
  refresh_token: S.optionalWith(S.String, { exact: true }),
  quota_project_id: S.optionalWith(S.String, { exact: true }),
  universe_domain: S.optionalWith(S.String, { exact: true }),
})

export type JWTInput = S.Schema.Type<typeof JWTInput>

export namespace IPlayIntegrityService {
  export type DecodeIntegrityTokenOptions = Readonly<{
    packageName: string
    integrityToken: string
  }>

  export interface DecodeIntegrityTokenResult extends playintegrity_v1.Schema$DecodeIntegrityTokenResponse {}
}

export class DecodeIntegrityTokenError extends S.TaggedError<DecodeIntegrityTokenError>()(
  'DecodeIntegrityTokenError',
  {
    cause: S.Unknown,
  },
) {}

export interface IPlayIntegrityService {
  readonly decodeIntegrityToken: (
    options: IPlayIntegrityService.DecodeIntegrityTokenOptions,
  ) => Effect.Effect<IPlayIntegrityService.DecodeIntegrityTokenResult, DecodeIntegrityTokenError>
}

export class CreateGoogleAuthClientError extends S.TaggedError<CreateGoogleAuthClientError>()(
  'CreateGoogleAuthClientError',
  {
    cause: S.Unknown,
  },
) {}

export type { playintegrity_v1 }
