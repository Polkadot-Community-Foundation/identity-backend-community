import { DB } from '#root/db/drizzle.js'
import * as schema from '#root/db/schema.js'
import { ProblemDetailZod } from '#root/lib/problem-details.js'
import { z } from '@hono/zod-openapi'
import { And, Given, Then, When } from '@identity-backend/effect-vitest-gherkin'
import { eq, or } from 'drizzle-orm'
import { Effect } from 'effect'
import { Jwt } from 'hono/utils/jwt'
import { expect } from 'vitest'

import {
  aPriorDeviceOwner,
  type Claimant,
  Claimants,
  type DeviceToken,
  encodeDeviceToken,
  MALFORMED_DEVICE_TOKEN_HEADER,
} from './fixtures/claim-mother.js'
import {
  cleanUpRegistrationQueue,
  makeRegistrationQueueClient,
  type RegistrationQueueApp,
} from './fixtures/registration-queue-client.js'
import { feature, scenarioLayer, sharedFileLayer } from './layers.js'

const TEST_JWT_SECRET = 'identity-backend-test-jwt-secret'
const ANDROID_DEVICE_TOKEN_HEADER = 'Device-Token-Android'

const signClaimJwt = (sub: string, appFromOfficialStore: boolean | undefined): Promise<string> =>
  appFromOfficialStore === undefined
    ? Jwt.sign({ sub }, TEST_JWT_SECRET, 'HS256')
    : Jwt.sign({ sub, appFromOfficialStore }, TEST_JWT_SECRET, 'HS256')

const postClaim = (
  app: RegistrationQueueApp,
  claimant: Claimant,
  opts: {
    readonly appFromOfficialStore?: boolean
    readonly withVoucher?: boolean
    readonly withDevice?: boolean
    readonly rawDeviceTokenHeader?: string
  } = {},
) =>
  Effect.promise(async () => {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      authorization: `Bearer ${await signClaimJwt(claimant.account, opts.appFromOfficialStore)}`,
    }
    if (opts.rawDeviceTokenHeader !== undefined) {
      headers[ANDROID_DEVICE_TOKEN_HEADER] = opts.rawDeviceTokenHeader
    } else if (opts.withDevice === true) {
      headers[ANDROID_DEVICE_TOKEN_HEADER] = encodeDeviceToken(claimant.deviceToken)
    }
    const body = opts.withVoucher === true
      ? { username: claimant.username, lifetimePoUDVoucher: claimant.voucherKey }
      : { username: claimant.username }
    return app.request('/registration', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
  })

const seedVoucher = (key: string, used: boolean) =>
  Effect.andThen(DB, (db) =>
    Effect.promise(() =>
      db.insert(schema.lifetimePoudVouchers)
        .values({ key, used, usedAt: used ? new Date() : null })
        .execute()
    )).pipe(Effect.orDie)

const seedDeviceIdentifiers = (token: DeviceToken, account: string) =>
  Effect.andThen(DB, (db) =>
    Effect.promise(() =>
      db.insert(schema.androidDeviceIdentifiers)
        .values({ androidId: token.androidId, widevineId: token.widevineId, accountId: account })
        .execute()
    )).pipe(Effect.orDie)

const countDeviceIdentifiers = (token: DeviceToken) =>
  Effect.andThen(DB, (db) =>
    Effect.promise(() =>
      db.select({ id: schema.androidDeviceIdentifiers.id })
        .from(schema.androidDeviceIdentifiers)
        .where(
          or(
            eq(schema.androidDeviceIdentifiers.androidId, token.androidId),
            eq(schema.androidDeviceIdentifiers.widevineId, token.widevineId),
          ),
        )
        .execute()
    )).pipe(Effect.orDie, Effect.map((rows) => rows.length))

const voucherUsed = (key: string) =>
  Effect.andThen(DB, (db) =>
    Effect.promise(() =>
      db.select({ used: schema.lifetimePoudVouchers.used })
        .from(schema.lifetimePoudVouchers)
        .where(eq(schema.lifetimePoudVouchers.key, key))
        .execute()
    )).pipe(Effect.orDie, Effect.map((rows) => rows[0]?.used ?? false))

