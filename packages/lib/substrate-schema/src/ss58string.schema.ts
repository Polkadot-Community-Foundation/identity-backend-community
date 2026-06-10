import { ss58Address, ss58Decode } from '@polkadot-labs/hdkd-helpers'
import { ParseResult, pipe, Schema as S } from 'effect'

export const Ss58String = pipe(
  S.transformOrFail(
    S.String,
    S.String,
    {
      strict: true,
      decode: (input, _options, ast) => {
        try {
          ss58Decode(input)
          return ParseResult.succeed(input)
        } catch {
          return ParseResult.fail(
            new ParseResult.Type(
              ast,
              input,
              'Invalid SS58 address format',
            ),
          )
        }
      },
      encode: (input) => ParseResult.succeed(input),
    },
  ),
  S.annotations({
    identifier: 'Ss58String',
    description: 'A string in SS58 address format used for Substrate-based chains',
    title: 'SS58 Address String',
    arbitrary: () => (fc) => fc.uint8Array({ minLength: 32, maxLength: 32 }).map((pubKey) => ss58Address(pubKey)),
  }),
  S.brand('Ss58String'),
)

export type Ss58String = S.Schema.Type<typeof Ss58String>

const SHORT_ADDRESS_MIN_LENGTH = 11

export const toShortSs58Address = (pubkey: string): string => {
  const hex = pubkey.startsWith('0x') ? pubkey.slice(2) : pubkey
  const bytes = Uint8Array.from(hex.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16)))
  const address = ss58Address(bytes)
  if (address.length <= SHORT_ADDRESS_MIN_LENGTH) {
    return address
  }
  return `${address.slice(0, 5)}…${address.slice(-5)}`
}
