import { Option } from 'effect'
import { describe, expect, it } from 'vitest'
import { isSerialRevoked, normalizeSerialNumber } from '../crl.js'
import type { CrlEntry } from '../crl.js'

describe('normalizeSerialNumber', () => {
  it('Should_ReturnBothHexAndBigint_When_GivenHexInput', () => {
    const candidates = normalizeSerialNumber('a1b2')
    expect(candidates).toContain('a1b2')
    expect(candidates).toContain('41394')
  })

  it('Should_NormalizeToLowercase_When_GivenUppercaseInput', () => {
    const candidates = normalizeSerialNumber('A1B2')
    expect(candidates).toContain('a1b2')
  })

  it('Should_ReturnTwoCandidates_When_GivenLongHexSerial', () => {
    const candidates = normalizeSerialNumber('c35747a084470c3135aeefe2b8d40cd6')
    expect(candidates).toContain('c35747a084470c3135aeefe2b8d40cd6')
    expect(candidates.length).toBe(2)
  })
})

describe('isSerialRevoked', () => {
  const crlEntries: Record<string, CrlEntry> = {
    'deadbeef': { status: 'REVOKED', reason: Option.some('KEY_COMPROMISE') },
    '41394': { status: 'REVOKED', reason: Option.some('SOFTWARE_FLAW') },
  }

  it('Should_ReturnTrue_When_HexSerialIsInRevokedEntries', () => {
    expect(isSerialRevoked('deadbeef', crlEntries)).toBe(true)
  })

  it('Should_ReturnTrue_When_BigintSerialIsInRevokedEntries', () => {
    expect(isSerialRevoked('a1b2', crlEntries)).toBe(true)
  })

  it('Should_ReturnTrue_When_SerialIsSuspended', () => {
    expect(isSerialRevoked('cafebabe', {
      'cafebabe': { status: 'SUSPENDED', reason: Option.none() },
    })).toBe(true)
  })

  it('Should_ReturnFalse_When_SerialIsNotInRevokedEntries', () => {
    expect(isSerialRevoked('cafebabe', crlEntries)).toBe(false)
  })

  it('Should_ReturnTrue_When_UpperCasedHexIsInRevokedEntries', () => {
    expect(isSerialRevoked('DEADBEEF', crlEntries)).toBe(true)
  })
})
