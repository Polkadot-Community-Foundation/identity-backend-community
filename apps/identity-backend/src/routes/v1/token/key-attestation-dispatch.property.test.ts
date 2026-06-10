import { describe, expect, it } from '@effect/vitest'
import { Either, FastCheck as fc } from 'effect'
import {
  AttestationChainRequiredError,
  AttestationChainUnexpectedError,
  decideKeyAttestationDispatch,
  SkipKeyAttestationChain,
  VerifyKeyAttestationChain,
} from './key-attestation-dispatch.workflow.js'

const chain = fc.array(fc.string(), { minLength: 1, maxLength: 10 })
const nonKeyAttestationType = fc.constantFrom<'play-integrity' | undefined>('play-integrity', undefined)

describe('decideKeyAttestationDispatch', () => {
  it.prop(
    '∀Chain_KeyAttestationType_=VerifyCarryingChain',
    [chain],
    ([attestationChain]) => {
      const result = decideKeyAttestationDispatch({ attestationType: 'key-attestation', attestationChain })
      expect(result).toEqual(Either.right(new VerifyKeyAttestationChain({ chain: attestationChain })))
    },
  )

  it.prop(
    '∀NonKeyType_NoChain_=Skip',
    [nonKeyAttestationType],
    ([attestationType]) => {
      const result = decideKeyAttestationDispatch({ attestationType, attestationChain: undefined })
      expect(result).toEqual(Either.right(new SkipKeyAttestationChain()))
    },
  )

  it.prop(
    '∀NonKeyType_WithChain_=Unexpected',
    [nonKeyAttestationType, chain],
    ([attestationType, attestationChain]) => {
      const result = decideKeyAttestationDispatch({ attestationType, attestationChain })
      expect(result).toEqual(Either.left(new AttestationChainUnexpectedError()))
    },
  )

  it('Should_FailWithAttestationChainRequired_When_KeyAttestationTypeHasNoChain', () => {
    const result = decideKeyAttestationDispatch({ attestationType: 'key-attestation', attestationChain: undefined })
    expect(result).toEqual(Either.left(new AttestationChainRequiredError()))
  })
})
