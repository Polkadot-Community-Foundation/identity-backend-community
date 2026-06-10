import { REGISTER_SIGNATURE_MESSAGE_PREFIX, USERNAME_DIGIT_V1_SET } from '#root/constants.js'
import { DB } from '#root/db/drizzle.js'
import * as schema from '#root/db/schema.js'
import type { IndividualityUsernameService } from '#root/features/individuality/services/username-availability.service.js'
import * as DigitSelection from '#root/features/username-registration/digit-selection.js'
import { createOpenAPIHono, ProblemDetailWithErrorsZod, problemResponse } from '#root/lib/problem-details.js'
import { withRouteTimeout } from '#root/lib/route-timeout.js'
import { makeDeviceCheckIOSMiddleware } from '#root/middleware/auth/device-check.js'
import { BaseUsername, UsernameDigits } from '#root/schema/username.js'
import { bridgeSpanContext } from '#root/tracing/bridge-span-context.js'
import type { HttpBindings } from '@hono/node-server'
import { createRoute, z } from '@hono/zod-openapi'
import type { DeviceCheckService } from '@identity-backend/auth/services'
import { type DeviceCheckVariables, IOS_DEVICE_TOKEN_VAR } from '@identity-backend/hono-auth/device-check'
import type { Ss58String } from '@identity-backend/substrate-schema'
import type { SpanContext } from '@opentelemetry/api'
import { encodeHex } from '@std/encoding'
import {
  Cause,
  Context,
  Effect,
  Either,
  Exit,
  HashMap,
  HashSet,
  Layer,
  Match,
  Option,
  Random,
  Runtime,
  Schema as S,
} from 'effect'
import { RegisterUsernamesV1Request, RegisterUsernamesV1Response } from './types.js'

export class UsernameAlreadyTakenError extends S.TaggedError<UsernameAlreadyTakenError>()(
  'UsernameAlreadyTakenError',
  {
    username: S.String,
    digits: S.String,
  },
) {}

export namespace RegisterUsernamesV1RouteConfig {
  export interface VerifySignatureParams {
    signature: Uint8Array
    message: Uint8Array
    candidateAccountId: Ss58String
  }
}

type VerifySignatureParams = RegisterUsernamesV1RouteConfig.VerifySignatureParams

export class RegisterUsernamesV1RouteConfig
  extends Context.Tag('identity-backend-container/routes/v1/username/register/routes/RegisterUsernamesV1RouteConfig')<
    RegisterUsernamesV1RouteConfig,
    {
      getNetwork: () => Effect.Effect<'westend2' | 'paseo' | 'polkadot'>
      getMaxUsernameBaseLength: () => Effect.Effect<number>
      validateSs58Address: (address: string) => Effect.Effect<Option.Option<Ss58String>>
      verifySignature: (params: VerifySignatureParams) => Effect.Effect<boolean>
      checkUsernamesAvailability: IndividualityUsernameService['checkAvailability']
      registerIOSDevice: DeviceCheckService['Type']['register']
      dotnsGatewayEnabled: boolean
      getDotnsTimeBounds: () => Effect.Effect<{
        readonly intakeFreshnessMaxAgeSeconds: number
        readonly maxFutureSkewSeconds: number
      }>
    }
  >()
{}
const IOS_DEVICE_TOKEN_HEADER = 'Device-Token-iOS' as const

export class UsernameRegistrationPersistenceError
  extends S.TaggedError<UsernameRegistrationPersistenceError>()('UsernameRegistrationPersistenceError', {
    cause: S.optionalWith(S.Unknown, { nullable: true }),
  })
{}

export class IOSDeviceRegistrationFailedError
  extends S.TaggedError<IOSDeviceRegistrationFailedError>()('IOSDeviceRegistrationFailedError', {
    cause: S.optionalWith(S.Unknown, { nullable: true }),
  })
{}

type RegistrationTxError =
  | UsernameAlreadyTakenError
  | IOSDeviceRegistrationFailedError
  | UsernameRegistrationPersistenceError

