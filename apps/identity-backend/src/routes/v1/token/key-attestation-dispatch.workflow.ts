import { Either, Match, Option, Schema as S } from 'effect'

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

export class RedeemVoucher extends S.TaggedClass<RedeemVoucher>()(
  'RedeemVoucher',
  {
    secret: S.String,
  },
) {
  readonly [KeyAttestationDispatchTypeId] = KeyAttestationDispatchTypeId
}

export type KeyAttestationDispatch = VerifyKeyAttestationChain | SkipKeyAttestationChain | RedeemVoucher

export class AttestationChainRequiredError extends S.TaggedError<AttestationChainRequiredError>()(
  'AttestationChainRequired',
  {},
) {}

export class AttestationChainUnexpectedError extends S.TaggedError<AttestationChainUnexpectedError>()(
  'AttestationChainUnexpected',
  {},
) {}

export class VoucherSecretRequiredError extends S.TaggedError<VoucherSecretRequiredError>()(
  'VoucherSecretRequired',
  {},
) {}

export type AttestationChainContractViolation =
  | AttestationChainRequiredError
  | AttestationChainUnexpectedError
  | VoucherSecretRequiredError

export interface KeyAttestationDispatchInput {
  readonly attestationType: 'play-integrity' | 'key-attestation' | 'voucher' | undefined
  readonly attestationChain: ReadonlyArray<string> | undefined
  readonly voucherSecret: string | undefined
}

type Decision = Either.Either<KeyAttestationDispatch, AttestationChainContractViolation>

const dispatchVoucher = (voucherSecret: string | undefined): Decision =>
  Option.match(Option.fromNullable(voucherSecret), {
    onNone: () => Either.left(new VoucherSecretRequiredError()),
    onSome: (secret) => Either.right(new RedeemVoucher({ secret })),
  })

const dispatchKeyAttestation = (attestationChain: ReadonlyArray<string> | undefined): Decision =>
  Option.match(Option.fromNullable(attestationChain), {
    onNone: () => Either.left(new AttestationChainRequiredError()),
    onSome: (chain) => Either.right(new VerifyKeyAttestationChain({ chain })),
  })

const dispatchUndeclared = (attestationChain: ReadonlyArray<string> | undefined): Decision =>
  Option.match(Option.fromNullable(attestationChain), {
    onNone: () => Either.right(new SkipKeyAttestationChain()),
    onSome: () => Either.left(new AttestationChainUnexpectedError()),
  })

export const decideKeyAttestationDispatch = (input: KeyAttestationDispatchInput): Decision =>
  Match.value(input.attestationType).pipe(
    Match.when('voucher', () => dispatchVoucher(input.voucherSecret)),
    Match.when('key-attestation', () => dispatchKeyAttestation(input.attestationChain)),
    Match.when('play-integrity', () => Either.right(new SkipKeyAttestationChain())),
    Match.orElse(() => dispatchUndeclared(input.attestationChain)),
  )
