import { MAX_USERNAME_LENGTH, N_USERNAME_DIGITS } from '#root/constants.js'
import { IndividualityUsernameService } from '#root/features/individuality/services/username-availability.service.js'
import { DotnsGatewayAPI } from '#root/infrastructure/adapters/blockchain/dotns-gateway.adapter.js'
import { DeviceCheckService } from '@identity-backend/auth/services'
import { Effect, Layer, Option, Schema as S } from 'effect'
import { RegisterUsernamesV1RouteConfig } from './routes.js'

const PREFIX = 'register_usernames_v1_route'

export const layerRegisterUsernameV1Routes = Layer.effect(
  RegisterUsernamesV1RouteConfig,
  Effect.gen(function*() {
    const { encodeHex } = yield* Effect.promise(() => import('@std/encoding/hex'))
    const { sr25519, ss58Decode } = yield* Effect.promise(() => import('@polkadot-labs/hdkd-helpers'))
    const { Ss58String } = yield* Effect.promise(() => import('@identity-backend/substrate-schema'))
    const {
      PEOPLE_NETWORK,
      DOTNS_GATEWAY_ENABLED,
    } = yield* Effect.promise(() => import('#root/config.js'))
    const usernameService = yield* IndividualityUsernameService
    const deviceCheckOption = yield* Effect.serviceOption(DeviceCheckService)

    const registerIOSDevice: DeviceCheckService['Type']['register'] = Option.match(deviceCheckOption, {
      onNone: () => () => Effect.dieMessage('registerIOSDevice called when DEVICE_CHECK_IOS_ENABLED=false'),
      onSome: (svc) => svc.register,
    })

    const network = yield* PEOPLE_NETWORK
    const dotnsGatewayEnabled = yield* DOTNS_GATEWAY_ENABLED

    const getNetwork = Effect.fn(`${PREFIX}.get_suffix`)(function*() {
      yield* Effect.annotateCurrentSpan({ network })

      return network
    })

    const getMaxUsernameBaseLength = Effect.fn(`${PREFIX}.get_max_username_length`)(function*() {
      yield* Effect.annotateCurrentSpan({ length: MAX_USERNAME_LENGTH })

      return MAX_USERNAME_LENGTH - N_USERNAME_DIGITS - 1 // account for dot
    })

    const validateSs58Address = (Effect.fn(`${PREFIX}.validate_ss58Address`)(function*(address) {
      yield* Effect.annotateCurrentSpan({ address })

      return S.decodeOption(Ss58String)(address)
    })) satisfies RegisterUsernamesV1RouteConfig['Type']['validateSs58Address']

    const verifySignature = (Effect.fn(`${PREFIX}.verifySignature`)(
      function*(params) {
        yield* Effect.annotateCurrentSpan({
          signature: encodeHex(params.signature),
          message: new TextDecoder().decode(params.message),
          candidateAccountId: encodeHex(params.candidateAccountId),
        })

        const publicKey = yield* Effect.sync(() => ss58Decode(params.candidateAccountId)[0])

        yield* Effect.annotateCurrentSpan({ publicKey: encodeHex(publicKey) })

        const isValidSignature = yield* Effect.sync(() =>
          sr25519.verify(
            params.signature,
            params.message,
            publicKey,
          )
        )

        yield* Effect.annotateCurrentSpan({ isValidSignature })

        return isValidSignature
      },
    )) satisfies RegisterUsernamesV1RouteConfig['Type']['verifySignature']

    const getDotnsTimeBounds = Effect.fn(`${PREFIX}.get_dotns_time_bounds`)(function*() {
      const dotnsGatewayOption = yield* Effect.serviceOption(DotnsGatewayAPI)
      if (Option.isNone(dotnsGatewayOption)) {
        return yield* Effect.dieMessage('getDotnsTimeBounds called when DOTNS_GATEWAY_ENABLED=false')
      }
      const dotnsGateway = dotnsGatewayOption.value
      return {
        intakeFreshnessMaxAgeSeconds: dotnsGateway.intakeFreshnessMaxAgeSeconds,
        maxFutureSkewSeconds: dotnsGateway.chainConstants.maxFutureSkewSeconds,
      }
    })

    return {
      getNetwork,
      getMaxUsernameBaseLength,
      validateSs58Address,
      verifySignature,
      checkUsernamesAvailability: usernameService.checkAvailability,
      registerIOSDevice,
      dotnsGatewayEnabled,
      getDotnsTimeBounds,
    } satisfies RegisterUsernamesV1RouteConfig['Type'] as RegisterUsernamesV1RouteConfig['Type']
  }),
)
