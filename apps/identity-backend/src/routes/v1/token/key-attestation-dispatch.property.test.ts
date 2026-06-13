import { describe, expect, it } from '@effect/vitest'
import { Either, FastCheck as fc } from 'effect'
import {
  AttestationChainRequiredError,
  AttestationChainUnexpectedError,
  decideKeyAttestationDispatch,
  RedeemVoucher,
  SkipKeyAttestationChain,
  VerifyKeyAttestationChain,
  VoucherSecretRequiredError,
} from './key-attestation-dispatch.workflow.js'

const chain = fc.array(fc.string(), { minLength: 1, maxLength: 10 })
const nonKeyAttestationType = fc.constantFrom<'play-integrity' | undefined>('play-integrity', undefined)
const secret = fc.string({ minLength: 1 })
const anySecret = fc.option(fc.string(), { nil: undefined })

describe('decideKeyAttestationDispatch', () => {
  it.prop(
    '∀Chain_KeyAttestationType_=VerifyCarryingChain',
    [chain, anySecret],
    ([attestationChain, voucherSecret]) => {
      const result = decideKeyAttestationDispatch({
        attestationType: 'key-attestation',
        attestationChain,
        voucherSecret,
      })
      expect(result).toEqual(Either.right(new VerifyKeyAttestationChain({ chain: attestationChain })))
    },
  )

  it.prop(
    '∀NonKeyType_NoChain_=Skip',
    [nonKeyAttestationType, anySecret],
    ([attestationType, voucherSecret]) => {
      const result = decideKeyAttestationDispatch({ attestationType, attestationChain: undefined, voucherSecret })
      expect(result).toEqual(Either.right(new SkipKeyAttestationChain()))
    },
  )

  it.prop(
    '∀PlayIntegrityType_WithChain_=Skip',
    [chain, anySecret],
    ([attestationChain, voucherSecret]) => {
      const result = decideKeyAttestationDispatch({
        attestationType: 'play-integrity',
        attestationChain,
        voucherSecret,
      })
      expect(result).toEqual(Either.right(new SkipKeyAttestationChain()))
    },
  )

  it.prop(
    '∀UndefinedType_WithChain_=Unexpected',
    [chain, anySecret],
    ([attestationChain, voucherSecret]) => {
      const result = decideKeyAttestationDispatch({ attestationType: undefined, attestationChain, voucherSecret })
      expect(result).toEqual(Either.left(new AttestationChainUnexpectedError()))
    },
  )

  it.prop(
    '∀Secret_VoucherType_=RedeemCarryingSecret',
    [secret, fc.option(chain, { nil: undefined })],
    ([voucherSecret, attestationChain]) => {
      const result = decideKeyAttestationDispatch({ attestationType: 'voucher', attestationChain, voucherSecret })
      expect(result).toEqual(Either.right(new RedeemVoucher({ secret: voucherSecret })))
    },
  )

  it.prop(
    '∀VoucherType_NoSecret_=VoucherSecretRequired',
    [fc.option(chain, { nil: undefined })],
    ([attestationChain]) => {
      const result = decideKeyAttestationDispatch({
        attestationType: 'voucher',
        attestationChain,
        voucherSecret: undefined,
      })
      expect(result).toEqual(Either.left(new VoucherSecretRequiredError()))
    },
  )

  it('Should_FailWithAttestationChainRequired_When_KeyAttestationTypeHasNoChain', () => {
    const result = decideKeyAttestationDispatch({
      attestationType: 'key-attestation',
      attestationChain: undefined,
      voucherSecret: undefined,
    })
    expect(result).toEqual(Either.left(new AttestationChainRequiredError()))
  })
})
