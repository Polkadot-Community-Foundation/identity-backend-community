import { describe, it } from '@effect/vitest'
import { FastCheck as fc } from 'effect'
import { decideAndroidAttestationRequirement } from '../attestation-requirement.workflow.js'

describe('decideAndroidAttestationRequirement', () => {
  it.prop(
    '∀EnforceAuth_ChainPresent_=VerifyChain',
    [fc.boolean()],
    ([enforceAuth]) => decideAndroidAttestationRequirement({ enforceAuth, chainPresent: true })._tag === 'VerifyChain',
  )

  it.prop(
    '∀EnforceAuth_ChainAbsent_→FlagDecidesRejectVsSkip',
    [fc.boolean()],
    ([enforceAuth]) =>
      decideAndroidAttestationRequirement({ enforceAuth, chainPresent: false })._tag ===
        (enforceAuth ? 'MissingChain' : 'SkipVerification'),
  )

  it.prop(
    '∀EnforceAuthChain_FullMatrix_=SpecOutcome',
    [fc.boolean(), fc.boolean()],
    ([enforceAuth, chainPresent]) => {
      const expected = chainPresent
        ? 'VerifyChain'
        : enforceAuth
        ? 'MissingChain'
        : 'SkipVerification'
      return decideAndroidAttestationRequirement({ enforceAuth, chainPresent })._tag === expected
    },
  )
})
