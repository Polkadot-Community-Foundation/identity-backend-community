import { sha256 } from '@noble/hashes/sha2.js'
import { hexToBytes } from '@noble/hashes/utils.js'

const sessionIdToBytes = (sessionId: string): Uint8Array => hexToBytes(sessionId.replaceAll('-', ''))

const uint64BE = (value: number): Uint8Array => {
  const buffer = new ArrayBuffer(8)
  new DataView(buffer).setBigUint64(0, BigInt(value), false)
  return new Uint8Array(buffer)
}

const leadingZeroBits = (digest: Uint8Array): number =>
  Math.clz32(new DataView(digest.buffer, digest.byteOffset, 4).getUint32(0, false))

export interface Puzzle {
  sessionId: string
  timestamp: number
  difficulty: number
  checksum: string
}

export const solvePuzzle = async (
  puzzle: Puzzle,
  maxAttempts = 1_000_000,
): Promise<string> => {
  let counter = 0
  const preimage = new Uint8Array([
    ...sessionIdToBytes(puzzle.sessionId),
    ...uint64BE(puzzle.timestamp),
    ...uint64BE(0),
  ])

  for (; counter < maxAttempts; counter++) {
    new DataView(preimage.buffer, preimage.byteLength - 8).setBigUint64(0, BigInt(counter), false)
    const digest = sha256(preimage)

    if (leadingZeroBits(digest) >= puzzle.difficulty) {
      const header = `${puzzle.sessionId}:${puzzle.timestamp}:${puzzle.difficulty}:${counter}:${puzzle.checksum}`
      return btoa(header)
    }
  }

  throw new Error(`Failed to solve PoC puzzle after ${maxAttempts} attempts`)
}
