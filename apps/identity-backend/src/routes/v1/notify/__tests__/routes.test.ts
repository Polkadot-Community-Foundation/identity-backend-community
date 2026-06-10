import { describe, expect, it, vi } from '@effect/vitest'
import { checkResponse } from '@identity-backend/testing/hono'
import { Effect, Layer } from 'effect'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { testClient } from 'hono/testing'
import { afterEach } from 'vitest'
import { makeNotifyRouteWithoutDependencies, NotifyV1RouteConfig } from '../routes.js'

describe('NotifyV1Route', () => {
  const mockDetectPlatform = vi.fn<NotifyV1RouteConfig['Type']['detectPlatform']>()
  const mockSendNotification = vi.fn<NotifyV1RouteConfig['Type']['sendNotification']>()

  const layer = Layer.succeed(NotifyV1RouteConfig, {
    detectPlatform: mockDetectPlatform,
    sendNotification: mockSendNotification,
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  const makeClient = Effect.gen(function*() {
    const routes = yield* makeNotifyRouteWithoutDependencies

    return yield* Effect.sync(() => {
      const app = new Hono()
        .route('/', routes)
        .onError((err, c) => {
          if (err instanceof HTTPException) {
            return err.getResponse()
          }
          return c.json({ error: 'Internal Server Error' }, 500)
        })

      return testClient(app)
    })
  })

  it.effect('Should_Return400_When_DeviceTokenIsMissing', () =>
    Effect.gen(function*() {
      const client = yield* makeClient

      const res = yield* Effect.promise(() =>
        client.index.$post({
          // @ts-expect-error - Testing invalid input
          json: {
            pushId: '5d41402abc4b2a76b9719d911017c592',
            message: '1234567890abcdef',
          },
        })
      )

      expect(res.status).toBe(400)
    }).pipe(Effect.provide(layer)))
  it.effect('Should_Return400_When_MessageIsMissing', () =>
    Effect.gen(function*() {
      const client = yield* makeClient

      const res = yield* Effect.promise(() =>
        client.index.$post({
          // @ts-expect-error - Testing invalid input
          json: {
            deviceToken: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
            pushId: '5d41402abc4b2a76b9719d911017c592',
          },
        })
      )

      expect(res.status).toBe(400)
    }).pipe(Effect.provide(layer)))

  it.effect('Should_Return400_When_DeviceTokenIsInvalidFormat', () =>
    Effect.gen(function*() {
      const client = yield* makeClient

      const res = yield* Effect.promise(() =>
        client.index.$post({
          json: {
            deviceToken: 'invalid-token',
            pushId: '5d41402abc4b2a76b9719d911017c592',
            message: '1234567890abcdef',
          },
        })
      )

      expect(res.status).toBe(400)
    }).pipe(Effect.provide(layer)))

  it.effect('Should_Return400_When_MessageIsInvalidHexFormat', () =>
    Effect.gen(function*() {
      const client = yield* makeClient

      const res = yield* Effect.promise(() =>
        client.index.$post({
          json: {
            deviceToken: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
            pushId: '5d41402abc4b2a76b9719d911017c592',
            message: 'invalid-hex-string',
          },
        })
      )

      expect(res.status).toBe(400)
    }).pipe(Effect.provide(layer)))

  it.effect('Should_AcceptMessageWith0xPrefix_When_ValidHexMessage', () =>
    Effect.gen(function*() {
      const client = yield* makeClient
      const iosToken = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
      const pushId = '5d41402abc4b2a76b9719d911017c592'
      const message = '0x1234567890abcdef'

      mockDetectPlatform.mockReturnValueOnce('ios')
      mockSendNotification.mockReturnValueOnce(
        Effect.succeed({
          success: true,
          platform: 'ios' as const,
          sent: 1,
          failed: 0,
        }),
      )

      const res = yield* Effect.promise(() =>
        client.index.$post({
          json: {
            deviceToken: iosToken,
            pushId,
            message,
          },
        })
      )

      expect(res.status).toBe(200)
      expect(mockSendNotification).toHaveBeenCalledWith({
        deviceToken: iosToken,
        platform: 'ios',
        body: expect.objectContaining({
          message,
        }),
      })
    }).pipe(Effect.provide(layer)))

  it.effect('Should_SendIOSNotification_When_Valid64CharHexToken', () =>
    Effect.gen(function*() {
      const client = yield* makeClient
      const iosToken = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
      const pushId = '5d41402abc4b2a76b9719d911017c592'
      const message = '1234567890abcdef'

      mockDetectPlatform.mockReturnValueOnce('ios')
      mockSendNotification.mockReturnValueOnce(
        Effect.succeed({
          success: true,
          platform: 'ios' as const,
          sent: 1,
          failed: 0,
        }),
      )

      const res = yield* Effect.promise(() =>
        client.index.$post({
          json: {
            deviceToken: iosToken,
            pushId,
            message,
          },
        })
      )

      expect(res.status).toBe(200)
      const json = yield* Effect.promise(() =>
        res.json() as Promise<
          { success: boolean; platform: 'ios' | 'android'; sent?: number; failed?: number; messageId?: string }
        >
      )
      expect(json.success).toBe(true)
      expect(json.platform).toBe('ios')

      expect(mockDetectPlatform).toHaveBeenCalledWith(iosToken, undefined)
      expect(mockSendNotification).toHaveBeenCalledWith({
        deviceToken: iosToken,
        platform: 'ios',
        body: expect.objectContaining({
          deviceToken: iosToken,
          pushId,
          platform: 'ios',
          message,
        }),
      })
    }).pipe(Effect.provide(layer)))

  it.effect('Should_SendAndroidNotification_When_FcmToken', () =>
    Effect.gen(function*() {
      const client = yield* makeClient
      const fcmToken = 'cnynQ0YWTKKe62TJmpG0RU:APA91bHgMg0yBE2DzIKlQeQY8oILclw3qBA7EQDaeFTPdiMxFgHdBGRwn' +
        '8bbNex-LbPvraRs-8KZMO_D0hu2utYtyRV3U1xNefgi7Q_TYL4442wiBfYRtFo'
      const pushId = '5d41402abc4b2a76b9719d911017c592'
      const message = '1234567890abcdef'

      mockDetectPlatform.mockReturnValueOnce('android')
      mockSendNotification.mockReturnValueOnce(
        Effect.succeed({
          success: true,
          platform: 'android' as const,
          messageId: 'mock-message-id',
        }),
      )

      const res = yield* Effect.promise(() =>
        client.index.$post({
          json: {
            deviceToken: fcmToken,
            pushId,
            message,
          },
        })
      )

      expect(res.status).toBe(200)
      const json = yield* Effect.promise(() =>
        res.json() as Promise<
          { success: boolean; platform: 'ios' | 'android'; sent?: number; failed?: number; messageId?: string }
        >
      )
      expect(json.success).toBe(true)
      expect(json.platform).toBe('android')

      expect(mockDetectPlatform).toHaveBeenCalledWith(fcmToken, undefined)
      expect(mockSendNotification).toHaveBeenCalledWith({
        deviceToken: fcmToken,
        platform: 'android',
        body: expect.objectContaining({
          deviceToken: fcmToken,
          pushId,
          platform: 'android',
          message,
        }),
      })
    }).pipe(Effect.provide(layer)))

  it.effect('Should_RespectExplicitPlatformParameter_When_PlatformSpecified', () =>
    Effect.gen(function*() {
      const client = yield* makeClient
      const iosToken = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
      const pushId = '5d41402abc4b2a76b9719d911017c592'
      const message = '1234567890abcdef'

      // Force android platform even with iOS token format
      mockDetectPlatform.mockReturnValueOnce('android')
      mockSendNotification.mockReturnValueOnce(
        Effect.succeed({
          success: true,
          platform: 'android' as const,
          messageId: 'mock-message-id',
        }),
      )

      const res = yield* Effect.promise(() =>
        client.index.$post({
          json: {
            deviceToken: iosToken,
            pushId,
            platform: 'android' as const,
            message,
          },
        })
      )

      expect(res.status).toBe(200)
      const json = yield* Effect.promise(() =>
        res.json() as Promise<
          { success: boolean; platform: 'ios' | 'android'; sent?: number; failed?: number; messageId?: string }
        >
      )
      expect(json.platform).toBe('android')

      expect(mockDetectPlatform).toHaveBeenCalledWith(iosToken, 'android')
    }).pipe(Effect.provide(layer)))

  it.effect('Should_HandleNotificationSendErrors_When_SendFails', () =>
    Effect.gen(function*() {
      const client = yield* makeClient
      const iosToken = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
      const pushId = '5d41402abc4b2a76b9719d911017c592'
      const message = '1234567890abcdef'

      mockDetectPlatform.mockReturnValueOnce('ios')
      mockSendNotification.mockReturnValueOnce(
        Effect.fail(new Error('Network error')),
      )

      const res = yield* Effect.promise(() =>
        client.index.$post({
          json: {
            deviceToken: iosToken,
            pushId,
            message,
          },
        })
      )

      expect(res.status).toBe(200) // Always returns 200
      const json = yield* Effect.promise(() =>
        res.json() as Promise<
          { success: boolean; platform: 'ios' | 'android'; errors?: { device: string; response?: unknown }[] }
        >
      )
      expect(json.success).toBe(false)
      expect(json.errors).toBeDefined()
      expect(json.errors?.[0]?.device).toBe(iosToken)
    }).pipe(Effect.provide(layer)))

  it.effect('Should_SetPushTypeToVoip_When_VoipFieldIsTrueForIOS', () =>
    Effect.gen(function*() {
      // --- @arrange: Set up test data and mocks ---
      const client = yield* makeClient
      const iosToken = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
      const pushId = '5d41402abc4b2a76b9719d911017c592'
      const message = '1234567890abcdef'

      mockDetectPlatform.mockReturnValueOnce('ios')
      mockSendNotification.mockReturnValueOnce(Effect.succeed({
        success: true,
        platform: 'ios' as const,
        sent: 1,
        failed: 0,
      }))

      // --- @act: Send push notification with voip=true ---
      const res = yield* Effect.promise(() =>
        client.index.$post({ json: { deviceToken: iosToken, pushId, message, voip: true } })
      )

      // --- @assert: Verify voip field passed through correctly ---
      checkResponse(res, 200, 'Request should succeed')

      const json = yield* Effect.promise(() => res.json())

      expect.soft(json).toEqual(expect.objectContaining({
        success: true,
        platform: 'ios',
        sent: 1,
      }))

      expect.soft(mockSendNotification, 'sendNotification should be called once').toHaveBeenCalledTimes(1)
      expect.soft(mockSendNotification, 'sendNotification should be called with voip=true').toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({ voip: true }),
        }),
      )
    }).pipe(
      Effect.provide(layer),
    ))
})
