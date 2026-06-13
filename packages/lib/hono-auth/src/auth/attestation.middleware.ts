import { Context, Effect, Either, Match, Runtime, Schema as S } from 'effect'
import { createMiddleware } from 'hono/factory'

export interface AndroidAttestationVerifyParams {
  readonly challenge: Uint8Array
  readonly leafCertDer: ArrayBuffer
  readonly intermediateCertDers: ReadonlyArray<ArrayBuffer>
}

export type AndroidAttestationOutcome =
  | { readonly _tag: 'Verified' }
  | { readonly _tag: 'Rejected' }
  | { readonly _tag: 'Unavailable' }

export const AndroidAttestationOutcome = {
  Verified: { _tag: 'Verified' } as const satisfies AndroidAttestationOutcome,
  Rejected: { _tag: 'Rejected' } as const satisfies AndroidAttestationOutcome,
  Unavailable: { _tag: 'Unavailable' } as const satisfies AndroidAttestationOutcome,
}

export class AndroidAttestationMiddlewareConfig
  extends Context.Tag('AndroidAttestationMiddlewareConfig')<AndroidAttestationMiddlewareConfig, {
    readonly verifyChain: (
      _: AndroidAttestationVerifyParams,
    ) => Effect.Effect<AndroidAttestationOutcome>
  }>()
{}

const FAILED_TAG = 'AndroidAttestationFailed' as const
const FAILED_ERROR = 'Android attestation verification failed' as const

const UNAVAILABLE_TAG = 'AndroidAttestationCrlUnavailable' as const
const UNAVAILABLE_ERROR = 'Android revocation list is currently unavailable. Retry with a fresh challenge.' as const

const failedResponse = <C extends { json: (body: unknown, status: 401) => Response }>(c: C): Response =>
  c.json({ _tag: FAILED_TAG, error: FAILED_ERROR }, 401)

const unavailableResponse = <C extends { json: (body: unknown, status: 503) => Response }>(c: C): Response =>
  c.json({ _tag: UNAVAILABLE_TAG, error: UNAVAILABLE_ERROR }, 503)

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

export const readAttestationChain = (
  c: { req: { json: () => Promise<unknown> } },
): Promise<ReadonlyArray<string> | undefined> =>
  c.req
    .json()
    .then((body) => {
      if (typeof body !== 'object' || body === null) return undefined
      const chain = (body as { attestationChain?: unknown }).attestationChain
      if (!Array.isArray(chain)) return undefined
      return chain.every((entry): entry is string => typeof entry === 'string') ? chain : undefined
    })
    .catch(() => undefined)

export const readAttestationChainPresence = (
  c: { req: { json: () => Promise<unknown> } },
): Promise<boolean> => readAttestationChain(c).then((chain) => chain !== undefined && chain.length > 0)

const decodeBase64Array = (
  chain: ReadonlyArray<string>,
): Either.Either<ReadonlyArray<Uint8Array>, unknown> =>
  Either.all(chain.map((entry) => S.decodeEither(S.Uint8ArrayFromBase64)(entry)))

export const makeAndroidAttestationMiddleware = Effect.gen(function*() {
  const { verifyChain } = yield* AndroidAttestationMiddlewareConfig
  const runtime = yield* Effect.runtime()

  return createMiddleware(async (c, next) => {
    const chain = await readAttestationChain(c)
    if (chain === undefined || chain.length === 0) {
      return failedResponse(c)
    }

    const challengeHeader = c.req.header('Auth-Challenge')
    if (challengeHeader === undefined) {
      return failedResponse(c)
    }

    const decodedChallenge = S.decodeEither(S.Uint8ArrayFromBase64)(challengeHeader)
    if (Either.isLeft(decodedChallenge)) {
      return failedResponse(c)
    }

    const decodedChain = decodeBase64Array(chain)
    if (Either.isLeft(decodedChain)) {
      return failedResponse(c)
    }

    const leafBytes = decodedChain.right[0]
    if (leafBytes === undefined) {
      return failedResponse(c)
    }
    const intermediateBytes = decodedChain.right.slice(1)

    const outcome = await verifyChain({
      challenge: decodedChallenge.right,
      leafCertDer: toArrayBuffer(leafBytes),
      intermediateCertDers: intermediateBytes.map(toArrayBuffer),
    }).pipe(
      Runtime.runPromise(runtime),
    )

    return Match.value(outcome).pipe(
      Match.tag('Verified', () => next()),
      Match.tag('Rejected', () => failedResponse(c)),
      Match.tag('Unavailable', () => unavailableResponse(c)),
      Match.exhaustive,
    )
  })
})
