import { CHALLENGE_TTL_SECONDS, JWT_AUTH_SECRET } from '#root/config.js'
import {
  ChallengeServiceConfig,
  ChallengeServiceLive as ChallengeServiceLiveWithoutDependencies,
} from '@identity-backend/auth/services'
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { Config, Effect, Layer, Redacted } from 'effect'

const CHALLENGE_KEY_INFO = 'identity-backend/challenge-hmac/v1' as const
const CHALLENGE_KEY_BYTES = 32 as const

const layerChallengeServiceConfig = Layer.effect(
  ChallengeServiceConfig,
  Effect.gen(function*() {
    const [jwtSecret, ttlSeconds] = yield* Config.all([JWT_AUTH_SECRET, CHALLENGE_TTL_SECONDS])

    const inputKeyMaterial = new TextEncoder().encode(Redacted.value(jwtSecret))
    const domain = new TextEncoder().encode(CHALLENGE_KEY_INFO)
    const signingKey = hkdf(sha256, inputKeyMaterial, undefined, domain, CHALLENGE_KEY_BYTES)

    return ChallengeServiceConfig.of({
      signingKey: Redacted.make(signingKey),
      ttlMillis: ttlSeconds * 1000,
      getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto),
    })
  }),
)

export const ChallengeServiceLive = ChallengeServiceLiveWithoutDependencies.pipe(
  Layer.provide(layerChallengeServiceConfig),
)
