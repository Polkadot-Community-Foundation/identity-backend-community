import { SMARTBEAR } from '#root/lib/problem-details.js'
import { Either } from 'effect'
import { Schema } from 'effect'
import type { MiddlewareHandler } from 'hono'
import { Jwt } from 'hono/utils/jwt'

export const JwtErrorTagSchema = Schema.Literal(
  'missing-authorization-header',
  'invalid-authorization-header',
  'invalid-token',
)
type JwtErrorTag = Schema.Schema.Type<typeof JwtErrorTagSchema>

const problemDetail = (tag: JwtErrorTag) => {
  switch (tag) {
    case 'missing-authorization-header':
      return {
        type: `${SMARTBEAR}/missing-request-header`,
        title: 'Missing Authorization Header',
        detail: 'Write requests with an Authorization header must include a valid Bearer token.',
        status: 401,
      }
    case 'invalid-authorization-header':
      return {
        type: `${SMARTBEAR}/invalid-request-header-format`,
        title: 'Invalid Authorization Header',
        detail: 'Authorization header must use Bearer scheme: "Bearer <token>".',
        status: 401,
      }
    case 'invalid-token':
      return {
        type: `${SMARTBEAR}/unauthorized`,
        title: 'Invalid Token',
        detail: 'Token verification failed. The token may be expired or malformed.',
        status: 401,
      }
  }
}

const respondWithError = (c: Parameters<MiddlewareHandler>[0], kind: JwtErrorTag) =>
  c.json(problemDetail(kind), 401, { 'Content-Type': 'application/problem+json' })

const jwtError = (tag: JwtErrorTag) => Either.left(tag)

const parseCredentials = (header: string | undefined) => {
  if (header === undefined) {
    return jwtError('missing-authorization-header')
  }

  const parts = header.split(/\s+/)
  if (parts.length !== 2 || parts[0] !== 'Bearer' || !parts[1]) {
    return jwtError('invalid-authorization-header')
  }

  return Either.right(parts[1])
}

const verifyToken = async (token: string, secret: string) => {
  try {
    const payload = await Jwt.verify(token, secret, 'HS256')
    return Either.right(payload)
  } catch {
    return jwtError('invalid-token')
  }
}

export interface JwtEnv {
  Variables: {
    jwtSub: string
    jwtPlatform?: 'ios' | 'android'
    jwtAppFromOfficialStore?: boolean
  }
}

const JwtPlatformSchema = Schema.Literal('ios', 'android')

export const verifyJwt = (secret: string): MiddlewareHandler<JwtEnv> => async (c, next) => {
  const parsed = parseCredentials(c.req.header('Authorization'))

  if (Either.isLeft(parsed)) {
    return respondWithError(c, parsed.left)
  }

  const verified = await verifyToken(parsed.right, secret)

  if (Either.isLeft(verified)) {
    return respondWithError(c, verified.left)
  }

  const decodedSub = Schema.decodeUnknownEither(Schema.NonEmptyString)(verified.right.sub)

  if (Either.isLeft(decodedSub)) {
    return respondWithError(c, 'invalid-token')
  }

  c.set('jwtSub', decodedSub.right)

  const platform = Schema.decodeUnknownEither(JwtPlatformSchema)(verified.right.plt)
  if (Either.isRight(platform)) {
    c.set('jwtPlatform', platform.right)
  }

  const appFromOfficialStore = Schema.decodeUnknownEither(Schema.Boolean)(verified.right.appFromOfficialStore)
  if (Either.isRight(appFromOfficialStore)) {
    c.set('jwtAppFromOfficialStore', appFromOfficialStore.right)
  }

  await next()
}
