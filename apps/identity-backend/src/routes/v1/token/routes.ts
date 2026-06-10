import {
  ANDROID_PACKAGE_NAMES,
  ANDROID_SIGNING_DIGEST_PLAYSTORE,
  ANDROID_SIGNING_DIGEST_WEBSITE,
} from '#root/config.js'
import { AndroidAttestationCrlService } from '#root/infrastructure/android-attestation-crl.service.js'
import { TokenBucketRateLimiter } from '#root/infrastructure/token-bucket-rate-limiter.service.js'
import { IssueTokenCommand } from '#root/jwt/core/jwt.types.js'
import { IssueTokenUseCase } from '#root/jwt/shell/issue-token.use-case.js'
import { RotateTokenUseCase } from '#root/jwt/shell/rotate-token.use-case.js'
import {
  buildProblemDetail,
  createOpenAPIHono,
  type ProblemDetail,
  ProblemDetailZod,
  type ProblemStatus,
  SMARTBEAR,
} from '#root/lib/problem-details.js'
import { withRouteTimeout } from '#root/lib/route-timeout.js'
import { bridgeSpanContext } from '#root/tracing/bridge-span-context.js'
import type { HttpBindings } from '@hono/node-server'
import { createRoute, z } from '@hono/zod-openapi'
import {
  type AppDistributionFailure,
  AttestationChallenge,
  type AttestationError,
  type AttestationStatementFailure,
  type CertificateChainFailure,
  GRAPHENEOS_VERIFIED_BOOT_KEYS,
  PackageName,
  SigningDigestHex,
  verifyAndroidAttestation as verifyAndroidAttestationLib,
} from '@identity-backend/android-attest'
import { ChallengeService } from '@identity-backend/auth/services'
import type { SpanContext } from '@opentelemetry/api'
import { decodeBase64, encodeBase64 } from '@std/encoding'
import { Cause, Config, Effect, Exit, Match, Redacted, Runtime, Schema as S } from 'effect'
import { decideKeyAttestationDispatch } from './key-attestation-dispatch.workflow.js'
import { RefreshTokenRequest, RefreshTokenResponse, TokenRequest, TokenRequestHeaders, TokenResponse } from './types.js'

class AndroidAttestationRateLimitExceededError
  extends S.TaggedError<AndroidAttestationRateLimitExceededError>()('AndroidAttestationRateLimitExceededError', {})
{}

const buildProblemBody = (title: string, detail: string, status: ProblemStatus = 403): ProblemDetail =>
  buildProblemDetail({
    slug: 'business-rule-violation',
    title,
    detail,
    status,
  })

const chainProblem = (cause: CertificateChainFailure): ProblemDetail =>
  Match.value(cause).pipe(
    Match.tag(
      'ChainVerificationFailedError',
      (c) => buildProblemBody('Certificate Chain Verification Failed', c.detail),
    ),
    Match.tag('RootNotTrustedError', () =>
      buildProblemBody(
        'Certificate Chain Root Not Trusted',
        'Certificate chain root is not chained to a trusted Google root',
      )),
    Match.tag(
      'ChainTooLongError',
      (c) =>
        buildProblemBody('Certificate Chain Too Long', `Certificate chain length ${c.length} exceeds maximum ${c.max}`),
    ),
    Match.tag('InvalidDnChainError', (c) => buildProblemBody('Invalid Certificate Chain DN', c.detail)),
    Match.tag('KeyUsageViolationError', (c) => buildProblemBody('Certificate Key Usage Violation', c.detail)),
    Match.tag('CertificateNotYetValidError', (c) =>
      buildProblemBody(
        'Certificate Not Yet Valid',
        `Certificate at position ${c.position} is not valid until ${c.notBefore.toISOString()}`,
      )),
    Match.tag('CertificateExpiredError', (c) =>
      buildProblemBody(
        'Certificate Expired',
        `Certificate at position ${c.position} expired on ${c.notAfter.toISOString()}`,
      )),
    Match.exhaustive,
  )

