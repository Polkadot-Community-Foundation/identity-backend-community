import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { Config, Context, type Duration, Effect, Layer, Redacted } from 'effect'

const POC_HMAC_KEY_INFO = new TextEncoder().encode('identity-backend/proof-of-compute/hmac-v1')
const POC_HMAC_KEY_BYTES = 32 as const

export class ProofOfComputeConfig extends Context.Tag('app/proof-of-compute/ProofOfComputeConfig')<
  ProofOfComputeConfig,
  {
    readonly enabled: true
    readonly secret: Redacted.Redacted<Uint8Array>
    readonly ttl: Duration.Duration
    readonly clockSkew: Duration.Duration
    readonly difficulty: number
  } | {
    readonly enabled: false
  }
>() {
  static readonly Default = Layer.effect(
    ProofOfComputeConfig,
    Effect.gen(function*() {
      const { POC_ENABLED, JWT_AUTH_SECRET, POC_SESSION_TTL, POC_CLOCK_SKEW, POC_DIFFICULTY_BITS } = yield* Effect
        .promise(() => import('#root/config.js'))

      const enabled = yield* POC_ENABLED
      if (!enabled) {
        return { enabled: false }
      }

      const { jwtAuthSecret, ttl, clockSkew, difficulty } = yield* Config.all({
        jwtAuthSecret: JWT_AUTH_SECRET,
        ttl: POC_SESSION_TTL,
        clockSkew: POC_CLOCK_SKEW,
        difficulty: POC_DIFFICULTY_BITS,
      })
      const ikm = new TextEncoder().encode(Redacted.value(jwtAuthSecret))
      const secret = Redacted.make(hkdf(sha256, ikm, undefined, POC_HMAC_KEY_INFO, POC_HMAC_KEY_BYTES))

      return { enabled: true, secret, ttl, clockSkew, difficulty }
    }),
  )
}
