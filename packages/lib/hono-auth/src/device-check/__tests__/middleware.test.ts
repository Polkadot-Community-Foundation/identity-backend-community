import { it } from '@effect/vitest'
import { DeviceCheckService } from '@identity-backend/auth/services'
import { Effect, Layer } from 'effect'
import { Hono } from 'hono'
import { testClient } from 'hono/testing'
import { beforeEach, describe, expect, vi } from 'vitest'
import { makeDeviceCheckMiddleware } from '../middleware.js'
import { IOS_DEVICE_TOKEN_VAR } from '../types.js'
import type { DeviceCheckVariables } from '../types.js'

const TEST_HEADER = 'Device-Token-iOS'

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

  const makeClient = Effect.gen(function*() {
    const deviceCheckMiddleware = yield* makeDeviceCheckMiddleware({ headerName: TEST_HEADER })
    return yield* Effect.sync(() => {
      const app = new Hono<{ Variables: DeviceCheckVariables }>()
        .use(deviceCheckMiddleware)
        .post('/test', async (c) => {
          const state = c.get(IOS_DEVICE_TOKEN_VAR)
          return c.json({ kind: state.constructor.name })
        })

      return testClient(app)
    })
  })

  it.layer(layer)((it) => {
    it.effect('Should_SetDeviceAvailable_When_DeviceNotRegistered', () =>
      Effect.gen(function*() {
        isRegistered.mockImplementation(() => Effect.succeed(false))

        const client = yield* makeClient
        const res = yield* Effect.tryPromise(() =>
          client.test.$post(
            {},
            {
              headers: {
                [TEST_HEADER]: 'AgAAABEuCTMX76f2R1TNNVkWUcwEUNk0',
              },
            },
          )
        )

        expect(res.status).toBe(200)
        const body = yield* Effect.promise(() => res.json() as Promise<{ kind: string }>)
        expect(body.kind).toBe('DeviceCheckAvailable')
        expect(isRegistered).toHaveBeenCalledTimes(1)
      }))

    it.effect('Should_SetAlreadyUsed_When_DeviceRegistered', () =>
      Effect.gen(function*() {
        isRegistered.mockImplementation(() => Effect.succeed(true))

        const client = yield* makeClient
        const res = yield* Effect.tryPromise(() =>
          client.test.$post(
            {},
            {
              headers: {
                [TEST_HEADER]: 'AgAAABEuCTMX76f2R1TNNVkWUcwEUNk0',
              },
            },
          )
        )

        expect(res.status).toBe(200)
        const body = yield* Effect.promise(() => res.json() as Promise<{ kind: string }>)
        expect(body.kind).toBe('DeviceCheckAlreadyUsed')
        expect(isRegistered).toHaveBeenCalledTimes(1)
      }))

    it.effect('Should_SetInactive_When_DeviceTokenMissing', () =>
      Effect.gen(function*() {
        isRegistered.mockImplementation(() => Effect.succeed(false))

        const client = yield* makeClient
        const res = yield* Effect.tryPromise(() => client.test.$post({}, { headers: {} }))

        expect(res.status).toBe(200)
        const body = yield* Effect.promise(() => res.json() as Promise<{ kind: string }>)
        expect(body.kind).toBe('DeviceCheckInactive')
        expect(isRegistered).not.toHaveBeenCalled()
      }))

    it.effect('Should_SetInactive_When_DeviceTokenNotBase64', () =>
      Effect.gen(function*() {
        const client = yield* makeClient

        const res = yield* Effect.tryPromise(() =>
          client.test.$post({}, { headers: { [TEST_HEADER]: '***not-b64***' } })
        )

        expect(res.status).toBe(200)
        const body = yield* Effect.promise(() => res.json() as Promise<{ kind: string }>)
        expect(body.kind).toBe('DeviceCheckInactive')
        expect(isRegistered).not.toHaveBeenCalled()
      }))
  })
})
