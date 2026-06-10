import { PlanckBalance } from '#root/schema/balance.js'
import { Ss58String } from '@identity-backend/substrate-schema'
import { Schema as S } from 'effect'

export const VoucherKey = S.NonEmptyString.pipe(S.brand('VoucherKey'))
export type VoucherKey = typeof VoucherKey.Type

export const AndroidId = S.NonEmptyString.pipe(S.brand('AndroidId'))
export type AndroidId = typeof AndroidId.Type

export const WidevineId = S.NonEmptyString.pipe(S.brand('WidevineId'))
export type WidevineId = typeof WidevineId.Type

export const PaymentAddress = Ss58String.pipe(S.brand('PaymentAddress'))
export type PaymentAddress = typeof PaymentAddress.Type

export const AndroidDeviceIdentifiers = S.Struct({
  androidId: AndroidId,
  widevineId: WidevineId,
}).pipe(S.brand('AndroidDeviceIdentifiers'))
export type AndroidDeviceIdentifiers = typeof AndroidDeviceIdentifiers.Type

const ClaimDecisionTypeId: unique symbol = Symbol.for(
  '@identity-backend/registration-queue/ClaimDecision',
)
type ClaimDecisionTypeId = typeof ClaimDecisionTypeId

export class ClaimInstant extends S.TaggedClass<ClaimInstant>()('ClaimInstant', {
  voucherKey: VoucherKey,
}) {
  readonly [ClaimDecisionTypeId] = ClaimDecisionTypeId
}

export class ClaimQueued extends S.TaggedClass<ClaimQueued>()('ClaimQueued', {
  deviceIdentifiers: AndroidDeviceIdentifiers,
}) {
  readonly [ClaimDecisionTypeId] = ClaimDecisionTypeId
}

export class ClaimPaymentRequired extends S.TaggedClass<ClaimPaymentRequired>()('ClaimPaymentRequired', {
  paymentAddress: PaymentAddress,
  amountRequired: PlanckBalance,
}) {
  readonly [ClaimDecisionTypeId] = ClaimDecisionTypeId
}

export const ClaimDecision = S.Union(ClaimInstant, ClaimQueued, ClaimPaymentRequired)
export type ClaimDecision = typeof ClaimDecision.Type

export class VoucherAlreadyUsedError extends S.TaggedError<VoucherAlreadyUsedError>()(
  'VoucherAlreadyUsedError',
  {
    voucherKey: VoucherKey,
  },
) {}

export class VoucherNotFoundError extends S.TaggedError<VoucherNotFoundError>()(
  'VoucherNotFoundError',
  {
    voucherKey: VoucherKey,
  },
) {}

export class WrongClaimDataError extends S.TaggedError<WrongClaimDataError>()(
  'WrongClaimDataError',
  {},
) {}

export class MalformedDeviceTokenError extends S.TaggedError<MalformedDeviceTokenError>()(
  'MalformedDeviceTokenError',
  {},
) {}
