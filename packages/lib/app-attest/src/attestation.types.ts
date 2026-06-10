import { Effect, ParseResult, Schema as S } from 'effect'

export const Attestation = S.Struct({
  fmt: S.Literal('apple-appattest'),
  attStmt: S.Struct({
    x5c: S.Tuple(S.Uint8ArrayFromSelf, S.Uint8ArrayFromSelf),
    receipt: S.Uint8ArrayFromSelf,
  }),
  authData: S.Uint8ArrayFromSelf,
})

export class DecodeAttestationError extends S.TaggedError<DecodeAttestationError>()(
  'DecodeAttestationError',
  {
    cause: S.Unknown,
  },
) {}

export class VerifyAttestationError extends S.TaggedError<VerifyAttestationError>()(
  'VerifyAttestationError',
  {
    cause: S.Unknown,
  },
) {}

export type Attestation = S.Schema.Type<typeof Attestation>

export type DecodeAttestation = (attestation: Uint8Array) => Effect.Effect<Attestation, DecodeAttestationError, never>

export namespace VerifyAttestation {
  export interface Options {
    readonly appIds: readonly string[]
    readonly crypto?: Crypto
    readonly rootCert?: string | BufferSource
    readonly now?: Effect.Effect<Date, never, never>
  }

  export interface Params {
    readonly keyId: Uint8Array
    readonly challenge: Uint8Array
    readonly attestation: Uint8Array
  }

  export interface Result {
    readonly publicKey: Uint8Array
    readonly receipt: Uint8Array
  }

  export type Error = VerifyAttestationError
}

export type VerifyAttestation = (
  options: VerifyAttestation.Options,
) => (params: VerifyAttestation.Params) => Effect.Effect<VerifyAttestation.Result, VerifyAttestation.Error, never>

type ParseError = ParseResult.ParseError
export type { ParseError }

export class AttestationValidationError extends S.TaggedError<AttestationValidationError>()(
  'AttestationValidationError',
  {
    message: S.String,
  },
) {}

export class AssertionValidationError extends S.TaggedError<AssertionValidationError>()(
  'AssertionValidationError',
  {
    message: S.String,
  },
) {}