const statementProblem = (cause: AttestationStatementFailure): ProblemDetail =>
  Match.value(cause).pipe(
    Match.tag('NoAttestationExtensionError', () =>
      buildProblemBody(
        'Android Attestation Extension Missing',
        'Leaf certificate is missing the Android Keystore attestation extension',
      )),
    Match.tag('ExtensionOnNonLeafError', (c) =>
      buildProblemBody(
        'Attestation Extension on Non-Leaf Certificate',
        `Attestation extension found on non-leaf certificate at index ${c.certIndex}`,
      )),
    Match.tag('AttestationExtensionParseError', (c) =>
      buildProblemBody('Attestation Extension Parse Failed', `Failed to parse attestation extension: ${c.reason}`)),
    Match.tag('SecurityLevelTooLowError', (c) =>
      buildProblemBody(
        'Attestation Security Level Too Low',
        `Attestation security level ${c.securityLevel} is too low (requires TEE/StrongBox)`,
      )),
    Match.tag('KeymasterSecurityLevelTooLowError', (c) =>
      buildProblemBody(
        'Keymaster Security Level Too Low',
        `Keymaster security level ${c.securityLevel} is too low (requires TEE/StrongBox)`,
      )),
    Match.tag('MissingRootOfTrustError', () =>
      buildProblemBody(
        'Hardware Root of Trust Missing',
        'Hardware-enforced root of trust is missing from attestation',
      )),
    Match.tag('VerifiedBootStateNotVerifiedError', (c) =>
      buildProblemBody(
        'Verified Boot State Not Verified',
        `Verified boot state ${c.state} indicates device boot integrity check failed`,
      )),
    Match.tag('DeviceNotLockedError', () =>
      buildProblemBody('Device Not Locked', 'Device bootloader is not locked')),
    Match.tag('UntrustedVerifiedBootKeyError', (c) =>
      buildProblemBody('Untrusted Verified Boot Key', `Verified boot key ${c.keyHex} is not in the trusted set`)),
    Match.tag('ChallengeMismatchError', (c) =>
      buildProblemBody(
        'Challenge Mismatch',
        `Challenge mismatch — server expected ${c.expected}, client provided ${c.actual}`,
      )),
    Match.tag('PackageNameMismatchError', (c) =>
      buildProblemBody(
        'Package Name Mismatch',
        `App package name "${c.actual}" is not in the server's whitelist (expected one of: ${c.expected})`,
      )),
    Match.exhaustive,
  )

const distributionProblem = (cause: AppDistributionFailure): ProblemDetail =>
  Match.value(cause).pipe(
    Match.tag('UnknownSigningDigestError', (c) =>
      buildProblemBody(
        'Unknown App Signing Digest',
        `App signing digest ${c.digestHex} does not match the play-store or website digest configured for this environment`,
      )),
    Match.tag('NoSigningDigestsError', () =>
      buildProblemBody(
        'No App Signing Digests',
        'Attestation extension contains no signing digests — the app signing identity is missing',
      )),
    Match.tag('MixedSigningChannelsError', () =>
      buildProblemBody(
        'Mixed Signing Channels',
        'Attestation contains signing digests from both the Play Store and the website — only one distribution channel is allowed per app',
      )),
    Match.exhaustive,
  )

const toAndroidAttestationProblemBody = (error: AttestationError): ProblemDetail =>
  Match.value(error).pipe(
    Match.tag('CertificateChainError', (e) => chainProblem(e.cause)),
    Match.tag('CertificateRevokedError', (e) =>
      buildProblemBody(
        'Certificate Revoked',
        `Certificate at position ${e.position} (serial ${e.serialHex}) is revoked`,
      )),
    Match.tag('AttestationStatementError', (e) => statementProblem(e.cause)),
    Match.tag('AppDistributionError', (e) => distributionProblem(e.cause)),
    Match.exhaustive,
  )

