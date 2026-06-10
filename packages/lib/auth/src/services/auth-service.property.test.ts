import { afterEach, describe, it, vi } from '@effect/vitest'
import * as bytes from '@std/bytes'
import { Effect, Layer, Schema as S } from 'effect'
import { AuthService, AuthServiceConfig } from './auth-service.js'

describe('AuthService', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  const sha256 = vi.fn<AuthServiceConfig['Type']['sha256']>()

  const layer = Layer.provide(
    AuthService.DefaultWithoutDependencies,
    Layer.succeed(AuthServiceConfig, {
      sha256,
    }),
  )

  it.layer(layer)((it) => {
    it.effect.prop(
      '∀x_ClientDataHash_≡Hash2',
      [S.Uint8Array, S.Uint8Array, S.Uint8Array, S.Uint8Array, S.Uint8Array],
      ([payload, challenge, clientId, hash1, hash2]) =>
        Effect.gen(function*() {
          vi.clearAllMocks()

          sha256
            .mockImplementationOnce(() => hash1)
            .mockImplementationOnce(() => hash2)

          const authService = yield* AuthService

          const clientDataHash = yield* authService.buildClientDataHash(
            { payload, challenge, clientId },
          )

          return bytes.equals(clientDataHash, hash2)
        }),
    )
  })
})
