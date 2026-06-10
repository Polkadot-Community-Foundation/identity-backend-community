import { pipe, Schema as S } from 'effect'

export const PublicKey = pipe(
  S.Uint8ArrayFromSelf,
  S.filter((arr) => arr.byteLength === 32),
  S.annotations({
    identifier: 'Sr25519PublicKey',
    arbitrary: () => (fc) => fc.uint8Array({ minLength: 32, maxLength: 32 }),
  }),
  S.brand('sr25519/PublicKey'),
)

export const PrivateKey = pipe(
  S.Uint8ArrayFromSelf,
  S.filter((arr) => arr.byteLength === 64),
  S.annotations({
    identifier: 'Sr25519ExpandedPrivateKey',
    arbitrary: () => (fc) => fc.uint8Array({ minLength: 64, maxLength: 64 }),
  }),
  S.brand('sr25519/ExpandedPrivateKey'),
)

export interface PublicKey extends S.Schema.Type<typeof PublicKey> {}
export interface PrivateKey extends S.Schema.Type<typeof PrivateKey> {}
