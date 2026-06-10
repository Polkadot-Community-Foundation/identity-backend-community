import { StrictHex } from '@identity-backend/schema-extensions'
import { Option, Schema as S } from 'effect'

export class FetchCrlError extends S.TaggedError<FetchCrlError>()('FetchCrlError', {
  cause: S.Unknown,
}) {
}

export class ParseCrlError extends S.TaggedError<ParseCrlError>()('ParseCrlError', {
  cause: S.Unknown,
}) {
}

export class CertificateRevokedError extends S.TaggedError<CertificateRevokedError>()(
  'CertificateRevokedError',
  {
    serialHex: S.String,
    position: S.Number,
  },
) {
}

export interface CrlEntry {
  readonly status: string
  readonly reason: Option.Option<string>
}

export interface CrlResponse {
  readonly entries: Readonly<Record<string, CrlEntry>>
}

export const CrlEntryFromJson = S.Struct({
  status: S.String,
  reason: S.optionalWith(S.String, { as: 'Option' }),
})

export const CrlResponseFromJson = S.Struct({
  entries: S.Record({ key: StrictHex, value: CrlEntryFromJson }),
})

export const normalizeCrlEntries = (
  entries: Readonly<Record<string, CrlEntry>>,
): Readonly<Record<string, CrlEntry>> => {
  const normalized: Record<string, CrlEntry> = {}
  for (const [key, entry] of Object.entries(entries)) {
    normalized[key.toLowerCase()] = entry
  }
  return normalized
}

export const normalizeSerialNumber = (serialHex: string): ReadonlyArray<string> => {
  const lowerHex = serialHex.toLowerCase()
  const candidates: Array<string> = [lowerHex]

  const bigIntValue = BigInt('0x' + lowerHex)
  candidates.push(bigIntValue.toString(10))

  return candidates
}

export const isSerialRevoked = (
  serialHex: string,
  crlEntries: Readonly<Record<string, CrlEntry>>,
): boolean => {
  const candidates = normalizeSerialNumber(serialHex)
  for (const candidate of candidates) {
    if (crlEntries[candidate] !== undefined) {
      return true
    }
  }
  return false
}

/* Stryker disable all */
if (import.meta.vitest) {
  const { ruleOfSchemas } = await import('@identity-backend/testing/schema')
  ruleOfSchemas('CrlEntryFromJson', CrlEntryFromJson)
  ruleOfSchemas('CrlResponseFromJson', CrlResponseFromJson)
}