const cleanUpClaimState = Effect.andThen(DB, (db) =>
  Effect.promise(async () => {
    await db.delete(schema.androidDeviceIdentifiers).execute()
    await db.delete(schema.lifetimePoudVouchers).execute()
  })).pipe(Effect.orDie)

const InstantOutcome = z.object({ registrationOutcome: z.literal('INSTANT') })
const QueuedOutcome = z.object({ registrationOutcome: z.literal('QUEUED'), queuePosition: z.number() })
const PaymentRequiredOutcome = z.object({
  registrationOutcome: z.literal('PAYMENT_REQUIRED'),
  paymentAddress: z.string(),
  amountRequired: z.string(),
})

const expectProblemDetail = (claimRes: Response) =>
  Effect.gen(function*() {
    expect(claimRes.status).toBe(400)
    expect(claimRes.headers.get('content-type')).toContain('application/problem+json')
    const json = yield* Effect.promise(() => claimRes.json())
    expect(json).toEqual(expect.schemaMatching(ProblemDetailZod))
  })

feature('Claim username — §4 registration outcomes')
  .withLayer(sharedFileLayer)
  .withScenarioLayer(scenarioLayer)
  .withScope({})
  .body(({ scenario, background, scope }) => {
    background(
      Effect.gen(function*() {
        yield* cleanUpRegistrationQueue
        yield* cleanUpClaimState
      }),
    )

    scenario(
      'Alice redeems a valid unused voucher and claims instantly',
      scope.pipe(
        Given('Alice holds a valid, unused lifetime voucher')(() => seedVoucher(Claimants.alice.voucherKey, false)),
        When('Alice claims a username with that voucher')(
          'claimRes',
          () =>
            Effect.gen(function*() {
              const client = yield* makeRegistrationQueueClient()
              return yield* postClaim(client, Claimants.alice, { appFromOfficialStore: true, withVoucher: true })
            }),
        ),
        Then('the claim resolves instantly')(({ claimRes }) =>
          Effect.gen(function*() {
            expect(claimRes.status).toBe(200)
            const json = yield* Effect.promise(() => claimRes.json())
            expect(json).toEqual(expect.schemaMatching(InstantOutcome))
          })
        ),
        And('the voucher is marked used')(() =>
          Effect.gen(function*() {
            expect(yield* voucherUsed(Claimants.alice.voucherKey)).toBe(true)
          })
        ),
      ),
    )

    scenario(
      'Bella is rejected when her voucher has already been redeemed',
      scope.pipe(
        Given('Bella presents a voucher that was already redeemed')(() =>
          seedVoucher(Claimants.bella.voucherKey, true)
        ),
        When('Bella tries to claim a username with the spent voucher')(
          'claimRes',
          () =>
            Effect.gen(function*() {
              const client = yield* makeRegistrationQueueClient()
              return yield* postClaim(client, Claimants.bella, { appFromOfficialStore: true, withVoucher: true })
            }),
        ),
        Then('the claim fails as a bad request with a Problem Detail body')(({ claimRes }) =>
          expectProblemDetail(claimRes)
        ),
      ),
    )

    scenario(
      'Gwen is rejected when she presents a voucher key that does not exist',
      scope.pipe(
        Given('Gwen has a voucher key that was never issued')(() => Effect.void),
        When('Gwen tries to claim a username with the unknown voucher')(
          'claimRes',
          () =>
            Effect.gen(function*() {
              const client = yield* makeRegistrationQueueClient()
              return yield* postClaim(client, Claimants.gwen, { appFromOfficialStore: true, withVoucher: true })
            }),
        ),
        Then('the claim fails as a bad request with a Problem Detail body')(({ claimRes }) =>
          expectProblemDetail(claimRes)
        ),
      ),
    )

    scenario(
      'Hank is rejected when his Device-Token-Android header is malformed',
      scope.pipe(
        Given('Hank presents a malformed device token header')(() => Effect.void),
        When('Hank tries to claim a username with the malformed token')(
          'claimRes',
          () =>
            Effect.gen(function*() {
              const client = yield* makeRegistrationQueueClient()
              return yield* postClaim(client, Claimants.hank, {
                appFromOfficialStore: true,
                rawDeviceTokenHeader: MALFORMED_DEVICE_TOKEN_HEADER,
              })
            }),
        ),
        Then('the claim fails as a bad request with a Problem Detail body')(({ claimRes }) =>
          expectProblemDetail(claimRes)
        ),
      ),
    )

    scenario(
      'Cara must pay because her app is not from an official store',
      scope.pipe(
        Given('Cara has no voucher and her app is not from an official store')(() => Effect.void),
        When('Cara tries to claim a username')(
          'claimRes',
          () =>
            Effect.gen(function*() {
              const client = yield* makeRegistrationQueueClient()
              return yield* postClaim(client, Claimants.cara, { appFromOfficialStore: false, withDevice: true })
            }),
        ),
        Then('the claim resolves as payment required')(({ claimRes }) =>
          Effect.gen(function*() {
            expect(claimRes.status).toBe(200)
            const json = yield* Effect.promise(() => claimRes.json())
            expect(json).toEqual(expect.schemaMatching(PaymentRequiredOutcome))
          })
        ),
      ),
    )

    scenario(
      'Dora must pay because her device has already been seen',
      scope.pipe(
        Given('Dora’s device fingerprint already exists in the identifiers table')(() =>
          seedDeviceIdentifiers(Claimants.dora.deviceToken, aPriorDeviceOwner)
        ),
        When('Dora claims with an official-store app and her known device')(
          'claimRes',
          () =>
            Effect.gen(function*() {
              const client = yield* makeRegistrationQueueClient()
              return yield* postClaim(client, Claimants.dora, { appFromOfficialStore: true, withDevice: true })
            }),
        ),
        Then('the claim resolves as payment required')(({ claimRes }) =>
          Effect.gen(function*() {
            expect(claimRes.status).toBe(200)
            const json = yield* Effect.promise(() => claimRes.json())
            expect(json).toEqual(expect.schemaMatching(PaymentRequiredOutcome))
          })
        ),
      ),
    )

    scenario(
      'Erin is queued when her device passes the proof-of-unique-device check',
      scope.pipe(
        Given('Erin has an official-store app and a device never seen before')(() => Effect.void),
        When('Erin claims a username with her fresh device')(
          'claimRes',
          () =>
            Effect.gen(function*() {
              const client = yield* makeRegistrationQueueClient()
              return yield* postClaim(client, Claimants.erin, { appFromOfficialStore: true, withDevice: true })
            }),
        ),
        Then('the claim is queued')(({ claimRes }) =>
          Effect.gen(function*() {
            expect(claimRes.status).toBe(200)
            const json = yield* Effect.promise(() => claimRes.json())
            expect(json).toEqual(expect.schemaMatching(QueuedOutcome))
          })
        ),
        And('her device fingerprint is stored')(() =>
          Effect.gen(function*() {
            expect(yield* countDeviceIdentifiers(Claimants.erin.deviceToken)).toBe(1)
          })
        ),
      ),
    )

    scenario(
      'Faye is rejected when she provides neither a voucher nor a device token',
      scope.pipe(
        Given('Faye has an official-store app but supplies no voucher and no device token')(() => Effect.void),
        When('Faye tries to claim a username')(
          'claimRes',
          () =>
            Effect.gen(function*() {
              const client = yield* makeRegistrationQueueClient()
              return yield* postClaim(client, Claimants.faye, { appFromOfficialStore: true })
            }),
        ),
        Then('the claim fails as a bad request with a Problem Detail body')(({ claimRes }) =>
          expectProblemDetail(claimRes)
        ),
      ),
    )
  })
