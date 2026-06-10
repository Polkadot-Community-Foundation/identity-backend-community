/// <reference types="vitest/importMeta" />
import { encodeHex } from '@std/encoding'
import { Either, Schema as S } from 'effect'
import type { SigningDigestHex } from './attestation.types.js'

export class UnknownSigningDigestError extends S.TaggedError<UnknownSigningDigestError>()(
  'UnknownSigningDigestError',
  {
    digestHex: S.String,
  },
) {
}

export class NoSigningDigestsError extends S.TaggedError<NoSigningDigestsError>()(
  'NoSigningDigestsError',
  {},
) {
}

export class MixedSigningChannelsError extends S.TaggedError<MixedSigningChannelsError>()(
  'MixedSigningChannelsError',
  {},
) {
}

export const AppDistributionFailure = S.Union(
  UnknownSigningDigestError,
  NoSigningDigestsError,
  MixedSigningChannelsError,
)
export type AppDistributionFailure = typeof AppDistributionFailure.Type

export interface DistributionResult {
  readonly appFromOfficialStore: boolean
}

export interface KnownDigests {
  readonly playStore: SigningDigestHex
  readonly website: SigningDigestHex
}

const classifyDigest = (
  signingDigest: Uint8Array,
  knownDigests: KnownDigests,
): Either.Either<boolean, UnknownSigningDigestError> => {
  const digestHex = encodeHex(signingDigest)
  if (digestHex === knownDigests.playStore) return Either.right(true)
  if (digestHex === knownDigests.website) return Either.right(false)
  return Either.left(new UnknownSigningDigestError({ digestHex }))
}

export const determineDistributionChannel = (
  signingDigests: ReadonlyArray<Uint8Array>,
  knownDigests: KnownDigests,
): Either.Either<DistributionResult, AppDistributionFailure> =>
  Either.gen(function*() {
    if (signingDigests.length === 0) {
      return yield* Either.left(new NoSigningDigestsError({}))
    }
    const channels: Array<boolean> = []
    for (const digest of signingDigests) {
      const classified = yield* classifyDigest(digest, knownDigests)
      channels.push(classified)
    }
    const first = channels[0]!
    for (const channel of channels) {
      if (channel !== first) {
        return yield* Either.left(new MixedSigningChannelsError({}))
      }
    }
    return { appFromOfficialStore: first }
  })

// Stryker disable all
if (import.meta.vitest) {
  const { describe } = await import('@effect/vitest')
  describe('Rule of Schemas', () => {})
}
