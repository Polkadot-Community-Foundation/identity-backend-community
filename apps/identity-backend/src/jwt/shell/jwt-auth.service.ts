import { Clock, Context, Duration, Effect, Layer, Redacted } from 'effect'
import { AccessToken } from '../core/jwt.types.js'

export class JWTAuthServiceConfig extends Context.Tag('identity-backend/jwt/shell/jwt-auth/JWTAuthServiceConfig')<
  JWTAuthServiceConfig,
  {
    readonly secret: Redacted.Redacted<string>
  }
>() {}

export class JWTAuthServiceDefaults extends Context.Reference<JWTAuthServiceDefaults>()(
  'identity-backend/jwt/shell/jwt-auth/JWTAuthServiceDefaults',
  {
    defaultValue: () => ({
      issuer: 'polkadot-app',
      alg: 'HS256',
      tokenDuration: Duration.hours(24),
    }),
  },
) {}

export namespace JWTAuthService {
  export interface Definition {
    readonly generateToken: (params?: {
      readonly sub?: string
      readonly plt?: 'ios' | 'android'
      readonly appFromOfficialStore?: boolean
    }) => Effect.Effect<AccessToken>
  }
}

const make = Effect.gen(function*() {
  const { SignJWT } = yield* Effect.promise(() => import('jose'))
  const { addSeconds } = yield* Effect.promise(() => import('date-fns/addSeconds'))
  const { secret } = yield* JWTAuthServiceConfig
  const { issuer, alg, tokenDuration } = yield* JWTAuthServiceDefaults

  const generateToken = Effect.fnUntraced(
    function*(
      params?: { readonly sub?: string; readonly plt?: 'ios' | 'android'; readonly appFromOfficialStore?: boolean },
    ) {
      const secretBytes = new TextEncoder().encode(Redacted.value(secret))
      const now = new Date(yield* Clock.currentTimeMillis)
      const exp = addSeconds(now, Duration.toSeconds(tokenDuration))

      const payload: Record<string, string | boolean> = { iss: issuer }
      if (params?.sub !== undefined) {
        payload.sub = params.sub
      }
      if (params?.plt !== undefined) {
        payload.plt = params.plt
      }
      if (params?.appFromOfficialStore !== undefined) {
        payload.appFromOfficialStore = params.appFromOfficialStore
      }

      const builder = new SignJWT(payload)
        .setProtectedHeader({ alg })
        .setIssuedAt(now)
        .setExpirationTime(exp)

      return yield* Effect.promise(() => builder.sign(secretBytes)).pipe(Effect.map((s) => AccessToken.make(s)))
    },
  ) satisfies JWTAuthService.Definition['generateToken']

  return JWTAuthService.of({ generateToken })
})

export class JWTAuthService extends Context.Tag('identity-backend/jwt/shell/jwt-auth/JWTAuthService')<
  JWTAuthService,
  JWTAuthService.Definition
>() {
  static readonly DefaultWithoutDependencies = Layer.effect(JWTAuthService, make)

  static readonly Default = Layer.suspend(() => JWTAuthService.DefaultWithoutDependencies).pipe(
    Layer.provide(Layer.effect(
      JWTAuthServiceConfig,
      Effect.gen(function*() {
        const { JWT_AUTH_SECRET } = yield* Effect.promise(() => import('#root/config.js'))
        const secret = yield* JWT_AUTH_SECRET
        return JWTAuthServiceConfig.of({ secret })
      }),
    )),
    Layer.provide(Layer.effect(
      JWTAuthServiceDefaults,
      Effect.gen(function*() {
        const defaults = yield* JWTAuthServiceDefaults
        const { JWT_TTL } = yield* Effect.promise(() => import('#root/config.js'))
        const tokenDuration = yield* JWT_TTL
        return { ...defaults, tokenDuration }
      }),
    )),
  )
}
