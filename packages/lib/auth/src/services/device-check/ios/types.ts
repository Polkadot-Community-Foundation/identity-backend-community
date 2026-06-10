import { Schema as S } from 'effect'

export class BitState extends S.Class<BitState>('BitState')({
  bit0: S.Boolean,
  bit1: S.Boolean,
  last_update_time: S.DateFromString.pipe(S.compose(S.ValidDateFromSelf)),
}) {}
