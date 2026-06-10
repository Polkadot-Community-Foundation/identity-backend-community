import { AuthService, ChallengeService } from '@identity-backend/auth/services'
import { PlayIntegrityService } from '@identity-backend/play-integrity'
import { Context, Effect, flow, Layer, Match, Schema as S } from 'effect'
import { PlayIntegrityMiddlewareConfig } from './middleware.js'
import { PlayIntegrityTokenAcl } from './play-integrity.acl.js'
import { InvalidTokenError, PlayIntegrityMode } from './types.js'
import { PlayIntegrityValidation, validatePlayIntegrityToken } from './validation.js'

export class PlayIntegrityEnvironment extends Context.Tag('PlayIntegrityEnvironment')<PlayIntegrityEnvironment, {
  mode: PlayIntegrityMode
  androidPackageNames: ReadonlySet<string>
}>() {}

export const layerPlayIntegrityMiddlewareWithoutDependencies = Layer.effect(
  PlayIntegrityMiddlewareConfig,
  Effect.gen(function*() {
    const { mode, androidPackageNames } = yield* PlayIntegrityEnvironment
    const { buildClientDataHash } = yield* AuthService
    const { consumeChallenge } = yield* ChallengeService
    const { decodeIntegrityToken } = yield* PlayIntegrityService

    const isTokenValid: PlayIntegrityMiddlewareConfig['Type']['isTokenValid'] = (foreignToken) => {
      const result: PlayIntegrityValidation = validatePlayIntegrityToken(
        mode,
        S.decodeSync(PlayIntegrityTokenAcl)(foreignToken),
      )
      return Match.value(result).pipe(
        Match.tag('PlayIntegrityRejected', (r) => Effect.fail(InvalidTokenError.make({ codes: r.codes }))),
        Match.orElse(() => Effect.succeed(undefined)),
      )
    }

    const isPackageNameValid: PlayIntegrityMiddlewareConfig['Type']['isPackageNameValid'] = (pkgName) =>
      Effect.succeed(androidPackageNames.has(pkgName))

    return {
      buildClientDataHash,
      isTokenValid,
      isPackageNameValid,
      consumeChallenge,
      decodeIntegrityToken: flow(decodeIntegrityToken, Effect.orDie),
    } satisfies PlayIntegrityMiddlewareConfig['Type']
  }),
)

export const layerPlayIntegrityMiddleware = layerPlayIntegrityMiddlewareWithoutDependencies.pipe(
  Layer.provide(
    Layer.mergeAll(
      AuthService.Default,
      PlayIntegrityService.Default,
    ),
  ),
)
