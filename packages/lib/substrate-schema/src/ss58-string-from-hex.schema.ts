import { HexString } from '@identity-backend/schema-extensions'
import { ss58Address, ss58Decode } from '@polkadot-labs/hdkd-helpers'
import { ParseResult, pipe, Schema as S } from 'effect'

import { Ss58String } from './ss58string.schema.js'

export const Ss58StringFromHex = pipe(
  HexString,
  S.compose(S.Uint8ArrayFromHex),
  S.compose(
    S.transformOrFail(S.Uint8ArrayFromSelf, S.String, {
      decode: (bytes, _options, ast) => {
        try {
          return ParseResult.succeed(ss58Address(bytes))
        } catch {
          return ParseResult.fail(new ParseResult.Type(ast, bytes, 'Failed to encode public key as SS58'))
        }
      },
      encode: (ss58, _options, ast) => {
        try {
          const [bytes] = ss58Decode(ss58)
          return ParseResult.succeed(bytes)
        } catch {
          return ParseResult.fail(new ParseResult.Type(ast, ss58, 'Failed to decode SS58 address'))
        }
      },
    }),
  ),
  S.compose(Ss58String),
)
