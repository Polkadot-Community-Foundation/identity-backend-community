import { Context, Effect, Layer } from 'effect'

export namespace AuthService {
  export namespace BuildClientDataHash {
    export interface Params {
      readonly payload: Uint8Array
      readonly challenge: Uint8Array
      readonly clientId: Uint8Array
    }
  }

  export type BuildClientDataHash = (params: BuildClientDataHash.Params) => Effect.Effect<Uint8Array, never, never>

  export interface AuthService {
    buildClientDataHash: BuildClientDataHash
  }
}

type Service = AuthService.AuthService
type BuildClientDataHash = AuthService.BuildClientDataHash

export class AuthServiceConfig extends Context.Tag('AuthServiceConfig')<AuthServiceConfig, {
  sha256: (msg: Uint8Array) => Uint8Array
}>() {}

export class AuthService extends Effect.Service<AuthService>()('AuthService', {
  effect: Effect.gen(function*() {
    const { sha256 } = yield* AuthServiceConfig
    const { concat: bytesConcat } = yield* Effect.promise(() => import('@std/bytes'))

    const buildClientDataHash = (Effect.fn('auth.buildClientDataHash')((params) =>
      Effect.sync(() => {
        const payloadHash = sha256(params.payload)
        const preImage = bytesConcat([params.challenge, params.clientId, payloadHash])
        return sha256(preImage)
      })
    )) satisfies BuildClientDataHash

    return {
      buildClientDataHash,
    } satisfies Service
  }),
  dependencies: [
    Layer.effect(
      AuthServiceConfig,
      Effect.gen(function*() {
        const { sha256 } = yield* Effect.promise(() => import('@noble/hashes/sha2.js'))

        return {
          sha256,
        }
      }),
    ),
  ],
}) {}
