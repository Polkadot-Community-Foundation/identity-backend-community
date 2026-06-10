import { Either, Schema as S } from 'effect'

const KeyAttestationDispatchTypeId: unique symbol = Symbol.for(
  '@identity-backend/token/KeyAttestationDispatch',
)
type KeyAttestationDispatchTypeId = typeof KeyAttestationDispatchTypeId

export class VerifyKeyAttestationChain extends S.TaggedClass<VerifyKeyAttestationChain>()(
  'VerifyKeyAttestationChain',
  {
    chain: S.Array(S.String),
  },
) {
  readonly [KeyAttestationDispatchTypeId] = KeyAttestationDispatchTypeId
}

export class SkipKeyAttestationChain extends S.TaggedClass<SkipKeyAttestationChain>()(
  'SkipKeyAttestationChain',
  {},
) {
  readonly [KeyAttestationDispatchTypeId] = KeyAttestationDispatchTypeId
}

export type KeyAttestationDispatch = VerifyKeyAttestationChain | SkipKeyAttestationChain

export class AttestationChainRequiredError extends S.TaggedError<AttestationChainRequiredError>()(
  'AttestationChainRequired',
  {},
) {}

export class AttestationChainUnexpectedError extends S.TaggedError<AttestationChainUnexpectedError>()(
  'AttestationChainUnexpected',
  {},
) {}

export type AttestationChainContractViolation =
  | AttestationChainRequiredError
  | AttestationChainUnexpectedError

export interface KeyAttestationDispatchInput {
  readonly attestationType: 'play-integrity' | 'key-attestation' | undefined
  readonly attestationChain: ReadonlyArray<string> | undefined
}

export const decideKeyAttestationDispatch = (
  input: KeyAttestationDispatchInput,
): Either.Either<KeyAttestationDispatch, AttestationChainContractViolation> => {
  if (input.attestationType === 'key-attestation') {
    return input.attestationChain === undefined
      ? Either.left(new AttestationChainRequiredError())
      : Either.right(new VerifyKeyAttestationChain({ chain: input.attestationChain }))
  }

  return input.attestationChain === undefined
    ? Either.right(new SkipKeyAttestationChain())
    : Either.left(new AttestationChainUnexpectedError())
}