export const makeRegisterUsernameRouteWithoutDependencies = Effect.gen(function*() {
  const {
    getNetwork,
    getMaxUsernameBaseLength: getMaxUsernameLength,
    validateSs58Address,
    verifySignature,
    checkUsernamesAvailability,
    registerIOSDevice,
    dotnsGatewayEnabled,
    getDotnsTimeBounds,
  } = yield* RegisterUsernamesV1RouteConfig
  const runtime = yield* Effect.runtime()
  const db = yield* DB
  const random = yield* Effect.random

  const config = yield* Effect.all({
    network: getNetwork(),
    maxUsernameLength: getMaxUsernameLength(),
  })

  return createOpenAPIHono<{
    Bindings: HttpBindings
    Variables: DeviceCheckVariables & {
      spanContext?: SpanContext
    }
  }>()
    .openapi(
      createRoute({
        summary: 'Register Username',
        description: 'Registers a username on-chain for a given SS58 address.\n',
        method: 'post',
        path: '/',
        tags: ['v1'],
        security: [{ bearerAuth: [] }],
        request: {
          headers: z.object({
            [IOS_DEVICE_TOKEN_HEADER]: z.string().base64().optional()
              .openapi({
                description: 'Base64-encoded Apple DeviceCheck device token.',
                examples: ['AgAAABEuCTMX76f2R1TNNVkWUcwEUNk0'],
              }),
            'Auth-iOS-Package': z.string().optional()
              .openapi({
                description: 'iOS bundle identifier.',
                examples: ['com.example.app'],
              }),
          }),
          body: {
            required: true,
            content: {
              'application/json': {
                schema: RegisterUsernamesV1Request
                  .superRefine(async (body, ctx) => {
                    const result = await Effect.gen(function*() {
                      yield* Option.match(yield* validateSs58Address(body.candidateAccountId), {
                        onNone: () =>
                          Effect.sync(() => {
                            ctx.addIssue({
                              code: 'custom',
                              path: ['candidateAccountId'],
                              message: `Invalid ss58 address.`,
                            })
                          }),
                        onSome: (candidateAccountId) =>
                          Effect.gen(function*() {
                            const { ss58Decode } = yield* Effect.promise(() => import('@polkadot-labs/hdkd-helpers'))

                            const message = new Uint8Array([
                              ...new TextEncoder().encode(REGISTER_SIGNATURE_MESSAGE_PREFIX),
                              ...ss58Decode(candidateAccountId)[0],
                              ...body.ringVrfKey,
                            ])
                            const isValidSignature = yield* verifySignature({
                              signature: body.candidateSignature,
                              message,
                              candidateAccountId,
                            })

                            if (!isValidSignature) {
                              yield* Effect.sync(() => {
                                ctx.addIssue({
                                  code: 'custom',
                                  path: ['candidateSignature'],
                                  message: `Invalid signature.`,
                                })
                              })
                            }
                          }),
                      })

                      if (body.username.length > config.maxUsernameLength) {
                        yield* Effect.sync(() => {
                          ctx.addIssue({
                            code: 'custom',
                            path: ['username'],
                            message: `Username sum exceeds the maximum length: (${config.maxUsernameLength}).`,
                          })
                        })
                      }

                      if (body.dotns !== undefined) {
                        if (!dotnsGatewayEnabled) {
                          yield* Effect.sync(() => {
                            ctx.addIssue({
                              code: 'custom',
                              path: ['dotns'],
                              message: 'dotNS gateway is not enabled in this environment.',
                            })
                          })
                          return
                        }
                        const nowSeconds = Math.floor(Date.now() / 1000)
                        const { signedAt } = body.dotns
                        const { intakeFreshnessMaxAgeSeconds, maxFutureSkewSeconds } = yield* getDotnsTimeBounds()

                        if (signedAt > nowSeconds + maxFutureSkewSeconds) {
                          yield* Effect.sync(() => {
                            ctx.addIssue({
                              code: 'custom',
                              path: ['dotns', 'signedAt'],
                              message: `signedAt is in the future (tolerance ${maxFutureSkewSeconds}s).`,
                            })
                          })
                        }
                        if (nowSeconds - signedAt > intakeFreshnessMaxAgeSeconds) {
                          yield* Effect.sync(() => {
                            ctx.addIssue({
                              code: 'custom',
                              path: ['dotns', 'signedAt'],
                              message:
                                `signedAt is older than the intake freshness bound (${intakeFreshnessMaxAgeSeconds}s). ` +
                                `Re-sign with a fresh timestamp and resubmit.`,
                            })
                          })
                        }
                      }
                    }).pipe(
                      (eff) => eff.pipe(withRouteTimeout, Effect.exit, Runtime.runPromise(runtime)),
                    )

                    if (Exit.isFailure(result)) {
                      throw Cause.squash(result.cause)
                    }

                    return z.NEVER
                  }).transform(async (body) => ({
                    candidateAccountId: body.candidateAccountId,
                    candidateSignature: body.candidateSignature,
                    consumerRegistrationSignature: body.consumerRegistrationSignature,
                    ringVrfKey: body.ringVrfKey,
                    proofOfOwnership: body.proofOfOwnership,
                    identifierKey: body.identifierKey,
                    preferredDigits: body.preferredDigits,
                    baseUsername: body.username,
                    dotns: body.dotns,
                  })),
              },
            },
          },
        },
        responses: {
          200: {
            content: {
              'application/json': {
                schema: z.object({
                  registrationOutcome: z.enum(['PAYMENT_REQUIRED']),
                }),
              },
            },
            description: 'Device already registered — payment required to proceed',
          },
          202: {
            content: {
              'application/json': {
                schema: RegisterUsernamesV1Response,
              },
            },
            description: 'Accepted',
          },
          400: { ...problemResponse(ProblemDetailWithErrorsZod), description: 'Bad Request' },
          401: {
            content: {
              'application/json': {
                schema: z.object({
                  error: z.string(),
                }),
              },
            },
            description: 'Unauthorized — invalid or missing JWT',
          },
          409: {
            content: {
              'application/json': {
                schema: z.object({
                  error: z.string(),
                }),
              },
            },
            description: 'Conflict',
          },
          429: {
            content: {
              'text/plain': {
                schema: z.unknown(),
              },
            },
            description: 'Rate Limit Exceeded',
          },
          500: {
            content: {
              'application/json': {
                schema: z.object({
                  error: z.string(),
                }),
              },
            },
            description: 'Internal Server Error',
          },
        },
      }),
      async (c) => {
        const {
          baseUsername,
          candidateAccountId,
          candidateSignature,
          consumerRegistrationSignature,
          ringVrfKey,
          proofOfOwnership,
          identifierKey,
          preferredDigits,
          dotns,
        } = c.req.valid('json')

        const handler = Effect.gen(function*() {
          const availability = yield* checkUsernamesAvailability({
            usernames: HashSet.make(BaseUsername.make(baseUsername)),
          })

          const allocatedDigitsOption = HashMap.get(availability, BaseUsername.make(baseUsername))
          const allocatedDigits = Option.match(allocatedDigitsOption, {
            onNone: () => HashSet.empty<string>(),
            onSome: (digitsSet) => digitsSet,
          })

          const allocatedDigitValues = HashSet.fromIterable(HashSet.values(allocatedDigits))
          const availableDigits = USERNAME_DIGIT_V1_SET
            .filter((digit) => !HashSet.has(allocatedDigitValues, digit))
            .map((v) => UsernameDigits.make(v))

          if (availableDigits.length === 0) {
            return yield* Effect.fail(new DigitSelection.NoDigitsAvailableError({ baseUsername }))
          }

          const selectedDigits = yield* DigitSelection.selectDigits(
            preferredDigits
              ? { availableDigits, preferredDigits: UsernameDigits.make(preferredDigits), baseUsername }
              : { availableDigits, baseUsername },
          )

          const deviceState = c.get(IOS_DEVICE_TOKEN_VAR)

          yield* Match.value(deviceState).pipe(
            Match.tag('DeviceCheckAlreadyUsed', (err) => Effect.fail(err)),
            Match.tag('DeviceCheckFailed', (err) => Effect.fail(err)),
            Match.orElse(() => Effect.void),
          )

          const trace = yield* Effect.currentSpan.pipe(Effect.orElse(() => Effect.succeed(null)))

          yield* Effect.async<
            void,
            | UsernameAlreadyTakenError
            | IOSDeviceRegistrationFailedError
            | UsernameRegistrationPersistenceError
          >(
            (resume) => {
              let captured: RegistrationTxError | undefined
              db.transaction(async (tx) => {
                const result = await Runtime.runPromise(runtime)(
                  Effect.gen(function*() {
                    const inserted = yield* Effect.tryPromise(() =>
                      tx.insert(schema.individualityUsernames)
                        .values({
                          username: baseUsername,
                          reservedUsername: dotns?.reservedUsername ?? null,
                          digits: selectedDigits,
                          network: config.network,
                          candidateAccountId,
                          candidateSignature: encodeHex(candidateSignature),
                          consumerRegistrationSignature: encodeHex(consumerRegistrationSignature),
                          ringVrfKey: encodeHex(ringVrfKey),
                          proofOfOwnership: encodeHex(proofOfOwnership),
                          identifierKey: encodeHex(identifierKey),
                          candidateSignatureDotns: dotns !== undefined ? encodeHex(dotns.signature) : null,
                          signedAt: dotns !== undefined ? new Date(dotns.signedAt * 1000) : null,
                          status: 'RESERVED',
                          ahStatus: dotns !== undefined ? 'RESERVED' : 'PENDING',
                          traceId: trace?.traceId ?? null,
                          spanId: trace?.spanId ?? null,
                        })
                        .onConflictDoNothing()
                        .returning()
                    ).pipe(
                      Effect.mapError((cause) => new UsernameRegistrationPersistenceError({ cause })),
                    )

                    if (inserted.length === 0) {
                      return yield* Effect.fail(
                        new UsernameAlreadyTakenError({ username: baseUsername, digits: selectedDigits }),
                      )
                    }

                    yield* Match.value(deviceState).pipe(
                      Match.tag('DeviceCheckAvailable', (state) =>
                        registerIOSDevice(state.deviceToken).pipe(
                          Effect.mapError((cause) => new IOSDeviceRegistrationFailedError({ cause })),
                        )),
                      Match.orElse(() => Effect.void),
                    )
                  }).pipe(
                    Effect.either,
                    Effect.exit,
                  ),
                )

                if (Exit.isFailure(result)) {
                  throw Cause.squash(result.cause)
                }

                const either = result.value

                if (Either.isLeft(either)) {
                  captured = either.left
                  throw either.left
                }
              }).then(
                () => resume(Effect.void),
                (err: unknown) => resume(captured !== undefined ? Effect.fail(captured) : Effect.die(err)),
              )
            },
          )

          return {
            base_username: baseUsername,
            digits: selectedDigits,
            username: `${baseUsername}.${selectedDigits}`,
          }
        }).pipe(
          Effect.withSpan('v1.register_username'),
        )

        const result = await bridgeSpanContext(handler, c).pipe(
          Effect.provide(Layer.succeed(Random.Random, random)),
          Effect.map((value) => c.json(value, 202)),
          Effect.catchTag(
            'PreferredDigitsTakenError',
            (err) =>
              Effect.succeed(c.json(
                {
                  error: `Preferred digits ${err.preferredDigits} already taken for username ${err.baseUsername}`,
                },
                409,
              )),
          ),
          Effect.catchTag(
            'NoDigitsAvailableError',
            (err) =>
              Effect.succeed(c.json(
                { error: `No digits available for username ${err.baseUsername}.` },
                409,
              )),
          ),
          Effect.catchTag(
            'UsernameAlreadyTakenError',
            (err) =>
              Effect.succeed(c.json(
                { error: `Username ${err.username}.${err.digits} already taken. Please try different digits.` },
                409,
              )),
          ),
          Effect.catchTag(
            'IOSDeviceRegistrationFailedError',
            () =>
              Effect.succeed(c.json(
                { error: 'Failed to mark iOS device as registered with Apple DeviceCheck' },
                500,
              )),
          ),
          Effect.catchTag(
            'DeviceCheckAlreadyUsed',
            () =>
              Effect.succeed(c.json(
                { registrationOutcome: 'PAYMENT_REQUIRED' as const },
                200,
              )),
          ),
          Effect.catchTag(
            'UsernameRegistrationPersistenceError',
            () =>
              Effect.succeed(c.json(
                { error: 'Failed to persist username registration' },
                500,
              )),
          ),
          Effect.catchTag(
            'DeviceCheckFailed',
            () =>
              Effect.succeed(c.json(
                { error: 'Device check failed' },
                500,
              )),
          ),
          withRouteTimeout,
          Effect.exit,
          Runtime.runPromise(runtime),
        )

        if (Exit.isFailure(result)) {
          throw Cause.squash(result.cause)
        }

        return result.value
      },
    )
})

export const makeRegisterUsernameRoute = Effect.fn('v1.make_register_username_route')(() =>
  Effect.gen(function*() {
    const registerRoute = yield* makeRegisterUsernameRouteWithoutDependencies.pipe(
      Effect.provide(Layer.unwrapEffect(Effect.gen(function*() {
        const { layerRegisterUsernameV1Routes } = yield* Effect.promise(() => import('./layer.js'))

        return layerRegisterUsernameV1Routes
      }))),
    )
    const deviceCheckMiddleware = yield* makeDeviceCheckIOSMiddleware(IOS_DEVICE_TOKEN_HEADER)

    return createOpenAPIHono()
      .use(deviceCheckMiddleware)
      .route('/', registerRoute)
  })
)
