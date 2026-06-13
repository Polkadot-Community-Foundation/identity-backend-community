import { Match } from 'effect'

export type AndroidAttestationRequirement =
  | { readonly _tag: 'VerifyChain' }
  | { readonly _tag: 'MissingChain' }
  | { readonly _tag: 'SkipVerification' }

export interface AndroidAttestationRequirementInput {
  readonly enforceAuth: boolean
  readonly chainPresent: boolean
}

const VerifyChain = { _tag: 'VerifyChain' } as const
const MissingChain = { _tag: 'MissingChain' } as const
const SkipVerification = { _tag: 'SkipVerification' } as const

export const decideAndroidAttestationRequirement = (
  input: AndroidAttestationRequirementInput,
): AndroidAttestationRequirement =>
  Match.value(input).pipe(
    Match.when({ chainPresent: true }, () => VerifyChain),
    Match.when({ enforceAuth: true }, () => MissingChain),
    Match.orElse(() => SkipVerification),
  )
