import { Schema as S } from 'effect'

export const PlanckBalance = S.BigIntFromSelf.pipe(
  S.filter((balance) => balance >= 0n, {
    message: () => 'Planck balance must be non-negative',
  }),
  S.brand('PlanckBalance'),
)
export type PlanckBalance = typeof PlanckBalance.Type

export const PLANCK_PER_DOT = 10_000_000_000n
export const ZERO_PLANCK = PlanckBalance.make(0n)

export const dotToPlanck = (dots: bigint): PlanckBalance => PlanckBalance.make(dots * PLANCK_PER_DOT)
