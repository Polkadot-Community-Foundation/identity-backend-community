import { StrictHex } from '@identity-backend/schema-extensions'
import { concatBytes, hexToBytes } from '@noble/hashes/utils.js'
import { ParseResult, Schema as S } from 'effect'

export const SessionId = S.UUID.pipe(S.brand('PocSessionId'))
export type SessionId = typeof SessionId.Type

const MAX_EPOCH_MS = 8_640_000_000_000_000 as const // max representable ECMAScript Date in ms

const PocTimestamp = S.Int.pipe(S.between(0, MAX_EPOCH_MS))

const ChecksumHex = StrictHex.pipe(
  S.length(64),
  S.annotations({ arbitrary: () => (fc) => fc.hexaString({ minLength: 64, maxLength: 64 }) }),
)

export class Puzzle extends S.Class<Puzzle>('PocPuzzle')({
  sessionId: SessionId,
  timestamp: PocTimestamp,
  difficulty: S.Int.pipe(S.between(1, 32)),
  checksum: ChecksumHex,
}) {}

export class Solution extends S.Class<Solution>('PocSolution')({
  sessionId: SessionId,
  timestamp: PocTimestamp,
  difficulty: S.Int.pipe(S.between(1, 32)),
  counter: S.Int.pipe(S.nonNegative()),
  checksum: ChecksumHex,
}) {}

const sessionIdToBytes = (sessionId: SessionId): Uint8Array => hexToBytes(sessionId.replaceAll('-', ''))

export const uint64BE = (value: number): Uint8Array => {
  const buffer = new ArrayBuffer(8)
  new DataView(buffer).setBigUint64(0, BigInt(value), false)
  return new Uint8Array(buffer)
}

export const ChecksumPreimage = S.transformOrFail(
  S.Struct({ sessionId: SessionId, timestamp: Solution.fields.timestamp, difficulty: Solution.fields.difficulty }),
  S.Uint8ArrayFromSelf,
  {
    strict: true,
    decode: ({ difficulty, sessionId, timestamp }) =>
      ParseResult.succeed(concatBytes(sessionIdToBytes(sessionId), uint64BE(timestamp), Uint8Array.of(difficulty))),
    encode: (bytes, _options, ast) =>
      ParseResult.fail(new ParseResult.Forbidden(ast, bytes, 'ChecksumPreimage is one-way (fields to bytes)')),
  },
)

export const WorkPreimage = S.transformOrFail(
  S.Struct({ sessionId: SessionId, timestamp: Solution.fields.timestamp, counter: Solution.fields.counter }),
  S.Uint8ArrayFromSelf,
  {
    strict: true,
    decode: ({ counter, sessionId, timestamp }) =>
      ParseResult.succeed(concatBytes(sessionIdToBytes(sessionId), uint64BE(timestamp), uint64BE(counter))),
    encode: (bytes, _options, ast) =>
      ParseResult.fail(new ParseResult.Forbidden(ast, bytes, 'WorkPreimage is one-way (fields to bytes)')),
  },
)

export class MissingProofHeaderError extends S.TaggedError<MissingProofHeaderError>()('PocMissingProofHeader', {}) {}

export class MalformedProofHeaderError
  extends S.TaggedError<MalformedProofHeaderError>()('PocMalformedProofHeader', {})
{}

export class ChecksumMismatchError extends S.TaggedError<ChecksumMismatchError>()('PocChecksumMismatch', {}) {}

export class ProofExpiredError extends S.TaggedError<ProofExpiredError>()('PocExpired', {}) {}

export class ProofReplayedError extends S.TaggedError<ProofReplayedError>()('PocReplayed', {}) {}

export class InsufficientDifficultyError
  extends S.TaggedError<InsufficientDifficultyError>()('PocInsufficientDifficulty', {})
{}

export const VerificationError = S.Union(
  ChecksumMismatchError,
  ProofExpiredError,
  ProofReplayedError,
  InsufficientDifficultyError,
)
export type VerificationError = typeof VerificationError.Type

export type GateError = MissingProofHeaderError | MalformedProofHeaderError | VerificationError

/* Stryker disable all */
if (import.meta.vitest) {
  const { ruleOfSchemas } = await import('@identity-backend/testing/schema')
  ruleOfSchemas('Puzzle', Puzzle)
  ruleOfSchemas('Solution', Solution)
}
