import { Schema as S } from 'effect'

export const U64_MAX = 18446744073709551615n

const RpcU64FromFiniteNumber = S.Finite.pipe(
  S.transform(S.BigIntFromSelf, {
    decode: (n) => BigInt(Math.trunc(n)),
    encode: (b) => Number(b),
  }),
)

export const RpcU64Schema = S.Union(S.BigIntFromSelf, RpcU64FromFiniteNumber).pipe(
  S.betweenBigInt(0n, U64_MAX),
).annotations({ identifier: 'StatementSubmitRpcU64' })
