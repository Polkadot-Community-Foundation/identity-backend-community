import { Effect, ParseResult, Schema as S } from 'effect'
import { SessionId, Solution } from './proof-of-compute.schema.js'

const ProofHeaderFields = S.Tuple(
  SessionId,
  S.compose(S.NumberFromString, Solution.fields.timestamp),
  S.compose(S.NumberFromString, Solution.fields.difficulty),
  S.compose(S.NumberFromString, Solution.fields.counter),
  Solution.fields.checksum,
)

const decodeProofHeaderFields = ParseResult.decodeUnknown(ProofHeaderFields)

export const SolutionFromHeader = S.transformOrFail(S.StringFromBase64, Solution, {
  strict: true,
  decode: (text) =>
    Effect.map(
      decodeProofHeaderFields(text.split(':')),
      ([sessionId, timestamp, difficulty, counter, checksum]) =>
        Solution.make({ sessionId, timestamp, difficulty, counter, checksum }),
    ),
  encode: (solution) =>
    ParseResult.succeed(
      `${solution.sessionId}:${solution.timestamp}:${solution.difficulty}:${solution.counter}:${solution.checksum}`,
    ),
}).pipe(S.annotations({ identifier: 'SolutionFromHeader' }))
