import {
  ClaimRepeated,
  ClaimUnregistered,
  ClaimWon,
  decideVoucherRedemption,
  InvalidVoucherError,
  VoucherAlreadyRedeemedError,
  VoucherClaimed,
  type VoucherClaimProbe,
} from '#root/routes/v1/token/voucher-redemption.workflow.js'
import { describe, expect, it } from '@effect/vitest'
import { Either, FastCheck as fc } from 'effect'

const probe = fc.constantFrom<VoucherClaimProbe>(
  new ClaimWon(),
  new ClaimRepeated(),
  new ClaimUnregistered(),
)

describe('decideVoucherRedemption', () => {
  it('Should_Claim_When_ClaimWon', () => {
    expect(decideVoucherRedemption(new ClaimWon())).toEqual(Either.right(new VoucherClaimed()))
  })

  it('Should_RejectAlreadyRedeemed_When_ClaimRepeated', () => {
    expect(decideVoucherRedemption(new ClaimRepeated())).toEqual(
      Either.left(new VoucherAlreadyRedeemedError()),
    )
  })

  it('Should_RejectInvalid_When_ClaimUnregistered', () => {
    expect(decideVoucherRedemption(new ClaimUnregistered())).toEqual(
      Either.left(new InvalidVoucherError()),
    )
  })

  it.prop(
    '∀Probe_Right_≡ClaimWon',
    [probe],
    ([p]) => Either.isRight(decideVoucherRedemption(p)) === (p._tag === 'ClaimWon'),
  )
})
