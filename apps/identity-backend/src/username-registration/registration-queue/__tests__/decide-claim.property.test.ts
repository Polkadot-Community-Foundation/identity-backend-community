import { describe, it } from '@effect/vitest'
import { Arbitrary, Either, FastCheck as fc, Schema as S } from 'effect'

import { PlanckBalance } from '#root/schema/balance.js'
import {
  AndroidDeviceIdentifiers,
  ClaimDecision,
  ClaimInstant,
  ClaimPaymentRequired,
  ClaimQueued,
  PaymentAddress,
  VoucherAlreadyUsedError,
  VoucherKey,
  VoucherNotFoundError,
  WrongClaimDataError,
} from '#root/username-registration/registration-queue/claim.schema.js'
import {
  decideClaim,
  DecideClaimCommand,
  DecideClaimError,
  DeviceAbsent,
  DeviceMatched,
  DeviceUnmatched,
  VoucherAbsent,
  VoucherMissing,
  VoucherRedeemable,
  VoucherSpent,
} from '#root/username-registration/registration-queue/decide-claim.workflow.js'

const arbVoucherKey = Arbitrary.make(VoucherKey)
const arbPaymentAddress = Arbitrary.make(PaymentAddress)
const arbAmount = Arbitrary.make(PlanckBalance)
const arbIdentifiers = Arbitrary.make(AndroidDeviceIdentifiers)

const arbDeviceAbsent = fc.constant(new DeviceAbsent())
const arbDeviceMatched = arbIdentifiers.map((identifiers) => new DeviceMatched({ identifiers }))
const arbDeviceUnmatched = arbIdentifiers.map((identifiers) => new DeviceUnmatched({ identifiers }))

const anyDevice = fc.oneof(arbDeviceAbsent, arbDeviceMatched, arbDeviceUnmatched)

const resultEq = S.equivalence(S.EitherFromSelf({ left: DecideClaimError, right: ClaimDecision }))

describe('decideClaim', () => {
  it.prop(
    '∀x_RejectSpentVoucher_⊥',
    [fc.tuple(arbVoucherKey, fc.boolean(), anyDevice, arbPaymentAddress, arbAmount)],
    ([[voucherKey, appFromOfficialStore, device, paymentAddress, amountRequired]]) =>
      resultEq(
        decideClaim(
          new DecideClaimCommand({
            voucher: new VoucherSpent({ voucherKey }),
            appFromOfficialStore,
            device,
            paymentAddress,
            amountRequired,
          }),
        ),
        Either.left(new VoucherAlreadyUsedError({ voucherKey })),
      ),
  )

  it.prop(
    '∀x_RejectMissingVoucher_⊥',
    [fc.tuple(arbVoucherKey, fc.boolean(), anyDevice, arbPaymentAddress, arbAmount)],
    ([[voucherKey, appFromOfficialStore, device, paymentAddress, amountRequired]]) =>
      resultEq(
        decideClaim(
          new DecideClaimCommand({
            voucher: new VoucherMissing({ voucherKey }),
            appFromOfficialStore,
            device,
            paymentAddress,
            amountRequired,
          }),
        ),
        Either.left(new VoucherNotFoundError({ voucherKey })),
      ),
  )

  it.prop(
    '∀x_RedeemValidVoucher_=x',
    [fc.tuple(arbVoucherKey, fc.boolean(), anyDevice, arbPaymentAddress, arbAmount)],
    ([[voucherKey, appFromOfficialStore, device, paymentAddress, amountRequired]]) =>
      resultEq(
        decideClaim(
          new DecideClaimCommand({
            voucher: new VoucherRedeemable({ voucherKey }),
            appFromOfficialStore,
            device,
            paymentAddress,
            amountRequired,
          }),
        ),
        Either.right(new ClaimInstant({ voucherKey })),
      ),
  )

  it.prop(
    '∀x_OffStoreRequiresPayment_=x',
    [fc.tuple(anyDevice, arbPaymentAddress, arbAmount)],
    ([[device, paymentAddress, amountRequired]]) =>
      resultEq(
        decideClaim(
          new DecideClaimCommand({
            voucher: new VoucherAbsent(),
            appFromOfficialStore: false,
            device,
            paymentAddress,
            amountRequired,
          }),
        ),
        Either.right(new ClaimPaymentRequired({ paymentAddress, amountRequired })),
      ),
  )

  it.prop(
    '∀x_PoudMatchRequiresPayment_=x',
    [fc.tuple(arbIdentifiers, arbPaymentAddress, arbAmount)],
    ([[identifiers, paymentAddress, amountRequired]]) =>
      resultEq(
        decideClaim(
          new DecideClaimCommand({
            voucher: new VoucherAbsent(),
            appFromOfficialStore: true,
            device: new DeviceMatched({ identifiers }),
            paymentAddress,
            amountRequired,
          }),
        ),
        Either.right(new ClaimPaymentRequired({ paymentAddress, amountRequired })),
      ),
  )

  it.prop(
    '∀x_PoudNoMatchQueues_=x',
    [fc.tuple(arbIdentifiers, arbPaymentAddress, arbAmount)],
    ([[identifiers, paymentAddress, amountRequired]]) =>
      resultEq(
        decideClaim(
          new DecideClaimCommand({
            voucher: new VoucherAbsent(),
            appFromOfficialStore: true,
            device: new DeviceUnmatched({ identifiers }),
            paymentAddress,
            amountRequired,
          }),
        ),
        Either.right(new ClaimQueued({ deviceIdentifiers: identifiers })),
      ),
  )

  it.prop(
    '∀x_NoVoucherNoDevice_⊥',
    [fc.tuple(arbPaymentAddress, arbAmount)],
    ([[paymentAddress, amountRequired]]) =>
      resultEq(
        decideClaim(
          new DecideClaimCommand({
            voucher: new VoucherAbsent(),
            appFromOfficialStore: true,
            device: new DeviceAbsent(),
            paymentAddress,
            amountRequired,
          }),
        ),
        Either.left(new WrongClaimDataError()),
      ),
  )
})
