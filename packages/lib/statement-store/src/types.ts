import { Brand, Schema as S } from 'effect'

export type StatementHash = string & Brand.Brand<'StatementHash'>

export const StatementHash = S.String.pipe(
  S.minLength(1),
  S.brand('StatementHash'),
)

export class VerifiedStatement extends S.Class<VerifiedStatement>('VerifiedStatement')({
  topics: S.Array(S.String),
  data: S.Uint8ArrayFromSelf.pipe(
    S.annotations({
      description: 'SCALE-encoded statement bytes',
      jsonSchema: {
        type: 'string',
        description: 'SCALE-encoded statement bytes as a hex string',
        contentEncoding: 'base16',
      },
    }),
  ),
  statementHash: StatementHash,
  proofSigner: S.String,
  signature: S.String,
  channel: S.NullOr(S.String),
  expiry: S.NullOr(
    S.BigIntFromSelf.pipe(
      S.annotations({
        description: 'Statement expiry timestamp',
        jsonSchema: {
          type: 'integer',
          description: 'Statement expiry timestamp (u64)',
          minimum: 0,
        },
      }),
    ),
  ),
}) {}
