import { sha256 } from '@noble/hashes/sha2.js'
import { hexToBytes } from '@noble/hashes/utils.js'

export interface Puzzle {
  sessionId: string
  timestamp: number
  difficulty: number
  checksum: string
}

const DEFAULT_MAX_ATTEMPTS = 1 << 24

const sessionIdToBytes = (sessionId: string): Uint8Array => hexToBytes(sessionId.replaceAll('-', ''))

const uint64BE = (value: number): Uint8Array => {
  const buffer = new ArrayBuffer(8)
  new DataView(buffer).setBigUint64(0, BigInt(value), false)
  return new Uint8Array(buffer)
}

export const leadingZeroBits = (digest: Uint8Array): number =>
  Math.clz32(new DataView(digest.buffer, digest.byteOffset, 4).getUint32(0, false))

export function workHash(sessionId: string, timestamp: number, counter: number): Uint8Array {
  return sha256(new Uint8Array([...sessionIdToBytes(sessionId), ...uint64BE(timestamp), ...uint64BE(counter)]))
}

export function solvePuzzle(puzzle: Puzzle, maxAttempts: number = DEFAULT_MAX_ATTEMPTS): string {
  const preimage = new Uint8Array([
    ...sessionIdToBytes(puzzle.sessionId),
    ...uint64BE(puzzle.timestamp),
    ...uint64BE(0),
  ])
  for (let counter = 0; counter < maxAttempts; counter++) {
    new DataView(preimage.buffer, preimage.byteLength - 8).setBigUint64(0, BigInt(counter), false)
    if (leadingZeroBits(sha256(preimage)) >= puzzle.difficulty) {
      return btoa(`${puzzle.sessionId}:${puzzle.timestamp}:${puzzle.difficulty}:${counter}:${puzzle.checksum}`)
    }
  }
  throw new Error(`proof-of-compute unsolved within ${maxAttempts} attempts at difficulty ${puzzle.difficulty}`)
}
