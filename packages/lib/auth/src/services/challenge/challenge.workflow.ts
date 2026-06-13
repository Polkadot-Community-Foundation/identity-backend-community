import { Either, pipe, Schema as S } from 'effect'
import { ChallengeFromWire, ChallengeRejectedError, SignedFromWire } from './challenge.schema.js'

export type Sign = (message: Uint8Array) => Uint8Array
export type MacEquals = (a: Uint8Array, b: Uint8Array) => boolean

export class ChallengeVerified extends S.TaggedClass<ChallengeVerified>()('ChallengeVerified', {
  issuedAtMillis: S.Number,
}) {}

export const mintChallenge = (sign: Sign, nonce: Uint8Array, issuedAtMillis: number): Uint8Array => {
  const signed = S.encodeSync(SignedFromWire)({ nonce, issuedAtMillis })
  const mac = sign(signed)
  return S.encodeSync(ChallengeFromWire)({ nonce, issuedAtMillis, hmac: mac })
}

export const verifyChallenge = (
  sign: Sign,
  macEquals: MacEquals,
  nowMillis: number,
  ttlMillis: number,
  challenge: Uint8Array,
): Either.Either<ChallengeVerified, ChallengeRejectedError> =>
  pipe(
    S.decodeEither(ChallengeFromWire)(challenge),
    Either.mapLeft(() => new ChallengeRejectedError({ reason: 'malformed' })),
    Either.filterOrLeft(
      (token) => {
        const signed = S.encodeSync(SignedFromWire)({ nonce: token.nonce, issuedAtMillis: token.issuedAtMillis })
        return macEquals(sign(signed), token.hmac)
      },
      () => new ChallengeRejectedError({ reason: 'inauthentic' }),
    ),
    Either.filterOrLeft(
      (token) => nowMillis - token.issuedAtMillis <= ttlMillis,
      () => new ChallengeRejectedError({ reason: 'expired' }),
    ),
    Either.map((token) => new ChallengeVerified({ issuedAtMillis: token.issuedAtMillis })),
  )
