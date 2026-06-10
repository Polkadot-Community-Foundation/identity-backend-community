import { Schema as S } from 'effect'

export const KeyId = S.Uint8ArrayFromBase64.pipe(S.brand('KeyId'))

export type KeyId = S.Schema.Type<typeof KeyId>

export class AppAttestationData extends S.TaggedClass<AppAttestationData>('AppAttestationData')('AppAttestationData', {
  keyId: KeyId,
  publicKey: S.Uint8ArrayFromBase64,
  receipt: S.Uint8ArrayFromBase64,
  signCount: S.optionalWith(S.NonNegativeInt, { nullable: true }),
}) {}

export class AppAttestationNotFoundError
  extends S.TaggedError<AppAttestationNotFoundError>('AppAttestationNotFoundError')(
    'AppAttestationNotFoundError',
    {
      keyId: S.String,
    },
  )
{}

export class AppAttestationDatabaseError
  extends S.TaggedError<AppAttestationDatabaseError>('AppAttestationDatabaseError')(
    'AppAttestationDatabaseError',
    {
      cause: S.Unknown,
    },
  )
{}
