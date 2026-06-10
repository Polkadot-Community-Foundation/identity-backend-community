import { Context, Effect, Match, Option as O, Schema as S } from 'effect'

import type {
  InstantClaim,
  PaymentAddressProvider,
} from '#root/username-registration/registration-queue/claim-ports.js'
import {
  AndroidDeviceIdentifiers,
  type ClaimDecision,
  MalformedDeviceTokenError,
  VoucherAlreadyUsedError,
  VoucherKey,
} from '#root/username-registration/registration-queue/claim.schema.js'
import {
  decideClaim,
  DecideClaimCommand,
  DeviceAbsent,
  DeviceMatched,
  DeviceUnmatched,
  VoucherAbsent,
  VoucherMissing,
  VoucherRedeemable,
  VoucherSpent,
} from '#root/username-registration/registration-queue/decide-claim.workflow.js'
import { DecodeAndroidDeviceTokenACL } from '#root/username-registration/registration-queue/device-token.acl.js'
import {
  EnqueueCommand,
  type EnqueueUsernameRegistrationUseCase,
} from '#root/username-registration/registration-queue/enqueue.use-case.js'
import { CandidateAccountId } from '#root/username-registration/registration-queue/entry.schema.js'
import { poudMatch, storePoudIdentifiers } from '#root/username-registration/registration-queue/poud.store.js'
import { findVoucherByKey, markVoucherUsed } from '#root/username-registration/registration-queue/voucher.store.js'

export class ClaimUsernameExecutorDeps extends Context.Tag('ClaimUsernameExecutorDeps')<
  ClaimUsernameExecutorDeps,
  {
    readonly quote: PaymentAddressProvider['Type']['quote']
    readonly claimInstant: InstantClaim['Type']['claim']
    readonly enqueue: EnqueueUsernameRegistrationUseCase['Type']
  }
>() {}

const decodeAndroidDeviceToken = S.decode(DecodeAndroidDeviceTokenACL)

export class ClaimCommand extends S.Class<ClaimCommand>('ClaimCommand')({
  username: S.String,
  candidateAccountId: CandidateAccountId,
  voucherKey: S.Option(VoucherKey),
  deviceToken: S.Option(S.String),
  appFromOfficialStore: S.Boolean,
}) {}

const readVoucherState = Effect.fnUntraced(function*(
  voucherKey: O.Option<VoucherKey>,
) {
  if (O.isNone(voucherKey)) {
    return new VoucherAbsent()
  }
  const key = voucherKey.value
  const maybeRow = yield* findVoucherByKey(key)
  return O.match(maybeRow, {
    onNone: () => new VoucherMissing({ voucherKey: key }),
    onSome: (row) =>
      row.used
        ? new VoucherSpent({ voucherKey: key })
        : new VoucherRedeemable({ voucherKey: key }),
  })
})

const readDeviceEvidence = Effect.fnUntraced(function*(
  deviceToken: O.Option<string>,
) {
  if (O.isNone(deviceToken)) {
    return new DeviceAbsent()
  }
  const identifiers = yield* decodeAndroidDeviceToken(deviceToken.value).pipe(
    Effect.catchTag('ParseError', () => new MalformedDeviceTokenError()),
  )
  const matched = yield* poudMatch(identifiers)
  return matched
    ? new DeviceMatched({ identifiers })
    : new DeviceUnmatched({ identifiers })
})

const writeInstant = Effect.fn('claim.writeInstant')(function*(
  voucherKey: VoucherKey,
  claimInstant: InstantClaim['Type']['claim'],
) {
  const claimed = yield* markVoucherUsed(voucherKey)
  if (!claimed) return yield* new VoucherAlreadyUsedError({ voucherKey })
  yield* claimInstant(voucherKey)
})

const writeQueued = Effect.fn('claim.writeQueued')(function*(
  identifiers: AndroidDeviceIdentifiers,
  username: string,
  candidateAccountId: CandidateAccountId,
  enqueue: EnqueueUsernameRegistrationUseCase['Type'],
) {
  yield* storePoudIdentifiers(identifiers, candidateAccountId)
  const cmd = yield* S.decode(EnqueueCommand)({ username, candidateAccountId }).pipe(Effect.orDie)
  const enqueued = yield* enqueue(cmd)
  return enqueued.position
})

const applyDecision = Effect.fnUntraced(function*(
  decision: ClaimDecision,
  username: string,
  candidateAccountId: CandidateAccountId,
  claimInstant: InstantClaim['Type']['claim'],
  enqueue: EnqueueUsernameRegistrationUseCase['Type'],
) {
  return yield* Match.value(decision).pipe(
    Match.tag('ClaimInstant', (d) => writeInstant(d.voucherKey, claimInstant).pipe(Effect.as(null))),
    Match.tag('ClaimQueued', (d) => writeQueued(d.deviceIdentifiers, username, candidateAccountId, enqueue)),
    Match.tag('ClaimPaymentRequired', () => Effect.succeed(null)),
    Match.exhaustive,
  )
})

export const ClaimUsernameExecutor = Effect.fn('ClaimUsernameExecutor')(function*(
  command: ClaimCommand,
) {
  const { quote, claimInstant, enqueue } = yield* ClaimUsernameExecutorDeps

  const voucher = yield* readVoucherState(command.voucherKey)
  const device = yield* readDeviceEvidence(command.deviceToken)
  const { amountRequired, paymentAddress } = yield* quote()

  const decision = yield* decideClaim(
    new DecideClaimCommand({
      voucher,
      appFromOfficialStore: command.appFromOfficialStore,
      device,
      paymentAddress,
      amountRequired,
    }),
  )

  const queuePosition = yield* applyDecision(
    decision,
    command.username,
    command.candidateAccountId,
    claimInstant,
    enqueue,
  )
  return { decision, queuePosition }
})

export type ClaimUsernameExecutorError = Effect.Effect.Error<ReturnType<typeof ClaimUsernameExecutor>>
