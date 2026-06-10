/// <reference types="vitest/importMeta" />
import { sr25519 } from '@identity-backend/crypto'
import { parseExpiry, statementCodec } from '@novasamatech/sdk-statement'
import type { Statement as SdkStatement } from '@novasamatech/sdk-statement'
import { Blake2256, compact } from '@polkadot-api/substrate-bindings'
import { fromHex, toHex } from '@polkadot-api/utils'
import { Clock, Effect, Either, Logger, LogLevel, Metric, Option, Predicate, Schema as S, Stream } from 'effect'
import { dual, pipe } from 'effect/Function'
import { StatementHash, VerifiedStatement } from './types.js'

export const extractSr25519Proof = (
  stmt: SdkStatement,
): Option.Option<{ readonly signer: string; readonly signature: string }> => {
  if (stmt.proof?.type !== 'sr25519') return Option.none()
  return Option.some({ signer: stmt.proof.value.signer, signature: stmt.proof.value.signature })
}

const getStatementHash = (stmt: SdkStatement) => toHex(Blake2256(statementCodec.enc(stmt)))

const stripProof = (stmt: SdkStatement): SdkStatement => {
  const { proof: _, ...unsigned } = stmt
  return unsigned
}

const encodeUnsignedMessage = (stmt: SdkStatement) => {
  const unsigned = stripProof(stmt)
  const encoded = statementCodec.enc(unsigned)
  const compactLen = compact.enc(compact.dec(encoded)).length
  return encoded.slice(compactLen)
}

const getProofSigner = (stmt: SdkStatement): string | null => {
  if (!stmt.proof) return null
  if (stmt.proof.type === 'sr25519') return stmt.proof.value.signer
  if (stmt.proof.type === 'onChain') return stmt.proof.value.who
  return null
}

export type ProcessStatementRejectionReason =
  | 'no_proof'
  | 'bad_proof'

const proofFromStatement = (
  stmt: SdkStatement,
): Either.Either<{ readonly signer: string; readonly signature: string }, ProcessStatementRejectionReason> =>
  pipe(
    stmt.proof,
    Option.fromNullable,
    Option.match({
      onNone: (): Either.Either<
        { readonly signer: string; readonly signature: string },
        ProcessStatementRejectionReason
      > => Either.left('no_proof'),
      onSome: () =>
        pipe(
          extractSr25519Proof(stmt),
          Option.match({
            onNone: (): Either.Either<
              { readonly signer: string; readonly signature: string },
              ProcessStatementRejectionReason
            > => Either.left('bad_proof'),
            onSome: Either.right,
          }),
        ),
    }),
  )

const verifySignature = (
  stmt: SdkStatement,
  proof: { readonly signer: string; readonly signature: string },
): Either.Either<void, ProcessStatementRejectionReason> => {
  const message = encodeUnsignedMessage(stmt)
  const ok = sr25519.verify(fromHex(proof.signer), message, fromHex(proof.signature))
  if (ok) {
    return Either.right(undefined)
  }
  return Either.left('bad_proof')
}

const requireProofSigner = (stmt: SdkStatement): Either.Either<string, ProcessStatementRejectionReason> => {
  const proofSigner = getProofSigner(stmt)
  if (proofSigner === null) {
    return Either.left('bad_proof')
  }
  return Either.right(proofSigner)
}

export const isExpiredAt = (
  expiry: bigint,
  nowMillis: number,
): boolean => {
  const { timestamp: expiryTimestampSecs } = parseExpiry(expiry)
  const nowSecs = Math.floor(nowMillis / 1000)
  return expiryTimestampSecs < nowSecs
}

export const processStatement = (
  stmt: SdkStatement,
): Either.Either<VerifiedStatement, ProcessStatementRejectionReason> =>
  Either.gen(function*() {
    const proof = yield* proofFromStatement(stmt)
    yield* verifySignature(stmt, proof)
    const proofSigner = yield* requireProofSigner(stmt)

    const statementHash = yield* pipe(
      S.decodeUnknownEither(StatementHash)(getStatementHash(stmt)),
      Either.mapLeft((): ProcessStatementRejectionReason => 'bad_proof'),
    )

    return new VerifiedStatement({
      topics: [...(stmt.topics ?? [])],
      data: stmt.data ?? new Uint8Array(0),
      statementHash,
      proofSigner,
      signature: proof.signature,
      channel: stmt.channel ?? null,
      expiry: stmt.expiry ?? null,
    })
  })

export const statementRejectionCounter = Metric.counter(
  'app.statement_store.rejection',
  { description: 'Statement verification rejection count' },
)

export type VerifyStream = {
  <E, R>(): (stream: Stream.Stream<SdkStatement, E, R>) => Stream.Stream<VerifiedStatement, E, R>
  <E, R>(stream: Stream.Stream<SdkStatement, E, R>): Stream.Stream<VerifiedStatement, E, R>
}

export const verifyStream: VerifyStream = dual(
  (args) => args.length >= 1 && Predicate.hasProperty(args[0], Stream.StreamTypeId),
  <E, R>(stream: Stream.Stream<SdkStatement, E, R>) =>
    stream.pipe(
      Stream.mapEffect((stmt) =>
        Effect.gen(function*() {
          const verdict = processStatement(stmt)
          if (Either.isLeft(verdict)) {
            const hash = getStatementHash(stmt)
            const signer = getProofSigner(stmt)
            yield* Logger.withMinimumLogLevel(LogLevel.Warning)(
              Effect.logWarning(`Statement rejected: ${verdict.left}`).pipe(
                Effect.annotateLogs('hash', hash),
                Effect.annotateLogs('reason', verdict.left),
                Effect.annotateLogs('signer', signer ?? 'unknown'),
              ),
            )
            yield* Metric.increment(Metric.tagged(statementRejectionCounter, 'reason', verdict.left))
            return Option.none<VerifiedStatement>()
          }
          const verified = verdict.right
          if (verified.expiry === null) return Option.some(verified)
          const now = yield* Clock.currentTimeMillis
          if (isExpiredAt(verified.expiry, now)) {
            return Option.none<VerifiedStatement>()
          }
          return Option.some(verified)
        })
      ),
      Stream.filterMap((option) => option),
    ),
)

if (import.meta.vitest) {
  const { it, expect, describe } = import.meta.vitest

  const SENDER_HEX = '0x' + 'ab'.repeat(32)

  describe('extractSr25519Proof', () => {
    it.each([
      ['sr25519', {
        proof: { type: 'sr25519' as const, value: { signer: SENDER_HEX, signature: '0x' + 'ff'.repeat(64) } },
      }, true],
      ['onChain', {
        proof: { type: 'onChain' as const, value: { who: SENDER_HEX, blockHash: '0x' + '00'.repeat(32), event: 0n } },
      }, false],
      ['missing', {}, false],
    ])('Should_Extract_When_%s', (_, stmt, isSome) => {
      const result = extractSr25519Proof(stmt)
      expect(Option.isSome(result)).toBe(isSome)
    })
  })

  describe('getProofSigner', () => {
    it.each([
      ['sr25519', {
        proof: { type: 'sr25519' as const, value: { signer: SENDER_HEX, signature: '0x' + 'ff'.repeat(64) } },
      }, SENDER_HEX],
      ['onChain', {
        proof: { type: 'onChain' as const, value: { who: SENDER_HEX, blockHash: '0x' + '00'.repeat(32), event: 0n } },
      }, SENDER_HEX],
      ['missing', {}, null],
    ])('Should_ReturnPubkey_When_%s', (_, stmt, expected) => {
      expect(getProofSigner(stmt)).toBe(expected)
    })
  })
}
