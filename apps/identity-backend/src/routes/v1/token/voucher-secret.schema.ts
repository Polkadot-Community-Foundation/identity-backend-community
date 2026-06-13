import { Schema as S } from 'effect'

export const VoucherSecretHash = S.String.pipe(
  S.pattern(/^[0-9a-f]{64}$/),
  S.brand('VoucherSecretHash'),
)
export type VoucherSecretHash = typeof VoucherSecretHash.Type
