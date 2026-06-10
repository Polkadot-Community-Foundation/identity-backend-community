import { AppAttestService, ChallengeService } from '@identity-backend/auth/services'
import { Effect, Layer } from 'effect'
import { AuthRoutesConfig } from './routes.js'

export const layerAuthRoutes = Layer.unwrapEffect(Effect.gen(function*() {
  const appAttestService = yield* AppAttestService
  const challengeService = yield* ChallengeService

  return Layer.succeed(
    AuthRoutesConfig,
    {
      makeChallenge: challengeService.makeChallenge,
      verifyAttestation: appAttestService.verifyAttestation,
      persistChallenge: challengeService.persistChallenge,
      persistAttestation: appAttestService.persistAttestation,
    } satisfies AuthRoutesConfig['Type'],
  )
}))
