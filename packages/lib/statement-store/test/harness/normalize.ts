import { parseExpiry, type SubmitResult } from '@novasamatech/sdk-statement'
import { HashSet } from 'effect'
import { type VerifiedStatement } from '../../src/index.js'

export interface ProjectionComparable {
  readonly statementHash: string
  readonly statementData: string
  readonly topics: readonly string[]
  readonly senderPubkey: string
  readonly signature: string
  readonly channel: string | null
  readonly expiry: string | null
}

const cplExpiryComparable = (expiry: bigint) => {
  const { timestamp, sequence } = parseExpiry(expiry)
  return { timestamp, sequence }
}

export const normalizeSubmit = (r: SubmitResult): unknown => {
  if (r.status === 'rejected' && r.reason === 'channelPriorityTooLow') {
    return {
      status: 'rejected',
      reason: r.reason,
      submitted_expiry: cplExpiryComparable(r.submitted_expiry),
      min_expiry: cplExpiryComparable(r.min_expiry),
    }
  }
  if (r.status === 'rejected' && r.reason === 'accountFull') {
    return {
      status: 'rejected',
      reason: r.reason,
      submitted_expiry: cplExpiryComparable(r.submitted_expiry),
      min_expiry: cplExpiryComparable(r.min_expiry),
    }
  }
  return r
}

export const normalizeProjection = (
  rows: ReadonlyArray<VerifiedStatement>,
  project: (vs: VerifiedStatement) => ProjectionComparable,
  scenarioHashes: ReadonlyArray<string>,
): ReadonlyArray<ProjectionComparable> => {
  const set = new Set(scenarioHashes)
  return [...rows]
    .filter((vs) => set.has(vs.statementHash))
    .map(project)
    .toSorted((a, b) => a.statementHash.localeCompare(b.statementHash))
}

export const normalizeStream = (
  batch: ReadonlyArray<VerifiedStatement>,
): ReadonlyArray<string> => sortedHashKeys(HashSet.toValues(HashSet.fromIterable(batch.map((vs) => vs.statementHash))))

export const normalizeFilters = (
  rows: ReadonlyArray<VerifiedStatement>,
  scenarioHashes: ReadonlyArray<string>,
): ReadonlyArray<string> => normalizeStream(rows.filter((vs) => scenarioHashes.includes(vs.statementHash)))

export const sortedHashKeys = (hashes: ReadonlyArray<string>): ReadonlyArray<string> =>
  [...hashes].toSorted((a, b) => a.localeCompare(b))
