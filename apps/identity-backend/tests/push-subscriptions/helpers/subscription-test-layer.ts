import { DB } from '#root/db/drizzle.js'
import * as schema from '#root/db/schema.js'
import { Topic } from '#root/features/subscriptions/types.js'
import { FCMPushService } from '#root/infrastructure/adapters/notifications/fcm/service.js'
import { type PushNotificationService, PushNotificationServiceError } from '@identity-backend/mobile-push-notifications'
import { StatementStoreService } from '@identity-backend/statement-store/fake'
import type { Statement as SdkStatement } from '@novasamatech/sdk-statement'
import { createExpiry, statementCodec } from '@novasamatech/sdk-statement'
import { Blake2256 } from '@polkadot-api/substrate-bindings'
import { sr25519CreateDerive } from '@polkadot-labs/hdkd'
import { DEV_PHRASE, entropyToMiniSecret, mnemonicToEntropy } from '@polkadot-labs/hdkd-helpers'
import { and, eq } from 'drizzle-orm'
import { Duration, Effect, TestClock } from 'effect'
import { toHex } from 'polkadot-api/utils'
import { expect, vi } from 'vitest'

export const CLIENT_ID = '0x' + 'a'.repeat(64)
export const RECEIVER_CLIENT_ID = '0x' + 'b'.repeat(64)

const aliceKey = (() => {
  const entropy = mnemonicToEntropy(DEV_PHRASE)
  const miniSecret = entropyToMiniSecret(entropy)
  const derive = sr25519CreateDerive(miniSecret)
  return derive('//Alice')
})()

export const aliceSignerPubkey = aliceKey.publicKey

const bobKey = (() => {
  const entropy = mnemonicToEntropy(DEV_PHRASE)
  const miniSecret = entropyToMiniSecret(entropy)
  const derive = sr25519CreateDerive(miniSecret)
  return derive('//Bob')
})()

export const bobSignerPubkey = bobKey.publicKey

/** Proof signer for statements and `sender_pubkey` on subscription rules (Alice). */
export const SENDER_PUBKEY = toHex(aliceSignerPubkey)
export const OTHER_SENDER_PUBKEY = toHex(bobSignerPubkey)

export const TOPIC = Topic.make('0x' + 'c'.repeat(64))

const defaultStatementExpiry = createExpiry(4102444800, 0)

let statementNonce = 0

/** One bounded virtual-time hop for statement processing and delivery. */
const DAEMON_SETTLE_ADVANCE = Duration.millis(200)
/** One short handoff hop after fake submit so PubSub reaches subscriber fiber. */
const STORE_HANDOFF_ADVANCE = Duration.millis(50)

/**
 * Bounded virtual-time settle: interleave the statement-processor fiber with
 * `TestClock` so heartbeat `Effect.sleep` and retry schedules can run.
 */
export const settleDaemon = Effect.gen(function*() {
  yield* Effect.yieldNow()
  yield* TestClock.adjust(DAEMON_SETTLE_ADVANCE)
  yield* Effect.yieldNow()
})

const handoffAfterStoreSubmit = Effect.gen(function*() {
  yield* Effect.yieldNow()
  yield* TestClock.adjust(STORE_HANDOFF_ADVANCE)
  yield* Effect.yieldNow()
})

export const makeApnSendMock = () =>
  vi.fn<PushNotificationService.Definition['send']>(() => Effect.succeed({ success: true, platform: 'ios', sent: 1 }))

export const makeFcmSendMock = () =>
  vi.fn<FCMPushService.Service['send']>(() =>
    Effect.succeed({ success: true, platform: 'android', messageId: 'test-msg-id' })
  )

export const makeApnFailure = (message: string) =>
  Effect.fail(new PushNotificationServiceError({ cause: new Error(message) }))

export interface SubmitSignedStatementOpts {
  readonly topics?: readonly Topic[]
  readonly data?: Uint8Array
  readonly channel?: `0x${string}` | null
}

const buildSignedRaw = (
  signerPublicKey: Uint8Array,
  sign: (payload: Uint8Array) => Uint8Array,
  opts?: SubmitSignedStatementOpts,
): Effect.Effect<{ raw: SdkStatement; statementHash: string }, never, never> =>
  Effect.gen(function*() {
    const n = statementNonce++
    const { getStatementSigner } = yield* Effect.promise(() => import('@novasamatech/sdk-statement'))
    const topics = opts?.topics ?? [TOPIC]
    const data = opts?.data ?? new TextEncoder().encode(`push-test-${n}`)
    const channel = opts?.channel

    const signer = getStatementSigner(signerPublicKey, 'sr25519', sign)

    const payload: SdkStatement = {
      topics: [...topics],
      expiry: defaultStatementExpiry,
      ...(channel === null ? {} : channel === undefined ? {} : { channel }),
      data,
    }

    const raw = yield* Effect.tryPromise({
      try: () => signer.sign(payload),
      catch: (cause) => cause as Error,
    }).pipe(Effect.orDie)

    const statementHash = toHex(Blake2256(statementCodec.enc(raw)))
    return { raw, statementHash }
  })

