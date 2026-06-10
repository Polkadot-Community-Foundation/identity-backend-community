import { encodeHex } from '@std/encoding'
import { Either } from 'effect'
import { describe, expect, it } from 'vitest'
import { SigningDigestHex } from '../attestation.types.js'
import {
  determineDistributionChannel,
  MixedSigningChannelsError,
  NoSigningDigestsError,
  UnknownSigningDigestError,
} from '../distribution.js'

const PLAY_STORE_DIGEST = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'
const WEBSITE_DIGEST = 'f6e5d4c3b2a1f6e5d4c3b2a1f6e5d4c3b2a1f6e5d4c3b2a1f6e5d4c3b2a1f6e5'
const KNOWN = {
  playStore: SigningDigestHex.make(PLAY_STORE_DIGEST),
  website: SigningDigestHex.make(WEBSITE_DIGEST),
}

const hexToBytes = (hex: string): Uint8Array => new Uint8Array(hex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)))

describe('determineDistributionChannel', () => {
  it('Should_ReturnRight_When_SingleDigestMatchesPlayStore', () => {
    const result = determineDistributionChannel([hexToBytes(PLAY_STORE_DIGEST)], KNOWN)
    expect(result).toEqual(Either.right({ appFromOfficialStore: true }))
  })

  it('Should_ReturnRight_When_SingleDigestMatchesWebsite', () => {
    const result = determineDistributionChannel([hexToBytes(WEBSITE_DIGEST)], KNOWN)
    expect(result).toEqual(Either.right({ appFromOfficialStore: false }))
  })

  it('Should_ReturnRight_When_AllDigestsAgreeOnSameChannel', () => {
    const result = determineDistributionChannel(
      [hexToBytes(PLAY_STORE_DIGEST), hexToBytes(PLAY_STORE_DIGEST)],
      KNOWN,
    )
    expect(result).toEqual(Either.right({ appFromOfficialStore: true }))
  })

  it('Should_ReturnUnknownSigningDigest_When_DigestDoesNotMatchAnyKnownDigest', () => {
    const input = new Uint8Array([1, 2, 3, 4])
    const result = determineDistributionChannel([input], KNOWN)
    expect(result).toEqual(Either.left(new UnknownSigningDigestError({ digestHex: encodeHex(input) })))
  })

  it('Should_ReturnNoSigningDigests_When_ListIsEmpty', () => {
    const result = determineDistributionChannel([], KNOWN)
    expect(result).toEqual(Either.left(new NoSigningDigestsError({})))
  })

  it('Should_ReturnMixedSigningChannels_When_DigestsBelongToDifferentChannels', () => {
    const result = determineDistributionChannel(
      [hexToBytes(PLAY_STORE_DIGEST), hexToBytes(WEBSITE_DIGEST)],
      KNOWN,
    )
    expect(result).toEqual(Either.left(new MixedSigningChannelsError({})))
  })

  it('Should_ReturnUnknownSigningDigest_When_AnyDigestIsUnknown', () => {
    const unknown = new Uint8Array([9, 9, 9])
    const result = determineDistributionChannel([hexToBytes(PLAY_STORE_DIGEST), unknown], KNOWN)
    expect(result).toEqual(Either.left(new UnknownSigningDigestError({ digestHex: encodeHex(unknown) })))
  })
})
