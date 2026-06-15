import { createOpenAPIHono, ProblemDetailWithErrorsZod, problemResponse } from '#root/lib/problem-details.js'
import { withRouteTimeout } from '#root/lib/route-timeout.js'
import type { HttpBindings } from '@hono/node-server'
import { createRoute, z } from '@hono/zod-openapi'
import {
  AppAttestationData,
  type AppAttestService,
  type ChallengeService,
  KeyId,
} from '@identity-backend/auth/services'
import { bridgeSpanContext } from '@identity-backend/observability'
import { decodeBase64, encodeBase64 } from '@std/encoding'
import { Cause, Context, Effect, Exit, Layer, Runtime } from 'effect'

export class AuthRoutesConfig extends Context.Tag('@app/AuthRoutesConfig')<
  AuthRoutesConfig,
  {
    readonly verifyAttestation: AppAttestService['verifyAttestation']
    readonly makeChallenge: ChallengeService['Type']['makeChallenge']
    readonly persistAttestation: AppAttestService['persistAttestation']
  }
>() {}

export namespace AuthRoutes {
  export type Options = Readonly<{
    tags?: string[]
  }>
}

export const makeAuthRoutesWithoutDependencies = (options: AuthRoutes.Options = {}) =>
  Effect.gen(function*() {
    const runtime = yield* Effect.runtime()
    const {
      makeChallenge,
      verifyAttestation,
      persistAttestation,
    } = yield* AuthRoutesConfig

    return createOpenAPIHono<{
      Bindings: HttpBindings
    }>()
      .openapi(
        createRoute({
          ...(options.tags ? { tags: options.tags } : {}),
          summary: 'Create Auth Challenge',
          description: 'Challenge to be used in a Play Integrity or Apple Attest flow',
          method: 'post',
          path: '/challenges',
          request: {},
          responses: {
            201: {
              content: {
                'application/json': {
                  schema: z.object({
                    challenge: z.string().openapi({
                      description: 'A base64 string representing the challenge',
                      examples: ['ZYoUU5pCBzwic6jAOSe+wQ=='],
                    }),
                  }),
                },
              },
              description: 'Created',
            },
            400: { ...problemResponse(ProblemDetailWithErrorsZod), description: 'Bad Request' },
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
          const handler = Effect.gen(function*() {
            const challenge = yield* makeChallenge()

            return encodeBase64(challenge)
          }).pipe(
            Effect.withSpan('v1.auth_challenge'),
          )

          const result = await bridgeSpanContext(handler, c).pipe(
            Effect.map((value) => c.json({ challenge: value }, 201)),
            withRouteTimeout,
            Effect.exit,
            Runtime.runPromise(runtime),
          )

          if (Exit.isFailure(result)) {
            throw Cause.squash(result.cause)
          }

          return result.value
        },
      ).openapi(
        createRoute({
          ...(options.tags ? { tags: options.tags } : {}),
          summary: 'Verify Apple Attestation',
          description: 'Verifies the Apple attestation provided by the client and returns the challenge if successful.',
          method: 'post',
          path: '/app-attest/attestations',
          request: {
            body: {
              required: true,
              content: {
                'application/json': {
                  schema: z.object({
                    keyId: z.base64().max(128)
                      .transform(decodeBase64)
                      .openapi({
                        description: 'The base64-encoded key identifier for the attestation.',
                        examples: ['s/134MbeEEZDZKCvOTf+jZgNhpoDwdXZ8cKfTym8FUg='],
                      }),
                    challenge: z.base64().max(512)
                      .transform(decodeBase64)
                      .openapi({
                        description: 'The base64-encoded challenge used in the attestation process.',
                        examples: ['NmY0NmFhZWItMzk4OS00NWRiLThjMjQtNmNjODhhNzZlNzg5'],
                      }),
                    attestation: z.base64().max(8192)
                      .transform(decodeBase64)
                      .openapi({
                        description: 'The base64-encoded attestation statement from Apple.',
                      }),
                  }),
                },
              },
            },
          },
          responses: {
            202: {
              content: {
                'application/json': {
                  schema: z.object({}),
                },
              },
              description: 'Accepted',
            },
            400: { ...problemResponse(ProblemDetailWithErrorsZod), description: 'Bad Request' },
            401: {
              content: {
                'application/json': {
                  schema: z.object({
                    _tag: z.union([
                      z.literal('VERIFY_ATTESTATION_FAILED'),
                      z.literal('CHALLENGE_NOT_FOUND'),
                    ]),
                    error: z.string(),
                  }),
                },
              },
              description: 'Unauthorized',
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
          const body = c.req.valid('json')

          const handler = Effect.gen(function*() {
            const verifyResult = yield* verifyAttestation(body)

            const attestation = AppAttestationData.make({
              keyId: KeyId.make(body.keyId),
              publicKey: verifyResult.publicKey,
              receipt: verifyResult.receipt,
            })

            yield* persistAttestation(
              {
                attestation,
                challenge: body.challenge,
              },
            )
          }).pipe(
            Effect.withSpan('v1.auth_attestation'),
          )

          const result = await bridgeSpanContext(handler, c).pipe(
            Effect.map((_value) => c.json({}, 202)),
            Effect.catchTag(
              'AppAttestError',
              (err) =>
                Effect.succeed(c.json(
                  {
                    _tag: 'VERIFY_ATTESTATION_FAILED',
                    error: err.message,
                  } as const,
                  401,
                )),
            ),
            Effect.catchTag(
              'ChallengeRejectedError',
              (_err) =>
                Effect.succeed(c.json(
                  {
                    _tag: 'CHALLENGE_NOT_FOUND',
                    error: `Challenge Not Found`,
                  } as const,
                  401,
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

export const makeAuthRoutes = (options: AuthRoutes.Options = {}) =>
  makeAuthRoutesWithoutDependencies(options).pipe(
    Effect.provide(Layer.unwrapEffect(Effect.gen(function*() {
      const { layerAuthRoutes } = yield* Effect.promise(() => import('./layer.js'))

      return layerAuthRoutes
    }))),
  )
