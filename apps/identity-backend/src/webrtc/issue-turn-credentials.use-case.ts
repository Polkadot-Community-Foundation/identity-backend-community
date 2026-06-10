import { hmac } from '@noble/hashes/hmac.js'
import { addMilliseconds } from 'date-fns/addMilliseconds'
import { Clock, Config, Context, Duration, Effect, Layer, Match, pipe, Redacted } from 'effect'
import { Realm, TurnCredentials, TurnUsername } from './webrtc.schema'

export namespace IssueTurnCredentialsUseCase {
  export type Definition = (regionHint?: string | null) => Effect.Effect<TurnCredentials, never, never>
}

export class TurnServiceConfig
  extends Context.Tag('identity-backend-container/infrastructure/webrtc/turn.service/TurnServiceConfig')<
    TurnServiceConfig,
    {
      secret: Redacted.Redacted<Uint8Array>
      hashAlgorithm: 'SHA1' | 'SHA256' | 'SHA384' | 'SHA512'
      ttl: Duration.Duration
      realm: Realm
      serverUrls: readonly URL[]
    }
  >()
{}

const make = Effect.gen(function*() {
  const config = yield* TurnServiceConfig

  const hashAlgorithm = yield* Match.value(config.hashAlgorithm).pipe(
    Match.when(
      'SHA1',
      () => pipe(Effect.promise(() => import('@noble/hashes/legacy.js')), Effect.map((mod) => mod.sha1)),
    ),
    Match.when(
      'SHA256',
      () => pipe(Effect.promise(() => import('@noble/hashes/sha2.js')), Effect.map((mod) => mod.sha256)),
    ),
    Match.when(
      'SHA384',
      () => pipe(Effect.promise(() => import('@noble/hashes/sha2.js')), Effect.map((mod) => mod.sha384)),
    ),
    Match.when(
      'SHA512',
      () => pipe(Effect.promise(() => import('@noble/hashes/sha2.js')), Effect.map((mod) => mod.sha512)),
    ),
    Match.exhaustive,
  )

  const generateId = Effect.gen(function*() {
    const id = new Uint8Array(8)
    yield* Effect.sync(() => crypto.getRandomValues(id))

    return id
  })

  const generateUsername = Effect.fnUntraced(function*(id: Uint8Array) {
    const now = new Date(yield* Clock.currentTimeMillis)
    const expiry = addMilliseconds(now, Duration.toMillis(config.ttl))

    return yield* Effect.sync(() => TurnUsername.make({ id, expiry }))
  })

  const generatePassword = Effect.fnUntraced(function*(username: TurnUsername) {
    const input = new TextEncoder().encode(username.toString())

    const credentials = yield* Effect.sync(() => hmac(hashAlgorithm, Redacted.value(config.secret), input))
    return Redacted.make(credentials)
  })

  const issue = Effect.fnUntraced(function*() {
    const id = yield* generateId
    const username = yield* generateUsername(id)
    const password = yield* generatePassword(username)

    return TurnCredentials.make({
      username,
      password,
      realm: config.realm,
      ttl: config.ttl,
    })
  }) satisfies IssueTurnCredentialsUseCase.Definition

  return IssueTurnCredentialsUseCase.of(issue)
})

export class IssueTurnCredentialsUseCase
  extends Context.Tag('TurnService')<IssueTurnCredentialsUseCase, IssueTurnCredentialsUseCase.Definition>()
{
  static readonly DefaultWithoutDependencies = Layer.effect(IssueTurnCredentialsUseCase, make)

  static readonly Default = Layer.suspend(() => IssueTurnCredentialsUseCase.DefaultWithoutDependencies).pipe(
    Layer.provide(Layer.effect(
      TurnServiceConfig,
      Effect.gen(function*() {
        const {
          TURN_SECRET,
          TURN_AUTH_ALGORITHM,
          TURN_TTL,
          TURN_REALM,
          ICE_SERVERS,
        } = yield* Effect.promise(() => import('#root/config.js'))

        const [secret, hashAlgorithm, ttl, realm, serverUrls] = yield* Config.all([
          TURN_SECRET,
          TURN_AUTH_ALGORITHM,
          TURN_TTL,
          TURN_REALM.pipe(Config.map((r) => Realm.make(r))),
          ICE_SERVERS,
        ])

        return TurnServiceConfig.of({ secret, hashAlgorithm, ttl, realm, serverUrls })
      }),
    )),
  )
}