export const makeTokenRouteWithoutDependencies = Effect.gen(function*() {
  const issueTokenUseCase = yield* IssueTokenUseCase
  const challengeService = yield* ChallengeService
  const crlService = yield* AndroidAttestationCrlService
  const rateLimiter = yield* TokenBucketRateLimiter
  const runtime = yield* Effect.runtime()

  const [packageNames, playStoreDigest, websiteDigest] = yield* Config.all([
    ANDROID_PACKAGE_NAMES,
    ANDROID_SIGNING_DIGEST_PLAYSTORE,
    ANDROID_SIGNING_DIGEST_WEBSITE,
  ])

  const knownDigests = {
    playStore: yield* S.decode(SigningDigestHex)(playStoreDigest),
    website: yield* S.decode(SigningDigestHex)(websiteDigest),
  }

  const packageNamesArray: ReadonlyArray<PackageName> = yield* Effect.forEach(
    Array.from(packageNames),
    (n) => S.decode(PackageName)(n),
  )

  const decodeChallenge = S.decodeSync(AttestationChallenge)

  const verifyAndroidAttestation = (params: {
    readonly challenge: Uint8Array
    readonly leafCertDer: ArrayBuffer
    readonly intermediateCertDers: ReadonlyArray<ArrayBuffer>
  }) =>
    Effect.gen(function*() {
      const crlEntries = yield* crlService.getEntries
      return yield* verifyAndroidAttestationLib({
        expectedPackageNames: packageNamesArray,
        expectedChallenge: decodeChallenge(params.challenge),
        crlEntries,
        knownDigests,
        trustedVerifiedBootKeys: GRAPHENEOS_VERIFIED_BOOT_KEYS,
      })({
        leafCertDer: params.leafCertDer,
        intermediateCertDers: params.intermediateCertDers,
      })
    })

  return createOpenAPIHono<{
    Bindings: HttpBindings
    Variables: {
      spanContext?: SpanContext
    }
  }>()
    .openapi(
      createRoute({
        summary: 'Generate JWT Token',
        description:
          'Exchange client proof for a JWT access token and opaque refresh token. The client signs a proof payload derived from the server challenge and their public key.',
        method: 'post',
        path: '/',
        tags: ['v1'],
        request: {
          headers: TokenRequestHeaders,
          body: {
            required: true,
            content: {
              'application/json': {
                schema: TokenRequest,
              },
            },
          },
        },
        responses: {
          200: {
            content: {
              'application/json': {
                schema: TokenResponse,
              },
            },
            description:
              'Token pair issued. Use `token` for API authorization and `refreshToken` for silent renewal via `POST /v1/token/refresh`.',
          },
          400: {
            content: {
              'application/problem+json': {
                schema: ProblemDetailZod,
              },
            },
            description:
              'Bad Request. Either the Android attestation chain is malformed, or the request violated the header/body contract (e.g. `Auth-Attestation-Type: key-attestation` with no `attestationChain` in the body, or a body chain without the `key-attestation` header). iOS requests never receive this response.',
          },
          401: {
            content: {
              'application/problem+json': {
                schema: ProblemDetailZod,
                examples: {
                  proofFailed: {
                    summary: 'Client proof signature verification failed',
                    value: {
                      type: `${SMARTBEAR}/unauthorized`,
                      title: 'Client Proof Verification Failed',
                      detail:
                        'The provided SR25519 signature does not match the expected proof payload for the given client public key.',
                      status: 401,
                    },
                  },
                },
              },
            },
            description:
              'The SR25519 client proof could not be verified. Either the signature is invalid, the proof payload was computed incorrectly, or the public key does not match the signing key.',
          },
          403: {
            content: { 'application/json': { schema: ProblemDetailZod } },
            description:
              'Android attestation verification failed (chain invalid, revoked cert, boot integrity, etc.) or rate limit exceeded.',
          },
          429: {
            content: {
              'text/plain': {
                schema: z.string(),
              },
            },
            description: 'Rate Limit Exceeded',
          },
          500: {
            content: {
              'application/problem+json': {
                schema: ProblemDetailZod,
              },
            },
            description: 'Unexpected server error. Check server logs for details.',
          },
          503: {
            content: {
              'application/problem+json': {
                schema: ProblemDetailZod,
              },
            },
            description:
              'Android attestation revocation list (CRL) is currently unavailable. Retry with a fresh challenge.',
          },
        },
      }),
      async (c) => {
        const bodyText = await c.req.text()
        const headers = c.req.valid('header')
        const body = c.req.valid('json')
        const bodyBytes = new TextEncoder().encode(bodyText)

        const handler = Effect.gen(function*() {
          const dispatch = yield* decideKeyAttestationDispatch({
            attestationType: headers.authAttestationType,
            attestationChain: body.attestationChain,
          })

          const attestationResult = yield* Match.value(dispatch).pipe(
            Match.tag(
              'SkipKeyAttestationChain',
              () => Effect.succeed<{ readonly appFromOfficialStore: boolean } | undefined>(undefined),
            ),
            Match.tag('VerifyKeyAttestationChain', (verify) =>
              Effect.gen(function*() {
                const allowed = yield* rateLimiter.tryConsume(['android-attestation', encodeBase64(headers.clientId)])
                if (!allowed) {
                  return yield* Effect.fail(new AndroidAttestationRateLimitExceededError())
                }

                yield* challengeService.consumeChallenge(headers.challenge)

                const decodedChain = verify.chain.map(decodeBase64)
                const leafBytes = decodedChain[0]!
                const intermediateBytes = decodedChain.slice(1)

                const toArrayBuffer = (u: Uint8Array): ArrayBuffer => {
                  const copy = new Uint8Array(u.byteLength)
                  copy.set(u)
                  return copy.buffer
                }

                const verifyResult = yield* verifyAndroidAttestation({
                  challenge: headers.challenge,
                  leafCertDer: toArrayBuffer(leafBytes),
                  intermediateCertDers: intermediateBytes.map(toArrayBuffer),
                })

                return { appFromOfficialStore: verifyResult.appFromOfficialStore }
              })),
            Match.exhaustive,
          )

          const cmd = yield* S.decode(IssueTokenCommand)({
            clientId: headers.clientId,
            clientProof: headers.clientProof,
            challenge: headers.challenge,
            body: bodyBytes,
            attestationResult,
            iosPackage: headers.iosPackage,
          }).pipe(Effect.orDie)

          const tokenResult = yield* issueTokenUseCase.issueToken(cmd)
          return c.json(tokenResult, 200)
        }).pipe(
          Effect.catchTag('ClientProofVerificationFailedError', () =>
            Effect.succeed(
              c.json(
                {
                  type: `${SMARTBEAR}/unauthorized`,
                  title: 'Client Proof Verification Failed',
                  detail:
                    'The provided SR25519 signature does not match the expected proof payload for the given client public key.',
                  status: 401,
                } satisfies ProblemDetail,
                401,
                { 'Content-Type': 'application/problem+json' },
              ),
            )),
          Effect.catchTags({
            AndroidAttestationRateLimitExceededError: () => Effect.succeed(c.text('Rate Limit Exceeded', 429)),
            AttestationChainRequired: () =>
              Effect.succeed(c.json(
                buildProblemBody(
                  'Android Attestation Contract Violation',
                  'Auth-Attestation-Type: key-attestation requires attestationChain in the request body.',
                  400,
                ),
                400,
                { 'Content-Type': 'application/problem+json' },
              )),
            AttestationChainUnexpected: () =>
              Effect.succeed(c.json(
                buildProblemBody(
                  'Android Attestation Contract Violation',
                  'attestationChain in the request body requires Auth-Attestation-Type: key-attestation.',
                  400,
                ),
                400,
                { 'Content-Type': 'application/problem+json' },
              )),
            CertificateChainError: (e) => Effect.succeed(c.json(toAndroidAttestationProblemBody(e), 403)),
            CertificateRevokedError: (e) => Effect.succeed(c.json(toAndroidAttestationProblemBody(e), 403)),
            AttestationStatementError: (e) => Effect.succeed(c.json(toAndroidAttestationProblemBody(e), 403)),
            AppDistributionError: (e) => Effect.succeed(c.json(toAndroidAttestationProblemBody(e), 403)),
            ChallengeNotFoundError: () =>
              Effect.succeed(c.json(
                buildProblemBody('Challenge Not Found', 'Challenge not found, expired, or already consumed'),
                403,
                { 'Content-Type': 'application/problem+json' },
              )),
            FetchCrlError: () =>
              Effect.succeed(c.json(
                buildProblemBody(
                  'Android Attestation CRL Unavailable',
                  'Android revocation list is currently unavailable. Retry with a fresh challenge.',
                  503,
                ),
                503,
                { 'Content-Type': 'application/problem+json' },
              )),
            ParseCrlError: () =>
              Effect.succeed(c.json(
                buildProblemBody(
                  'Android Attestation CRL Unparseable',
                  'Android revocation list is currently unavailable. Retry with a fresh challenge.',
                  503,
                ),
                503,
                { 'Content-Type': 'application/problem+json' },
              )),
          }),
          Effect.withSpan('v1.generate_token'),
        )

        const result = await bridgeSpanContext(handler, c).pipe(
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

export const makeRefreshRouteWithoutDependencies = Effect.gen(function*() {
  const rotateTokenUseCase = yield* RotateTokenUseCase
  const runtime = yield* Effect.runtime()

  return createOpenAPIHono<{
    Bindings: HttpBindings
    Variables: {
      spanContext?: SpanContext
    }
  }>()
    .openapi(
      createRoute({
        summary: 'Rotate refresh token',
        description:
          'Exchange a valid refresh token for a new JWT access token and refresh token pair. The submitted token is permanently revoked — this operation is not idempotent. On failure, returns 401 with a generic error (the response body does not indicate whether the token expired, was not found, or was already used).',
        method: 'post',
        path: '/token/refresh',
        tags: ['v1'],
        request: {
          body: {
            required: true,
            content: {
              'application/json': {
                schema: RefreshTokenRequest,
              },
            },
          },
        },
        responses: {
          200: {
            content: {
              'application/json': {
                schema: RefreshTokenResponse,
              },
            },
            description:
              'Token pair rotated. The submitted refresh token is now revoked — persist the new `refreshToken` immediately.',
          },
          401: {
            content: {
              'application/problem+json': {
                schema: ProblemDetailZod,
                examples: {
                  expired: {
                    summary: 'Token has exceeded its 30-day sliding TTL',
                    value: {
                      type: `${SMARTBEAR}/unauthorized`,
                      title: 'Invalid or Expired Refresh Token',
                      detail: 'The provided refresh token is invalid, expired, or has been revoked.',
                      status: 401,
                    },
                  },
                  revoked: {
                    summary: 'Token was already used in a prior rotation (reuse detected)',
                    value: {
                      type: `${SMARTBEAR}/unauthorized`,
                      title: 'Invalid or Expired Refresh Token',
                      detail: 'The provided refresh token is invalid, expired, or has been revoked.',
                      status: 401,
                    },
                  },
                  notFound: {
                    summary: 'Token does not exist in the database',
                    value: {
                      type: `${SMARTBEAR}/unauthorized`,
                      title: 'Invalid or Expired Refresh Token',
                      detail: 'The provided refresh token is invalid, expired, or has been revoked.',
                      status: 401,
                    },
                  },
                },
              },
            },
            description:
              'Refresh token is invalid, expired, or has been revoked. The response body is identical for all failure reasons to prevent token enumeration.',
          },
          500: {
            content: {
              'application/problem+json': {
                schema: ProblemDetailZod,
              },
            },
            description: 'Unexpected server error. Check server logs for details.',
          },
        },
      }),
      async (c) => {
        const { refreshToken: refreshTokenBase64 } = c.req.valid('json')

        const handler = Effect.gen(function*() {
          const result = yield* rotateTokenUseCase.rotateToken(decodeBase64(refreshTokenBase64))
          return c.json(
            { token: result.accessToken, refreshToken: encodeBase64(Redacted.value(result.refreshToken)) },
            200,
          )
        }).pipe(
          Effect.catchAll((e) =>
            Match.value(e).pipe(
              Match.tag('RefreshTokenNotFound', 'RefreshTokenExpired', 'RefreshTokenReuseDetected', () =>
                Effect.succeed(
                  c.json(
                    {
                      type: `${SMARTBEAR}/unauthorized`,
                      title: 'Invalid or Expired Refresh Token',
                      detail: 'The provided refresh token is invalid, expired, or has been revoked.',
                      status: 401,
                    } satisfies ProblemDetail,
                    401,
                    { 'Content-Type': 'application/problem+json' },
                  ),
                )),
              Match.exhaustive,
            )
          ),
          Effect.withSpan('v1.refresh_token'),
        )

        const result = await bridgeSpanContext(handler, c).pipe(
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

export const makeTokenRoute = Effect.fn('v1.make_token_route')(() => makeTokenRouteWithoutDependencies)
export const makeRefreshRoute = Effect.fn('v1.make_refresh_route')(() => makeRefreshRouteWithoutDependencies)
