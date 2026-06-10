import { Effect, Schema as S } from 'effect'

export namespace VerifyAssertion {
  export namespace BuildClientDataHash {
    export interface Params {
      readonly payload: Uint8Array
      readonly challenge: Uint8Array
      readonly clientId: Uint8Array
    }

    export interface Options {
      readonly crypto?: Crypto
    }
  }

  export interface Options {
    readonly appIds: readonly string[]
    readonly buildClientDataHash: (
      params: BuildClientDataHash.Params,
      options?: BuildClientDataHash.Options,
    ) => Effect.Effect<Uint8Array, never, never>
    readonly crypto?: Crypto
  }

  export interface Params {
    readonly clientData: Uint8Array
    readonly challenge: Uint8Array
    readonly publicKey: CryptoKey
    readonly assertion: Uint8Array
    readonly signCount: number
    readonly clientId: Uint8Array
  }

  export type Error = VerifyAssertionError | DecodeAssertionError
  export type Result = number
}

export type VerifyAssertion = (
  options: VerifyAssertion.Options,
) => (params: VerifyAssertion.Params) => Effect.Effect<VerifyAssertion.Result, VerifyAssertion.Error, never>

export class DecodeAssertionError extends S.TaggedError<DecodeAssertionError>()(
  'DecodeAssertionError',
  {
    cause: S.Unknown,
  },
) {}

export class VerifyAssertionError extends S.TaggedError<VerifyAssertionError>()(
  'VerifyAssertionError',
  {
    message: S.String,
  },
) {}

export const Assertion = S.Struct({
  signature: S.Uint8ArrayFromSelf,
  authenticatorData: S.Uint8ArrayFromSelf,
})

export type Assertion = S.Schema.Type<typeof Assertion>
