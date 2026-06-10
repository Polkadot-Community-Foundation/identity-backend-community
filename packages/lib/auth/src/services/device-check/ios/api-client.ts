import { HttpClient, HttpClientRequest, HttpClientResponse } from '@effect/platform'
import { Clock, Context, Effect, Layer } from 'effect'
import { encodeBase64 } from 'effect/Encoding'
import { DeviceCheckError } from '../mod.js'
import { DeviceCheckIOSJWTService } from './jwt-service.js'
import { BitState } from './types.js'

/**
 * @internal
 */
interface EndpointPayload {
  '/query_two_bits': {
    device_token: string
    transaction_id: string
    timestamp: number
  }
  '/update_two_bits': {
    device_token: string
    transaction_id: string
    timestamp: number
    bit0: boolean
    bit1: boolean
  }
}

export class DeviceCheckIOSApiClientEnvironment
  extends Context.Tag('@identity-backend/auth/services/device-check/ios/api-client/DeviceCheckIOSApiClientEnvironment')<
    DeviceCheckIOSApiClientEnvironment,
    {
      getBaseURL: () => Effect.Effect<string>
    }
  >()
{}

export class DeviceCheckIOSAPIClientConfig
  extends Context.Tag('@identity-backend/auth/services/device-check/ios/api-client/DeviceCheckIOSAPIClientConfig')<
    DeviceCheckIOSAPIClientConfig,
    {
      getJWT: DeviceCheckIOSJWTService['getJWT']
      createTransactionId: () => Effect.Effect<string>
    }
  >()
{}

export namespace DeviceCheckIOSAPIClient {
  export interface Service {
    queryTwoBits: (deviceToken: Uint8Array) => Effect.Effect<BitState | undefined, DeviceCheckError>
    updateTwoBits: (
      deviceToken: Uint8Array,
      bits: readonly [boolean, boolean],
    ) => Effect.Effect<void, DeviceCheckError>
  }
}

type Service = DeviceCheckIOSAPIClient.Service

export class DeviceCheckIOSAPIClient extends Effect.Service<DeviceCheckIOSAPIClient>()(
  '@identity-backend/auth/services/device-check/ios/api-client/DeviceCheckIOSAPIClient',
  {
    effect: Effect.gen(function*() {
      const { getJWT, createTransactionId } = yield* DeviceCheckIOSAPIClientConfig
      const { baseURL } = yield* DeviceCheckIOSApiClientEnvironment.pipe(
        Effect.andThen((env) => Effect.all({ baseURL: env.getBaseURL() })),
      )

      const httpClient = (yield* HttpClient.HttpClient).pipe(
        HttpClient.filterStatusOk,
        HttpClient.retryTransient({ times: 3 }),
      )

      const callDeviceCheck = Effect.fn('device_check_ios.call_device_check')(
        function*<EP extends keyof EndpointPayload>(
          path: EP,
          payload: EndpointPayload[EP],
        ) {
          const token = yield* getJWT()

          return yield* httpClient.execute(
            yield* HttpClientRequest.post(path).pipe(
              HttpClientRequest.prependUrl(baseURL),
              HttpClientRequest.bearerToken(token),
              HttpClientRequest.bodyJson(payload),
            ),
          ).pipe(
            Effect.timeout('5 seconds'),
          )
        },
        Effect.mapError((cause) => new DeviceCheckError({ cause })),
      )

      const queryTwoBits = (Effect.fn('device_check_ios.query_two_bits')(
        function*(deviceToken) {
          return yield* callDeviceCheck('/query_two_bits', {
            device_token: encodeBase64(deviceToken),
            transaction_id: yield* createTransactionId(),
            timestamp: yield* Clock.currentTimeMillis,
          })
        },
        Effect.flatMap((res) => {
          // Assumes 200 response (we would have errored otherwise)
          // Try to parse BitState. Otherwise we got a "no bits set"
          // message, so give undefined.
          return HttpClientResponse.schemaBodyJson(BitState)(res).pipe(
            Effect.catchAll(() => Effect.succeed(undefined)),
          )
        }),
      )) satisfies Service['queryTwoBits']

      const updateTwoBits = (Effect.fn('device_check_ios.update_two_bits')(
        function*(deviceToken, bits) {
          yield* callDeviceCheck('/update_two_bits', {
            device_token: encodeBase64(deviceToken),
            transaction_id: yield* createTransactionId(),
            timestamp: yield* Clock.currentTimeMillis,
            bit0: bits[0],
            bit1: bits[1],
          })
        },
      )) satisfies Service['updateTwoBits']

      return {
        queryTwoBits,
        updateTwoBits,
      }
    }),
    dependencies: [
      Layer.effect(
        DeviceCheckIOSAPIClientConfig,
        Effect.gen(function*() {
          const { getJWT } = yield* DeviceCheckIOSJWTService

          return {
            getJWT,
            createTransactionId: () => Effect.sync(() => crypto.randomUUID()),
          }
        }),
      ).pipe(
        Layer.provide(DeviceCheckIOSJWTService.Default),
      ),
    ],
  },
) {}
