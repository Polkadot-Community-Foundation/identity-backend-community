export type AndroidDispatchDecision =
  | { readonly _tag: 'Skip' }
  | { readonly _tag: 'PlayIntegrity' }
  | { readonly _tag: 'KeyAttestation' }
  | { readonly _tag: 'MissingAttestationType' }
  | { readonly _tag: 'UnknownAttestationType' }

export interface AndroidDispatchInput {
  readonly iosPackage: string | undefined
  readonly androidPackage: string | undefined
  readonly attestationToken: string | undefined
  readonly attestationType: string | undefined
}

export const decideAndroidDispatch = (input: AndroidDispatchInput): AndroidDispatchDecision => {
  if (input.iosPackage !== undefined) {
    return { _tag: 'Skip' }
  }

  if (input.attestationType === 'key-attestation') {
    return { _tag: 'KeyAttestation' }
  }

  if (
    input.androidPackage === undefined &&
    input.attestationToken === undefined
  ) {
    return { _tag: 'Skip' }
  }

  if (input.attestationType === undefined) {
    return { _tag: 'MissingAttestationType' }
  }

  switch (input.attestationType) {
    case 'play-integrity':
      return { _tag: 'PlayIntegrity' }
    default:
      return { _tag: 'UnknownAttestationType' }
  }
}
