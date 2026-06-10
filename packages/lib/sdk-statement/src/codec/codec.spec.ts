import { fromHex, toHex } from '@polkadot-api/utils'
import { describe, expect, it } from 'vitest'
import { statementCodec } from './codec'

describe('statement codec', () => {
  it('Should_EncodeAndDecodeEmptyStatement_When_NoFieldsProvided', () => {
    const emptyStmtEncoded = statementCodec.enc({})
    const emptyStmtDecoded = statementCodec.dec(Uint8Array.from([0]))

    expect(emptyStmtDecoded).toEqual({})
    expect(emptyStmtEncoded).toEqual(Uint8Array.from([0]))
  })

  it('Should_ThrowError_When_KeysAreRepeatedOrUnordered', () => {
    expect(() => {
      statementCodec.dec(
        fromHex('0x0802010000000000000002030000000000000000'),
      )
    }).toThrow('entries order')

    expect(() => {
      statementCodec.dec(
        fromHex(
          '0x0803000000000000000000000000000000000000000000000000000000000000000002010000000000000000',
        ),
      )
    }).toThrow('entries order')
  })

  it('Should_ThrowError_When_TopicsAreMissing', () => {
    expect(() => {
      statementCodec.dec(
        fromHex(
          '0x04050000000000000000000000000000000000000000000000000000000000000000',
        ),
      )
    }).toThrow('Unexpected topic')
  })

  it('Should_EncodeAndDecodeStatement_When_ExpiryProvided', () => {
    const stmt = { expiry: 12345678901234567890n }
    const encoded = statementCodec.enc(stmt)
    const decoded = statementCodec.dec(encoded)
    expect(decoded.expiry).toBe(12345678901234567890n)
  })

  it('Should_EncodeExpiryAsLittleEndianU64_When_ExpiryIsSet', () => {
    const stmt = { expiry: 1n }
    const encoded = statementCodec.enc(stmt)
    expect(toHex(encoded)).toBe('0x04020100000000000000')
  })
})
