import { Either, Match, Schema as S } from 'effect'

import { PlanckBalance } from '#root/schema/balance.js'
import {
  AndroidDeviceIdentifiers,
  type ClaimDecision,
  ClaimInstant,
  ClaimPaymentRequired,
  ClaimQueued,
  PaymentAddress,
  VoucherAlreadyUsedError,
  VoucherKey,
  VoucherNotFoundError,
  WrongClaimDataError,
} from '#root/username-registration/registration-queue/claim.schema.js'

const VoucherStateTypeId: unique symbol = Symbol.for(
  '@identity-backend/registration-queue/VoucherState',
)
type VoucherStateTypeId = typeof VoucherStateTypeId

export class VoucherAbsent extends S.TaggedClass<VoucherAbsent>()('VoucherAbsent', {}) {
  readonly [VoucherStateTypeId] = VoucherStateTypeId
}

export class VoucherSpent extends S.TaggedClass<VoucherSpent>()('VoucherSpent', {
  voucherKey: VoucherKey,
}) {
  readonly [VoucherStateTypeId] = VoucherStateTypeId
}

export class VoucherRedeemable extends S.TaggedClass<VoucherRedeemable>()('VoucherRedeemable', {
  voucherKey: VoucherKey,
}) {
  readonly [VoucherStateTypeId] = VoucherStateTypeId
}

export class VoucherMissing extends S.TaggedClass<VoucherMissing>()('VoucherMissing', {
  voucherKey: VoucherKey,
}) {
  readonly [VoucherStateTypeId] = VoucherStateTypeId
}

export const VoucherState = S.Union(VoucherAbsent, VoucherSpent, VoucherRedeemable, VoucherMissing)
export type VoucherState = typeof VoucherState.Type

const DeviceEvidenceTypeId: unique symbol = Symbol.for(
  '@identity-backend/registration-queue/DeviceEvidence',
)
type DeviceEvidenceTypeId = typeof DeviceEvidenceTypeId

export class DeviceAbsent extends S.TaggedClass<DeviceAbsent>()('DeviceAbsent', {}) {
  readonly [DeviceEvidenceTypeId] = DeviceEvidenceTypeId
}

export class DeviceMatched extends S.TaggedClass<DeviceMatched>()('DeviceMatched', {
  identifiers: AndroidDeviceIdentifiers,
}) {
  readonly [DeviceEvidenceTypeId] = DeviceEvidenceTypeId
}

export class DeviceUnmatched extends S.TaggedClass<DeviceUnmatched>()('DeviceUnmatched', {
  identifiers: AndroidDeviceIdentifiers,
}) {
  readonly [DeviceEvidenceTypeId] = DeviceEvidenceTypeId
}

export const DeviceEvidence = S.Union(DeviceAbsent, DeviceMatched, DeviceUnmatched)
export type DeviceEvidence = typeof DeviceEvidence.Type

const DecideClaimCommandTypeId: unique symbol = Symbol.for(
  '@identity-backend/registration-queue/DecideClaimCommand',
)
type DecideClaimCommandTypeId = typeof DecideClaimCommandTypeId

export class DecideClaimCommand extends S.TaggedClass<DecideClaimCommand>()('DecideClaimCommand', {
  voucher: VoucherState,
  appFromOfficialStore: S.Boolean,
  device: DeviceEvidence,
  paymentAddress: PaymentAddress,
  amountRequired: PlanckBalance,
}) {
  readonly [DecideClaimCommandTypeId] = DecideClaimCommandTypeId
}

export const DecideClaimError = S.Union(VoucherAlreadyUsedError, VoucherNotFoundError, WrongClaimDataError)
export type DecideClaimError = typeof DecideClaimError.Type

const rejectSpentVoucher = (
  voucher: VoucherState,
): Either.Either<VoucherAbsent | VoucherRedeemable, VoucherAlreadyUsedError | VoucherNotFoundError> =>
  Match.value(voucher).pipe(
    Match.tag('VoucherSpent', (v) => Either.left(new VoucherAlreadyUsedError({ voucherKey: v.voucherKey }))),
    Match.tag('VoucherMissing', (v) => Either.left(new VoucherNotFoundError({ voucherKey: v.voucherKey }))),
    Match.tag('VoucherAbsent', (v) => Either.right(v)),
    Match.tag('VoucherRedeemable', (v) => Either.right(v)),
    Match.exhaustive,
  )

const decidePoudOutcome = (
  appFromOfficialStore: boolean,
  device: DeviceEvidence,
  paymentAddress: PaymentAddress,
  amountRequired: PlanckBalance,
): Either.Either<ClaimQueued | ClaimPaymentRequired, WrongClaimDataError> => {
  const paymentRequired = new ClaimPaymentRequired({ paymentAddress, amountRequired })
  return Match.value(appFromOfficialStore).pipe(
    Match.when(false, () => Either.right(paymentRequired)),
    Match.orElse(() =>
      Match.value(device).pipe(
        Match.tag('DeviceAbsent', () => Either.left(new WrongClaimDataError())),
        Match.tag('DeviceMatched', () => Either.right(paymentRequired)),
        Match.tag('DeviceUnmatched', (matched) =>
          Either.right(new ClaimQueued({ deviceIdentifiers: matched.identifiers }))),
        Match.exhaustive,
      )
    ),
  )
}

export const decideClaim = (
  cmd: DecideClaimCommand,
): Either.Either<ClaimDecision, DecideClaimError> =>
  Either.gen(function*() {
    const voucher = yield* rejectSpentVoucher(cmd.voucher)
    const decision: ClaimDecision = yield* Match.value(voucher).pipe(
      Match.tag('VoucherRedeemable', (v) => Either.right(new ClaimInstant({ voucherKey: v.voucherKey }))),
      Match.tag('VoucherAbsent', () =>
        decidePoudOutcome(
          cmd.appFromOfficialStore,
          cmd.device,
          cmd.paymentAddress,
          cmd.amountRequired,
        )),
      Match.exhaustive,
    )
    return decision
  })
