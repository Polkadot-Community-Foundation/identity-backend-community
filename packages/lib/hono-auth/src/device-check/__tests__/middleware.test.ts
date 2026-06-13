import { it } from '@effect/vitest'
import { DeviceCheckService } from '@identity-backend/auth/services'
import { Effect, Either, Layer } from 'effect'
import { decodeBase64 } from 'effect/Encoding'
import { Hono } from 'hono'
import { testClient } from 'hono/testing'
import { beforeEach, describe, expect, vi } from 'vitest'
import { DEVICE_CHECK_DECISION_VAR, type DeviceCheckVariables, makeDeviceCheckMiddleware } from '../middleware.js'

const TEST_HEADER = 'Device-Token-iOS'
const TEST_TOKEN = 'AgAAABEuCTMX76f2R1TNNVkWUcwEUNk0'
const DECODED_TOKEN = Either.getOrThrow(decodeBase64(TEST_TOKEN))

describe('DeviceCheckMiddleware', () => {
  const isRegistered = vi.fn<DeviceCheckService['Type']['isRegistered']>()
  const register = vi.fn<DeviceCheckService['Type']['register']>()
  const reset = vi.fn<DeviceCheckService['Type']['reset']>()

  const layer = Layer.succeed(
    DeviceCheckService,
    { isRegistered, register, reset },
  )

  beforeEach(() => {
    isRegistered.mockReset()
    register.mockReset()
    reset.mockReset()
  })

  const makeClient = (enforceAuth: boolean) =>
    Effect.gen(function*() {
      const deviceCheckMiddleware = yield* makeDeviceCheckMiddleware({ headerName: TEST_HEADER, enforceAuth })
      return yield* Effect.sync(() => {
        const app = new Hono<{ Variables: DeviceCheckVariables }>()
          .use(deviceCheckMiddleware)
          .post('/test', async (c) => c.json({ attached: c.get(DEVICE_CHECK_DECISION_VAR)._tag }))

        return testClient(app)
      })
    })

  const post = (client: { test: { $post: (a: object, b: object) => Promise<Response> } }, headers: object) =>
    Effect.tryPromise(() => client.test.$post({}, { headers }))

  it.layer(layer)((it) => {
    it.effect('Should_NotQueryApple_When_HeaderMissing', () =>
      Effect.gen(function*() {
        isRegistered.mockImplementation(() => Effect.succeed(false))

        const client = yield* makeClient(false)
        const res = yield* post(client, {})

        expect(res.status).toBe(200)
        expect(isRegistered).not.toHaveBeenCalled()
      }))

    it.effect('Should_NotQueryApple_When_HeaderNotBase64', () =>
      Effect.gen(function*() {
        isRegistered.mockImplementation(() => Effect.succeed(false))

        const client = yield* makeClient(false)
        const res = yield* post(client, { [TEST_HEADER]: '***not-b64***' })

        expect(res.status).toBe(200)
        expect(isRegistered).not.toHaveBeenCalled()
      }))

    it.effect('Should_QueryAppleWithDecodedTokenThenAttachAndProceed_When_HeaderValid', () =>
      Effect.gen(function*() {
        isRegistered.mockImplementation(() => Effect.succeed(false))

        const client = yield* makeClient(false)
        const res = yield* post(client, { [TEST_HEADER]: TEST_TOKEN })

        expect(res.status).toBe(200)
        expect(yield* Effect.promise(() => res.json())).toEqual({ attached: 'DeviceCheckProceed' })
        expect(isRegistered).toHaveBeenCalledTimes(1)
        expect(isRegistered.mock.calls[0]![0]).toEqual(DECODED_TOKEN)
      }))

    it.effect('Should_ShortCircuit502_When_GateEvaluationFails', () =>
      Effect.gen(function*() {
        isRegistered.mockImplementation(() => Effect.die('apple down'))

        const client = yield* makeClient(true)
        const res = yield* post(client, { [TEST_HEADER]: TEST_TOKEN })

        expect(res.status).toBe(502)
        expect(yield* Effect.promise(() => res.json())).toEqual({ error: 'iOS DeviceCheck verification failed' })
      }))
  })
})
