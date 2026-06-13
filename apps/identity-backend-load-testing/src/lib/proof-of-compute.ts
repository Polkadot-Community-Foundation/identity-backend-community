import crypto from 'k6/crypto'
import encoding from 'k6/encoding'
import http from 'k6/http'
import { concatBytes, hexToBytes, leadingZeroBitsOfHexDigest, uint64BigEndian } from './bytes'
import { tracedHeaders } from './trace-context'

export interface Puzzle {
  sessionId: string
  timestamp: number
  difficulty: number
  checksum: string
}

export interface SolvedPuzzle extends Puzzle {
  counter: number
  iterations: number
}

const MAX_SOLVE_ITERATIONS = 1 << 24

function sessionIdToBytes(sessionId: string): Uint8Array {
  return hexToBytes(sessionId.replace(/-/g, ''))
}

function workHashHex(sessionId: string, timestamp: number, counter: number): string {
  const preimage = concatBytes(sessionIdToBytes(sessionId), uint64BigEndian(timestamp), uint64BigEndian(counter))
  return crypto.sha256(preimage.buffer, 'hex')
}

export function solvePuzzle(puzzle: Puzzle): SolvedPuzzle {
  for (let counter = 0; counter < MAX_SOLVE_ITERATIONS; counter++) {
    const bits = leadingZeroBitsOfHexDigest(workHashHex(puzzle.sessionId, puzzle.timestamp, counter))
    if (bits >= puzzle.difficulty) {
      return { ...puzzle, counter, iterations: counter + 1 }
    }
  }
  throw new Error(
    `proof-of-compute unsolved within ${MAX_SOLVE_ITERATIONS} iterations at difficulty ${puzzle.difficulty}`,
  )
}

export function encodeProofHeader(solved: SolvedPuzzle): string {
  const raw = `${solved.sessionId}:${solved.timestamp}:${solved.difficulty}:${solved.counter}:${solved.checksum}`
  return encoding.b64encode(raw, 'std')
}

const REFERENCE_SESSION_ID = '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed'
const REFERENCE_TIMESTAMP = 1_700_000_000_000
const REFERENCE_BITS_AT_ZERO = 3
const REFERENCE_BITS_AT_12345 = 0

export function solverMatchesServerVectors(): boolean {
  const bitsAtZero = leadingZeroBitsOfHexDigest(workHashHex(REFERENCE_SESSION_ID, REFERENCE_TIMESTAMP, 0))
  const bitsAt12345 = leadingZeroBitsOfHexDigest(workHashHex(REFERENCE_SESSION_ID, REFERENCE_TIMESTAMP, 12_345))
  return bitsAtZero === REFERENCE_BITS_AT_ZERO && bitsAt12345 === REFERENCE_BITS_AT_12345
}

export interface PocResult {
  header: string | null
  enabled: boolean
  iterations: number
}

export function obtainProofHeader(baseUrl: string, scenario: string): PocResult {
  const issue = http.post(`${baseUrl}/api/v1/poc/issue`, null, {
    headers: tracedHeaders(scenario),
    tags: { scenario, endpoint: 'poc_issue' },
  })

  if (issue.status !== 201) {
    return { header: null, enabled: false, iterations: 0 }
  }

  const puzzle = issue.json() as unknown as Puzzle
  const solved = solvePuzzle(puzzle)
  return { header: encodeProofHeader(solved), enabled: true, iterations: solved.iterations }
}
