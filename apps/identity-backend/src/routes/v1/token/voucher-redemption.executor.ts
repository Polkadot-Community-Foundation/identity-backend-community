import { IssueTokenCommand } from '#root/jwt/core/jwt.types.js'
import { IssueTokenUseCase } from '#root/jwt/shell/issue-token.use-case.js'
import { verifyClientProof } from '#root/jwt/shell/verify-client-proof.executor.js'
import { DB } from '@identity-backend/db'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { decodeBase64 } from '@std/encoding'
import { Effect, Option as O, Runtime, Schema as S } from 'effect'

import {
  ClaimRepeated,
  ClaimUnregistered,
  ClaimWon,
  decideVoucherRedemption,
  InvalidVoucherError,
} from './voucher-redemption.workflow.js'
import { VoucherSecretHash } from './voucher-secret.schema.js'
import { claimVoucher, findVoucher } from './voucher-secret.store.js'

export interface RedeemVoucherCommand {
  readonly secret: string
  readonly clientId: Uint8Array
  readonly clientProof: Uint8Array
  readonly challenge: Uint8Array
  readonly body: Uint8Array
  readonly iosPackage: string | undefined
}

type TokenPair = { readonly token: string; readonly refreshToken: string }

export const redeemVoucher = Effect.fn('voucher.redeem')(function*(
  command: RedeemVoucherCommand,
) {
  const db = yield* DB
  const issueTokenUseCase = yield* IssueTokenUseCase
  const runtime = yield* Effect.runtime()

  yield* verifyClientProof({
    clientId: command.clientId,
    clientProof: command.clientProof,
    challenge: command.challenge,
    body: command.body,
  })

  const secretBytes = yield* Effect.try({
    try: () => decodeBase64(command.secret),
    catch: () => new InvalidVoucherError(),
  })
  const secretHash = VoucherSecretHash.make(bytesToHex(sha256(secretBytes)))

  const cmd = yield* S.decode(IssueTokenCommand)({
    clientId: command.clientId,
    clientProof: command.clientProof,
    challenge: command.challenge,
    body: command.body,
    attestationResult: undefined,
    iosPackage: command.iosPackage,
  }).pipe(Effect.orDie)

  const claimAndIssue = (tx: DB['Type']) =>
    claimVoucher(secretHash, tx).pipe(
      Effect.flatMap((claimed) =>
        O.match(claimed, {
          onNone: () => Effect.succeedNone,
          onSome: () => issueTokenUseCase.issueToken(cmd, tx).pipe(Effect.asSome),
        })
      ),
    )

  const issued: O.Option<TokenPair> = yield* Effect.tryPromise(() =>
    db.transaction((tx) => Runtime.runPromise(runtime)(claimAndIssue(tx)))
  ).pipe(Effect.orDie)

  const probe = yield* O.match(issued, {
    onSome: () => Effect.succeed(new ClaimWon()),
    onNone: () =>
      findVoucher(secretHash).pipe(
        Effect.map(O.match({
          onNone: () => new ClaimUnregistered(),
          onSome: () => new ClaimRepeated(),
        })),
      ),
  })

  yield* decideVoucherRedemption(probe)

  return yield* O.match(issued, {
    onNone: () => Effect.dieMessage('voucher claimed but no token issued'),
    onSome: (pair) => Effect.succeed(pair),
  })
})
