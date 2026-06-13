import { DBTest } from '#root/db/drizzle.js'
import { DefectReporter } from '#root/infrastructure/observability/mod.js'
import { it } from '@effect/vitest'
import { DeviceCheckError } from '@identity-backend/auth/services'
import {
  DEVICE_CHECK_DECISION_VAR,
  DeviceCheckBlocked,
  DeviceCheckProceed,
  DeviceCheckRegister,
  DeviceCheckTokenRequired,
  type DeviceCheckVariables,
} from '@identity-backend/hono-auth/device-check'
import type { Ss58String } from '@identity-backend/substrate-schema'
import { Effect, HashMap, Layer, Option } from 'effect'
import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'
import { describe, expect, vi } from 'vitest'
import { makeRegisterUsernameRouteWithoutDependencies, RegisterUsernamesV1RouteConfig } from '../routes.js'

const VALID_SS58 = '5FbRAkhDvNVecNzHLFxBNXFXNwvBaV69S1W3nfBbnxYypkkT'

const hex = (bytes: number) => '0x' + 'a'.repeat(bytes * 2)

const requestBody = (username: string) => ({
  candidateAccountId: VALID_SS58,
  username,
  candidateSignature: hex(64),
  ringVrfKey: hex(32),
  proofOfOwnership: hex(64),
  consumerRegistrationSignature: hex(64),
  identifierKey: hex(65),
})

describe('makeRegisterUsernameRoute device-check rendering', () => {
  const registerIOSDevice = vi.fn<RegisterUsernamesV1RouteConfig['Type']['registerIOSDevice']>()

  const configLayer = Layer.succeed(RegisterUsernamesV1RouteConfig, {
    getNetwork: () => Effect.succeed('polkadot'),
    getMaxUsernameBaseLength: () => Effect.succeed(29),
    validateSs58Address: (address: string) => Effect.succeed(Option.some(address as Ss58String)),
    verifySignature: () => Effect.succeed(true),
    checkUsernamesAvailability: () => Effect.succeed(HashMap.empty()),
    registerIOSDevice,
    dotnsGatewayEnabled: false,
    getDotnsTimeBounds: () => Effect.succeed({ intakeFreshnessMaxAgeSeconds: 600, maxFutureSkewSeconds: 600 }),
  })

  const layer = Layer.mergeAll(configLayer, DBTest, DefectReporter.NoOp)

  const makeClient = (decision: DeviceCheckVariables[typeof DEVICE_CHECK_DECISION_VAR]) =>
    Effect.map(makeRegisterUsernameRouteWithoutDependencies, (route) => {
      const setDecision: MiddlewareHandler<{ Variables: DeviceCheckVariables }> = async (c, next) => {
        c.set(DEVICE_CHECK_DECISION_VAR, decision)
        return next()
      }
      return new Hono<{ Variables: DeviceCheckVariables }>().use(setDecision).route('/', route)
    })

  const post = (app: { request: (p: string, i: RequestInit) => Response | Promise<Response> }, username: string) =>
    Effect.tryPromise(() =>
      Promise.resolve(app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody(username)),
      }))
    )

  it.layer(layer)((it) => {
    it.effect('Should_RespondPaymentRequired_When_DecisionIsBlocked', () =>
      Effect.gen(function*() {
        registerIOSDevice.mockReset()

        const app = yield* makeClient(new DeviceCheckBlocked())
        const res = yield* post(app, 'blockx')

        expect(res.status).toBe(200)
        expect(yield* Effect.promise(() => res.json())).toEqual({ registrationOutcome: 'PAYMENT_REQUIRED' })
        expect(registerIOSDevice).not.toHaveBeenCalled()
      }))

    it.effect('Should_RegisterAndAdviseTrue_When_DecisionIsRegister', () =>
      Effect.gen(function*() {
        registerIOSDevice.mockReset()
        registerIOSDevice.mockImplementation(() => Effect.void)
        const deviceToken = new Uint8Array([1, 2, 3, 4])

        const app = yield* makeClient(new DeviceCheckRegister({ deviceToken }))
        const res = yield* post(app, 'reggie')

        expect(res.status).toBe(202)
        const body = yield* Effect.promise(() => res.json() as Promise<{ device_check_available?: boolean }>)
        expect(body.device_check_available).toBe(true)
        expect(registerIOSDevice).toHaveBeenCalledTimes(1)
        expect(registerIOSDevice.mock.calls[0]![0]).toEqual(deviceToken)
      }))

    it.effect('Should_AdviseFalseWithoutRegistering_When_DecisionIsProceedUnavailable', () =>
      Effect.gen(function*() {
        registerIOSDevice.mockReset()

        const app = yield* makeClient(new DeviceCheckProceed({ available: Option.some(false) }))
        const res = yield* post(app, 'softno')

        expect(res.status).toBe(202)
        const body = yield* Effect.promise(() => res.json() as Promise<{ device_check_available?: boolean }>)
        expect(body.device_check_available).toBe(false)
        expect(registerIOSDevice).not.toHaveBeenCalled()
      }))

    it.effect('Should_OmitAdvisory_When_DecisionIsProceedWithoutVerdict', () =>
      Effect.gen(function*() {
        registerIOSDevice.mockReset()

        const app = yield* makeClient(new DeviceCheckProceed({ available: Option.none() }))
        const res = yield* post(app, 'silent')

        expect(res.status).toBe(202)
        const body = yield* Effect.promise(() => res.json() as Promise<{ device_check_available?: boolean }>)
        expect(body.device_check_available).toBeUndefined()
        expect(registerIOSDevice).not.toHaveBeenCalled()
      }))

    it.effect('Should_RespondUnauthorized_When_DecisionIsTokenRequired', () =>
      Effect.gen(function*() {
        registerIOSDevice.mockReset()

        const app = yield* makeClient(new DeviceCheckTokenRequired())
        const res = yield* post(app, 'notoken')

        expect(res.status).toBe(401)
        expect(yield* Effect.promise(() => res.json())).toEqual({
          error: 'A valid Device-Token-iOS header is required.',
        })
        expect(registerIOSDevice).not.toHaveBeenCalled()
      }))

    it.effect('Should_RespondServerError_When_RegisterDecisionAndAppleRegistrationFails', () =>
      Effect.gen(function*() {
        registerIOSDevice.mockReset()
        registerIOSDevice.mockImplementation(() => Effect.fail(new DeviceCheckError({ cause: 'apple down' })))
        const deviceToken = new Uint8Array([9, 8, 7, 6])

        const app = yield* makeClient(new DeviceCheckRegister({ deviceToken }))
        const res = yield* post(app, 'failreg')

        expect(res.status).toBe(500)
        expect(yield* Effect.promise(() => res.json())).toEqual({
          error: 'Failed to mark iOS device as registered with Apple DeviceCheck',
        })
        expect(registerIOSDevice).toHaveBeenCalledTimes(1)
      }))
  })
})
