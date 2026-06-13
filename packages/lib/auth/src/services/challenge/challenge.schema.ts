import { Schema as S } from 'effect'

// Wire layout: nonce(16) ‖ issuedAt:be-u64-millis(8) ‖ HMAC-SHA256(nonce ‖ issuedAt)(32).
const NONCE_BYTES = 16
const TIMESTAMP_BYTES = 8
const MAC_BYTES = 32
const SIGNED_BYTES = NONCE_BYTES + TIMESTAMP_BYTES
const CHALLENGE_BYTES = SIGNED_BYTES + MAC_BYTES

const Nonce = S.Uint8ArrayFromSelf.pipe(S.filter((u) => u.byteLength === NONCE_BYTES, { identifier: 'Nonce(16)' }))
const TimestampMillis = S.Number.pipe(S.filter((n) => Number.isInteger(n) && n >= 0, { identifier: 'TimestampMillis' }))
const Hmac = S.Uint8ArrayFromSelf.pipe(S.filter((u) => u.byteLength === MAC_BYTES, { identifier: 'Hmac(32)' }))

const SignedWire = S.Uint8ArrayFromSelf.pipe(
  S.filter((u) => u.byteLength === SIGNED_BYTES, { identifier: 'SignedWire(24)' }),
)

const SignedToken = S.Struct({
  nonce: Nonce,
  issuedAtMillis: TimestampMillis,
})

export const SignedFromWire = S.transform(
  SignedWire,
  SignedToken,
  {
    decode: (bytes) => ({
      nonce: bytes.subarray(0, NONCE_BYTES),
      issuedAtMillis: Number(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
        .getBigUint64(NONCE_BYTES, false)),
    }),
    encode: (data) => {
      const bytes = new Uint8Array(SIGNED_BYTES)
      bytes.set(data.nonce, 0)
      new DataView(bytes.buffer).setBigUint64(NONCE_BYTES, BigInt(data.issuedAtMillis), false)
      return bytes
    },
  },
)

const ChallengeWire = S.Uint8ArrayFromSelf.pipe(
  S.filter((u) => u.byteLength === CHALLENGE_BYTES, { identifier: 'ChallengeWire(56)' }),
)

const ChallengeToken = S.Struct({
  nonce: Nonce,
  issuedAtMillis: TimestampMillis,
  hmac: Hmac,
})
type ChallengeToken = S.Schema.Type<typeof ChallengeToken>

export const ChallengeFromWire = S.transform(
  ChallengeWire,
  ChallengeToken,
  {
    decode: (bytes) => ({
      nonce: bytes.subarray(0, NONCE_BYTES),
      issuedAtMillis: Number(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
        .getBigUint64(NONCE_BYTES, false)),
      hmac: bytes.subarray(SIGNED_BYTES, CHALLENGE_BYTES),
    }),
    encode: (data) => {
      const bytes = new Uint8Array(CHALLENGE_BYTES)
      bytes.set(data.nonce, 0)
      new DataView(bytes.buffer).setBigUint64(NONCE_BYTES, BigInt(data.issuedAtMillis), false)
      bytes.set(data.hmac, SIGNED_BYTES)
      return bytes
    },
  },
)

export { NONCE_BYTES }

export const ChallengeRejectReason = S.Literal('malformed', 'inauthentic', 'expired')
export type ChallengeRejectReason = typeof ChallengeRejectReason.Type

export class ChallengeRejectedError extends S.TaggedError<ChallengeRejectedError>()('ChallengeRejectedError', {
  reason: ChallengeRejectReason,
}) {}
