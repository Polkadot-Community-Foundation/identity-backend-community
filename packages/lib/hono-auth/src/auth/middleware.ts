import { Context, Effect, Either, Match } from 'effect'
import type { MiddlewareHandler } from 'hono'
import { AppAttestDispatchCommand, decideAppAttestDispatch } from '../app-attest/dispatch.workflow.js'
import { decideAndroidAttestationRequirement } from './attestation-requirement.workflow.js'
import { readAttestationChainPresence } from './attestation.middleware.js'
import { decideAndroidDispatch } from './dispatch.js'

export class AuthMiddlewareConfig extends Context.Tag('AuthMiddlewareConfig')<
  AuthMiddlewareConfig,
  { enforceAuth: boolean }
>() {}

const ASSERTION_HEADER_NAMES: Record<string, string> = {
  payload: 'Auth-Payload',
  keyId: 'Auth-iOS-KeyId',
  challenge: 'Auth-Challenge',
  clientId: 'Auth-ClientId',
}

export const makeAuthMiddleware = (
  // oxlint-disable-next-line typescript/no-explicit-any
  playIntegrityMiddleware: MiddlewareHandler<any, string, {}>,
  // oxlint-disable-next-line typescript/no-explicit-any
  appAttestMiddleware: MiddlewareHandler<any, string, {}>,
  // oxlint-disable-next-line typescript/no-explicit-any
  androidAttestationMiddleware: MiddlewareHandler<any, string, {}>,
) =>
  Effect.gen(function*() {
    const config = yield* AuthMiddlewareConfig
    const { createMiddleware } = yield* Effect.promise(() => import('hono/factory'))
    const HonoCombine = yield* Effect.promise(() => import('hono/combine'))

    const verifyThenPlayIntegrity = HonoCombine.every(androidAttestationMiddleware, playIntegrityMiddleware)

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
        Match.tag('PlayIntegrity', async () =>
          Match.value(decideAndroidAttestationRequirement({
            enforceAuth: config.enforceAuth,
            chainPresent: await readAttestationChainPresence(c),
          })).pipe(
            Match.tag('VerifyChain', () => verifyThenPlayIntegrity(c, next)),
            Match.tag('SkipVerification', () => playIntegrityMiddleware(c, next)),
            Match.tag('MissingChain', () =>
              c.json({
                _tag: 'MissingAndroidAttestationChain',
                error: 'Missing Android Attestation chain',
              }, 401)),
            Match.exhaustive,
          )),
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

    const appAttestDispatchMiddleware = createMiddleware(async (c, next) => {
      const command = new AppAttestDispatchCommand({
        iosPackage: c.req.header('Auth-iOS-Package'),
        payload: c.req.header('Auth-Payload'),
        keyId: c.req.header('Auth-iOS-KeyId'),
        challenge: c.req.header('Auth-Challenge'),
        clientId: c.req.header('Auth-ClientId'),
      })

      return Either.match(decideAppAttestDispatch(command), {
        onLeft: (error) =>
          Match.value(error).pipe(
            Match.tag('IncompleteAssertion', ({ missing }) => {
              const missingHeaders = missing.map((field) => ASSERTION_HEADER_NAMES[field] ?? field)
              return c.json({
                _tag: 'IncompleteAssertion',
                error: `Missing required App Attest headers: ${missingHeaders.join(', ')}`,
                missing: missingHeaders,
              }, 401)
            }),
            Match.exhaustive,
          ),
        onRight: (decision) =>
          Match.value(decision).pipe(
            Match.tag('Skip', () => next()),
            Match.tag('Verify', () => appAttestMiddleware(c, next)),
            Match.exhaustive,
          ),
      })
    })

    return HonoCombine.every(
      enforceAuthMiddleware,
      androidAttestationDispatchMiddleware,
      appAttestDispatchMiddleware,
    )
  })
