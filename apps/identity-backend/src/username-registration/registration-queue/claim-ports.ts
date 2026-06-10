import { Context, Effect, Layer, Schema as S } from 'effect'

import { PlanckBalance } from '#root/schema/balance.js'
import { PaymentAddress, VoucherKey } from '#root/username-registration/registration-queue/claim.schema.js'

export class PaymentQuote extends S.Class<PaymentQuote>('PaymentQuote')({
  paymentAddress: PaymentAddress,
  amountRequired: PlanckBalance,
}) {}

const M2_PLACEHOLDER_PAYMENT_ADDRESS = PaymentAddress.make(
  '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY',
)
const M2_PLACEHOLDER_AMOUNT = PlanckBalance.make(0n)

export namespace PaymentAddressProvider {
  export type Definition = {
    readonly quote: () => Effect.Effect<PaymentQuote>
  }
}

export class PaymentAddressProvider extends Context.Tag('PaymentAddressProvider')<
  PaymentAddressProvider,
  PaymentAddressProvider.Definition
>() {
  static readonly Default = Layer.succeed(
    PaymentAddressProvider,
    PaymentAddressProvider.of({
      quote: () =>
        Effect.succeed(
          new PaymentQuote({
            paymentAddress: M2_PLACEHOLDER_PAYMENT_ADDRESS,
            amountRequired: M2_PLACEHOLDER_AMOUNT,
          }),
        ),
    }),
  )
}

export namespace InstantClaim {
  export type Definition = {
    readonly claim: (voucherKey: VoucherKey) => Effect.Effect<void>
  }
}

export class InstantClaim extends Context.Tag('InstantClaim')<
  InstantClaim,
  InstantClaim.Definition
>() {
  static readonly Default = Layer.succeed(
    InstantClaim,
    InstantClaim.of({
      claim: () => Effect.void,
    }),
  )
}
