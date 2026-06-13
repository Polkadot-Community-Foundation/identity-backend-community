import { Either, Match, Schema as S } from 'effect'

export class ClaimWon extends S.TaggedClass<ClaimWon>()('ClaimWon', {}) {}
export class ClaimRepeated extends S.TaggedClass<ClaimRepeated>()('ClaimRepeated', {}) {}
export class ClaimUnregistered extends S.TaggedClass<ClaimUnregistered>()('ClaimUnregistered', {}) {}

export type VoucherClaimProbe = ClaimWon | ClaimRepeated | ClaimUnregistered

export class VoucherClaimed extends S.TaggedClass<VoucherClaimed>()('VoucherClaimed', {}) {}

export class InvalidVoucherError extends S.TaggedError<InvalidVoucherError>()(
  'InvalidVoucherError',
  {},
) {}

export class VoucherAlreadyRedeemedError extends S.TaggedError<VoucherAlreadyRedeemedError>()(
  'VoucherAlreadyRedeemedError',
  {},
) {}

export type VoucherRedemptionRejection = InvalidVoucherError | VoucherAlreadyRedeemedError

export const decideVoucherRedemption = (
  probe: VoucherClaimProbe,
): Either.Either<VoucherClaimed, VoucherRedemptionRejection> =>
  Match.value(probe).pipe(
    Match.tag('ClaimWon', () => Either.right(new VoucherClaimed())),
    Match.tag('ClaimRepeated', () => Either.left(new VoucherAlreadyRedeemedError())),
    Match.tag('ClaimUnregistered', () => Either.left(new InvalidVoucherError())),
    Match.exhaustive,
  )
