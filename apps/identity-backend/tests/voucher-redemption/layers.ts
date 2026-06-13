import { it as effectIt, layer as effectLayer } from '@effect/vitest'
import { makeFeature } from '@identity-backend/effect-vitest-gherkin'
import { Layer } from 'effect'

import { refreshTokenTestLayer } from '../helpers/refresh-token-test-layer.js'

export const sharedFileLayer = refreshTokenTestLayer.pipe(Layer.orDie)

export const feature = makeFeature({ it: effectIt, layer: effectLayer })
