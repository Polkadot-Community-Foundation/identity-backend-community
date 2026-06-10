import type { MiddlewareHandler } from 'hono'
import { except } from 'hono/combine'

import { unauthenticatedPassthrough } from './http-primitives.js'
import { verifyJwt } from './verify-jwt.js'

export const optionalJwt = (secret: string): MiddlewareHandler => except(unauthenticatedPassthrough, verifyJwt(secret))