export const submitSignedStatement = (
  opts?: SubmitSignedStatementOpts,
): Effect.Effect<{ readonly statementHash: string; readonly raw: SdkStatement }, never, StatementStoreService> =>
  Effect.gen(function*() {
    const store = yield* StatementStoreService
    const { raw, statementHash } = yield* buildSignedRaw(aliceSignerPubkey, (payload) => aliceKey.sign(payload), opts)
    const submitted = yield* store.submit(raw)
    expect(submitted.status).toBe('new')
    yield* handoffAfterStoreSubmit
    return { statementHash, raw }
  }).pipe(Effect.orDie)

export const submitSignedStatementFromOtherSender = (
  opts?: SubmitSignedStatementOpts,
): Effect.Effect<{ readonly statementHash: string; readonly raw: SdkStatement }, never, StatementStoreService> =>
  Effect.gen(function*() {
    const store = yield* StatementStoreService
    const { raw, statementHash } = yield* buildSignedRaw(bobSignerPubkey, (payload) => bobKey.sign(payload), opts)
    const submitted = yield* store.submit(raw)
    expect(submitted.status).toBe('new')
    yield* handoffAfterStoreSubmit
    return { statementHash, raw }
  }).pipe(Effect.orDie)

export const submitRawStatement = (
  raw: SdkStatement,
): Effect.Effect<void, never, StatementStoreService> =>
  Effect.gen(function*() {
    const store = yield* StatementStoreService
    const submitted = yield* store.submit(raw)
    expect(submitted.status).toBe('new')
    yield* handoffAfterStoreSubmit
  }).pipe(Effect.orDie)

export const insertSubscription = (
  db: DB['Type'],
  overrides: Partial<typeof schema.pushSubscription.$inferInsert>,
) =>
  Effect.tryPromise(() =>
    db.insert(schema.pushSubscription).values({
      clientId: CLIENT_ID,
      notificationType: 'apns',
      token: 'test-apns-token',
      createdAt: new Date('2025-01-01T00:00:00Z'),
      updatedAt: new Date('2025-01-01T00:00:00Z'),
      ...overrides,
    }).returning()
  )

export const insertRule = (
  db: DB['Type'],
  overrides: Partial<typeof schema.subscriptionRule.$inferInsert> & { subscriptionId: string },
) =>
  Effect.tryPromise(() =>
    db.insert(schema.subscriptionRule).values({
      senderPubkey: SENDER_PUBKEY,
      topic: TOPIC,
      createdAt: new Date('2025-01-01T00:00:00Z'),
      ...overrides,
    }).returning()
  )

export const insertRateLimit = (
  db: DB['Type'],
  opts: {
    senderPubkey: string
    clientId: string
    windowStart: Date
    notificationCount: number
  },
) =>
  Effect.tryPromise(() =>
    db.insert(schema.rateLimit).values({
      senderPubkey: opts.senderPubkey,
      clientId: opts.clientId,
      windowStart: opts.windowStart,
      notificationCount: opts.notificationCount,
    }).returning()
  )

export const readPushRecords = (db: DB['Type'], subscriptionId: string) =>
  Effect.tryPromise(() =>
    db.select().from(schema.pushRecord)
      .where(eq(schema.pushRecord.subscriptionId, subscriptionId))
  )

export const readFailedPushRecords = (db: DB['Type'], subscriptionId: string) =>
  Effect.tryPromise(() =>
    db.select().from(schema.failedPushRecord)
      .where(eq(schema.failedPushRecord.subscriptionId, subscriptionId))
  )

export const readSubscriptionById = (db: DB['Type'], subscriptionId: string) =>
  Effect.tryPromise(() =>
    db.select().from(schema.pushSubscription)
      .where(eq(schema.pushSubscription.id, subscriptionId))
      .limit(1)
  )

export const readRateLimits = (
  db: DB['Type'],
  opts: {
    senderPubkey: string
    clientId: string
  },
) =>
  Effect.tryPromise(() =>
    db.select().from(schema.rateLimit)
      .where(
        and(
          eq(schema.rateLimit.senderPubkey, opts.senderPubkey),
          eq(schema.rateLimit.clientId, opts.clientId),
        ),
      )
  )

export const cleanUp = Effect.andThen(DB, (db) =>
  Effect.tryPromise(() =>
    db.transaction(async (tx) => {
      await tx.delete(schema.rateLimit).execute()
      await tx.delete(schema.failedPushRecord).execute()
      await tx.delete(schema.pushRecord).execute()
      await tx.delete(schema.subscriptionRule).execute()
      await tx.delete(schema.pushSubscription).execute()
    })
  )).pipe(Effect.orDie)
