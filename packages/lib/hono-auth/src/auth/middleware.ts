import { Context, Effect, Match } from 'effect'
import type { MiddlewareHandler } from 'hono'
import { decideAndroidDispatch } from './dispatch.js'

export class AuthMiddlewareConfig extends Context.Tag('AuthMiddlewareConfig')<
  AuthMiddlewareConfig,
  { enforceAuth: boolean }
>() {}

export const makeAuthMiddleware = (
  // oxlint-disable-next-line typescript/no-explicit-any
  playIntegrityMiddleware: MiddlewareHandler<any, string, {}>,
  // oxlint-disable-next-line typescript/no-explicit-any
  appAttestMiddleware: MiddlewareHandler<any, string, {}>,
) =>
  Effect.gen(function*() {
    const config = yield* AuthMiddlewareConfig
    const { createMiddleware } = yield* Effect.promise(() => import('hono/factory'))
    const HonoCombine = yield* Effect.promise(() => import('hono/combine'))

    const enforceAuthMiddleware = createMiddleware(async (c, next) => {
      const iosPackageHeader = c.req.header('Auth-iOS-Package')
      const androidPackageHeader = c.req.header('Auth-Android-Package')
      const attestationTokenHeader = c.req.header('Auth-Attestation-Token')
      const attestationTypeHeader = c.req.header('Auth-Attestation-Type')

      if (
        config.enforceAuth &&
        iosPackageHeader === undefined &&
        androidPackageHeader === undefined &&
        attestationTokenHeader === undefined &&
        attestationTypeHeader === undefined
      ) {
        return c.json({
          error:
            'Missing one of [Auth-iOS-Package, Auth-Android-Package, Auth-Attestation-Token, Auth-Attestation-Type] headers',
        }, 401)
      }

      if (iosPackageHeader !== undefined && androidPackageHeader !== undefined) {
        return c.json({ error: `Only one of ['Auth-iOS-Package', 'Auth-Android-Package'] is allowed` }, 401)
      }

      return next()
    })

    const androidAttestationDispatchMiddleware = createMiddleware(async (c, next) => {
      const decision = decideAndroidDispatch({
        iosPackage: c.req.header('Auth-iOS-Package'),
        androidPackage: c.req.header('Auth-Android-Package'),
        attestationToken: c.req.header('Auth-Attestation-Token'),
        attestationType: c.req.header('Auth-Attestation-Type'),
      })

      return Match.value(decision).pipe(
        Match.tag('Skip', () => next()),
        Match.tag('PlayIntegrity', () => playIntegrityMiddleware(c, next)),
        Match.tag('KeyAttestation', () => next()),
        Match.tag('MissingAttestationType', () =>
          c.json({
            _tag: 'MissingAttestationTypeHeader',
            error:
              'Missing Auth-Attestation-Type header. Android requests must declare play-integrity or key-attestation.',
          }, 400)),
        Match.tag('UnknownAttestationType', () =>
          c.json({
            _tag: 'UnknownAttestationType',
            error: 'Unknown Auth-Attestation-Type header. Expected one of: play-integrity, key-attestation.',
          }, 400)),
        Match.exhaustive,
      )
    })

    return HonoCombine.every(
      enforceAuthMiddleware,
      androidAttestationDispatchMiddleware,
      HonoCombine.except((c) => c.req.header('Auth-iOS-Package') === undefined, appAttestMiddleware),
    )
  })
