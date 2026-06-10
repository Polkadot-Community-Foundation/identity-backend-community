import { DB } from '#root/db/drizzle.js'
import {
  MAX_NOTIFICATIONS_PER_WINDOW,
  RATE_LIMIT_COOLDOWN_MS,
  RATE_LIMIT_WINDOW_MS,
} from '#root/features/subscriptions/pipeline/rate-limit.js'
import { Topic } from '#root/features/subscriptions/types.js'
import { And, Given, Then, When } from '@identity-backend/effect-vitest-gherkin'
import {
  PushNotificationServiceError,
  PushNotificationTokenInvalidError,
  PushNotificationValidationError,
  StatementApnsPayloadWire,
  StatementFcmPayloadWire,
  StatementPushRequest,
} from '@identity-backend/mobile-push-notifications'
import { StatementStoreService } from '@identity-backend/statement-store/fake'
import { Duration, Effect, Match, Schema, TestClock } from 'effect'
import { toHex } from 'polkadot-api/utils'
import { ANOTHER_RECEIVER_CLIENT_ID, OTHER_SENDER, TOPIC_2 } from './fixtures.js'
import {
  insertRateLimit,
  insertRule,
  insertSubscription,
  makeApnFailure,
  OTHER_SENDER_PUBKEY,
  readFailedPushRecords,
  readPushRecords,
  readRateLimits,
  readSubscriptionById,
  RECEIVER_CLIENT_ID,
  SENDER_PUBKEY,
  settleDaemon,
  submitRawStatement,
  submitSignedStatement,
  submitSignedStatementFromOtherSender,
  TOPIC,
} from './helpers/subscription-test-layer.js'
import { cleanUp } from './helpers/subscription-test-layer.js'
import { apnSend, fcmSend, feature, scenarioLayer, sharedFileLayer } from './layers.js'

const channelTestCases = [
  {
    desc: 'iOS APNs alert',
    sub: { clientId: SENDER_PUBKEY },
    rule: {},
    assert: {
      channel: 'apns',
      notifyType: 'apns',
      apnCallCount: 1,
      fcmCallCount: 0,
    },
  },
  {
    desc: 'Android FCM',
    sub: {
      clientId: SENDER_PUBKEY,
      notificationType: 'fcm' as const,
      token: 'test-fcm-token',
    },
    rule: {},
    assert: {
      channel: 'fcm',
      notifyType: 'fcm',
      apnCallCount: 0,
      fcmCallCount: 1,
    },
  },
  {
    desc: 'iOS VoIP APNs',
    sub: {
      clientId: SENDER_PUBKEY,
      notificationType: 'voip' as const,
      token: 'test-voip-token',
    },
    rule: {},
    assert: {
      channel: 'voip_apns',
      notifyType: 'voip',
      apnCallCount: 1,
      fcmCallCount: 0,
    },
  },
]

const wireSnapshotStatementData = new TextEncoder().encode('wire-snapshot')
const wireSnapshotStatementDataHex = toHex(wireSnapshotStatementData)
const encodeApnsWire = Schema.encodeSync(StatementApnsPayloadWire)
const encodeFcmWire = Schema.encodeSync(StatementFcmPayloadWire)

const expectedWirePayloadFromCapturedRequest = {
  apns: {
    statement: {
      data: wireSnapshotStatementDataHex,
      sender_pubkey: SENDER_PUBKEY,
      topic: TOPIC as string,
    },
  },
  fcm: {
    notify_type: 'fcm' as const,
    sender_pubkey: SENDER_PUBKEY,
    statement_data: wireSnapshotStatementDataHex,
    statement_topic: TOPIC as string,
  },
} as const

const notificationShapeCases = [
  {
    desc: 'iOSVoIPAPNs',
    sub: { clientId: SENDER_PUBKEY, notificationType: 'voip' as const, token: 'test-voip-token' },
    expected: { notificationType: 'voip', voip: true },
    provider: 'apn' as const,
  },
  {
    desc: 'iOSAlertAPNs',
    sub: { clientId: SENDER_PUBKEY, notificationType: 'apns' as const, token: 'test-apns-token' },
    expected: { notificationType: 'apns', voip: false },
    provider: 'apn' as const,
  },
  {
    desc: 'AndroidFCM',
    sub: { clientId: SENDER_PUBKEY, notificationType: 'fcm' as const, token: 'test-fcm-token' },
    expected: { notificationType: 'fcm', voip: false },
    provider: 'fcm' as const,
  },
]

const ruleMismatchCases = [
  {
    desc: 'WrongSenderMatchingTopic',
    rule: { senderPubkey: SENDER_PUBKEY, topic: TOPIC as string },
    submit: () => submitSignedStatementFromOtherSender({ topics: [TOPIC] }),
  },
  {
    desc: 'RightSenderWrongTopic',
    rule: { senderPubkey: SENDER_PUBKEY, topic: TOPIC as string },
    submit: () => submitSignedStatement({ topics: [TOPIC_2] }),
  },
  {
    desc: 'NoTopics',
    rule: { senderPubkey: SENDER_PUBKEY, topic: TOPIC as string },
    submit: () => submitSignedStatement({ topics: [] }),
  },
]

const rateLimitBoundaryCases = [
  {
    desc: 'MaxMinusOneAllows',
    initialCount: MAX_NOTIFICATIONS_PER_WINDOW - 1,
    expectedApnCalls: 1,
  },
  {
    desc: 'MaxBlocks',
    initialCount: MAX_NOTIFICATIONS_PER_WINDOW,
    expectedApnCalls: 0,
  },
]

const testClockNowDate = Effect.clockWith((c) => c.currentTimeMillis).pipe(
  Effect.map((millis) => new Date(Number(millis))),
)

feature('Receiving Push Notifications')
  .withLayer(sharedFileLayer)
  .withScenarioLayer(scenarioLayer)
  .withScope({ db: DB, store: StatementStoreService })
  .body(({ scenario, scenarioOutline, background, scope }) => {
    background(
      Effect.gen(function*() {
        yield* cleanUp
        vi.clearAllMocks()
        vi.restoreAllMocks()
      }),
    )

    scenario(
      'Should_Return0_When_NoMatchingSubscriptions',
      scope.pipe(
        Given('no subscriptions exist')(() => Effect.void),
        When('a signed statement is submitted to the store')(() => submitSignedStatement()),
        Then('no provider calls should be made')(() =>
          Effect.gen(function*() {
            yield* settleDaemon
            expect(apnSend, 'APNs should not be called').not.toHaveBeenCalled()
            expect(fcmSend, 'FCM should not be called').not.toHaveBeenCalled()
          })
        ),
      ),
    )

    scenarioOutline(
      'Should_Skip_When_<desc>',
      ruleMismatchCases,
      ({ desc: _desc, rule, submit }) =>
        scope.pipe(
          Given('a subscription exists with one rule')(
            'subscription',
            ({ db }) =>
              Effect.gen(function*() {
                const [subscription] = yield* insertSubscription(db, { clientId: RECEIVER_CLIENT_ID })
                yield* insertRule(db, { subscriptionId: subscription!.id, ...rule })
                return subscription
              }),
          ),
          When('a statement that should not match rules is submitted')(() => submit()),
          Then('no delivery should occur')(
            ({ db, subscription }) =>
              Effect.gen(function*() {
                yield* settleDaemon
                expect(apnSend, 'APNs should not be called').not.toHaveBeenCalled()
                expect(fcmSend, 'FCM should not be called').not.toHaveBeenCalled()
                const records = yield* readPushRecords(db, subscription!.id)
                expect(records, 'No push records expected').toHaveLength(0)
              }),
          ),
        ),
    )

    scenarioOutline(
      'Should_Deliver_When_<desc>',
      channelTestCases,
      ({ desc: _desc, sub, rule, assert }) =>
        scope.pipe(
          Given('a subscription exists')(
            'subscription',
            ({ db }) =>
              Effect.gen(function*() {
                const [subscription] = yield* insertSubscription(db, sub)
                yield* insertRule(db, { subscriptionId: subscription!.id, ...rule })
                return subscription
              }),
          ),
          When('a signed statement is submitted')(() =>
            submitSignedStatement({ data: new TextEncoder().encode('wire-snapshot') })
          ),
          And('provider call count should match')(() =>
            Effect.gen(function*() {
              yield* settleDaemon
              expect(apnSend, 'APNs call count should match').toHaveBeenCalledTimes(assert.apnCallCount)
              expect(fcmSend, 'FCM call count should match').toHaveBeenCalledTimes(assert.fcmCallCount)
            })
          ),
          And('push request should map sender pubkey from statement signer')(
            () =>
              Effect.sync(() => {
                const requests = [
                  ...apnSend.mock.calls.map(([request]) => request),
                  ...fcmSend.mock.calls.map(([request]) => request),
                ]
                expect.soft(requests, 'Exactly one provider request expected').toHaveLength(1)
                expect.soft(requests[0], 'Provider request should use statement signer pubkey').toMatchObject({
                  senderPubkey: SENDER_PUBKEY,
                })
              }),
          ),
          And('push record should have correct channel and notify type')(
            ({ db, subscription }) =>
              Effect.gen(function*() {
                const records = yield* readPushRecords(db, subscription!.id)
                expect(records, 'Should have 1 push record').toHaveLength(1)
                expect.soft(records[0], 'Record should have correct channel and notify type').toMatchObject({
                  deliveryChannel: assert.channel,
                  notifyType: assert.notifyType,
                })
              }),
          ),
          And('rate limit record should count 1')(
            ({ db, subscription }) =>
              Effect.gen(function*() {
                const rates = yield* readRateLimits(db, {
                  senderPubkey: SENDER_PUBKEY,
                  clientId: subscription!.clientId,
                })
                expect(rates, 'Should have 1 rate limit record').toHaveLength(1)
                expect.soft(rates[0], 'Rate should count 1').toMatchObject({ notificationCount: 1 })
              }),
          ),
        ),
    )

    scenario(
      'Should_DeliverWithSenderPubkey_When_ClientIdIsDifferent',
      scope.pipe(
        Given('a subscription clientId differs from statement sender pubkey')(
          'subscription',
          ({ db }) =>
            Effect.gen(function*() {
              const [subscription] = yield* insertSubscription(db, { clientId: RECEIVER_CLIENT_ID })
              yield* insertRule(db, {
                subscriptionId: subscription!.id,
                senderPubkey: SENDER_PUBKEY,
              })
              return subscription
            }),
        ),
        When('a signed statement is submitted')(() => submitSignedStatement()),
        Then('APNs request should carry sender pubkey, not subscription clientId')(
          ({ subscription }) =>
            Effect.gen(function*() {
              yield* settleDaemon
              expect(apnSend.mock.calls, 'Should have 1 APNs call').toHaveLength(1)
              const request = apnSend.mock.calls[0]![0] as StatementPushRequest
              expect(request.senderPubkey).toBe(SENDER_PUBKEY)
              expect(request.senderPubkey).not.toBe(subscription!.clientId)
            }),
        ),
        And('push record should persist sender pubkey')(
          ({ db, subscription }) =>
            Effect.gen(function*() {
              const records = yield* readPushRecords(db, subscription!.id)
              expect(records, 'Should have 1 push record').toHaveLength(1)
              expect(records[0]?.senderPubkey).toBe(SENDER_PUBKEY)
            }),
        ),
        And('rate limit should be keyed by sender and receiver identities')(
          ({ db }) =>
            Effect.gen(function*() {
              const rates = yield* readRateLimits(db, {
                senderPubkey: SENDER_PUBKEY,
                clientId: RECEIVER_CLIENT_ID,
              })
              expect(rates, 'Should have 1 rate limit record').toHaveLength(1)
            }),
        ),
      ),
    )

    scenario(
      'Should_DeliverToAllReceivers_When_SameSenderTopicMatchesMultipleClients',
      scope.pipe(
        Given('two receiver subscriptions exist for distinct clients')(
          'subscriptions',
          ({ db }) =>
            Effect.gen(function*() {
              const [subA] = yield* insertSubscription(db, {
                clientId: RECEIVER_CLIENT_ID,
                notificationType: 'apns',
                token: 'receiver-a-apns',
              })
              const [subB] = yield* insertSubscription(db, {
                clientId: ANOTHER_RECEIVER_CLIENT_ID,
                notificationType: 'apns',
                token: 'receiver-b-apns',
              })
              yield* insertRule(db, { subscriptionId: subA!.id, senderPubkey: SENDER_PUBKEY, topic: TOPIC as string })
              yield* insertRule(db, { subscriptionId: subB!.id, senderPubkey: SENDER_PUBKEY, topic: TOPIC as string })
              return { subA, subB }
            }),
        ),
        When('a signed statement is submitted')(() => submitSignedStatement({ topics: [TOPIC] })),
        Then('both receivers should get independent deliveries and rate rows')(
          ({ db, subscriptions }) =>
            Effect.gen(function*() {
              yield* settleDaemon
              expect(apnSend, 'APNs should be called for each receiver').toHaveBeenCalledTimes(2)
              const recordsA = yield* readPushRecords(db, subscriptions.subA!.id)
              const recordsB = yield* readPushRecords(db, subscriptions.subB!.id)
              expect(recordsA, 'Receiver A should have one push record').toHaveLength(1)
              expect(recordsB, 'Receiver B should have one push record').toHaveLength(1)
              const rateA = yield* readRateLimits(db, {
                senderPubkey: SENDER_PUBKEY,
                clientId: RECEIVER_CLIENT_ID,
              })
              const rateB = yield* readRateLimits(db, {
                senderPubkey: SENDER_PUBKEY,
                clientId: ANOTHER_RECEIVER_CLIENT_ID,
              })
              expect(rateA, 'Receiver A should have rate-limit row').toHaveLength(1)
              expect(rateB, 'Receiver B should have rate-limit row').toHaveLength(1)
            }),
        ),
      ),
    )

    scenarioOutline(
      'Should_ShapeRequest_When_<desc>',
      notificationShapeCases,
      ({ desc: _desc, sub, expected, provider }) =>
        scope.pipe(
          Given('a subscription exists')(
            'subscription',
            ({ db }) =>
              Effect.gen(function*() {
                const [subscription] = yield* insertSubscription(db, sub)
                yield* insertRule(db, { subscriptionId: subscription!.id })
                return subscription
              }),
          ),
          When('a signed statement is submitted')(() => submitSignedStatement()),
          Then('request payload should have expected notificationType and voip flag')(() =>
            Effect.gen(function*() {
              yield* settleDaemon

              const providerSelection = Match.value(provider).pipe(
                Match.when('apn', () => ({
                  expectedApnCalls: 1,
                  expectedFcmCalls: 0,
                  request: apnSend.mock.calls[0]?.[0],
                })),
                Match.when('fcm', () => ({
                  expectedApnCalls: 0,
                  expectedFcmCalls: 1,
                  request: fcmSend.mock.calls[0]?.[0],
                })),
                Match.exhaustive,
              )

              expect.soft(apnSend.mock.calls, 'APNs call count should match provider').toHaveLength(
                providerSelection.expectedApnCalls,
              )
              expect.soft(fcmSend.mock.calls, 'FCM call count should match provider').toHaveLength(
                providerSelection.expectedFcmCalls,
              )
              expect.soft(providerSelection.request, 'Expected provider request payload').toBeDefined()

              const request = providerSelection.request as StatementPushRequest

              expect.soft(request, 'Request should match StatementPushRequest schema').toEqual(
                expect.schemaMatching(Schema.standardSchemaV1(StatementPushRequest)),
              )
              expect.soft(request, 'Request payload should match expected provider shape').toMatchObject(expected)
            })
          ),
        ),
    )

    scenarioOutline(
      'Should_EncodeStatementPushWire_When_<desc>',
      notificationShapeCases,
      ({ desc: _desc, sub, provider }) =>
        scope.pipe(
          Given('a subscription exists')(
            'subscription',
            ({ db }) =>
              Effect.gen(function*() {
                const [subscription] = yield* insertSubscription(db, sub)
                yield* insertRule(db, { subscriptionId: subscription!.id })
                return subscription
              }),
          ),
          When('a signed statement is submitted')(() => submitSignedStatement({ data: wireSnapshotStatementData })),
          Then('captured request should match published statement-push wire payload')(() =>
            Effect.gen(function*() {
              yield* settleDaemon

              const providerSelection = Match.value(provider).pipe(
                Match.when('apn', () => ({
                  expectedApnCalls: 1,
                  expectedFcmCalls: 0,
                  request: apnSend.mock.calls[0]?.[0],
                })),
                Match.when('fcm', () => ({
                  expectedApnCalls: 0,
                  expectedFcmCalls: 1,
                  request: fcmSend.mock.calls[0]?.[0],
                })),
                Match.exhaustive,
              )

              expect.soft(apnSend.mock.calls, 'APNs call count should match provider').toHaveLength(
                providerSelection.expectedApnCalls,
              )
              expect.soft(fcmSend.mock.calls, 'FCM call count should match provider').toHaveLength(
                providerSelection.expectedFcmCalls,
              )
              expect.soft(providerSelection.request, 'Expected provider request payload').toBeDefined()

              const request = providerSelection.request as StatementPushRequest

              const wire = Match.value(provider).pipe(
                Match.when('apn', () =>
                  encodeApnsWire({
                    statement: {
                      data: request.message,
                      topic: request.topic,
                      senderPubkey: request.senderPubkey,
                    },
                  })),
                Match.when('fcm', () =>
                  encodeFcmWire({
                    statementData: request.message ?? '',
                    statementTopic: request.topic,
                    senderPubkey: request.senderPubkey,
                    notifyType: request.notificationType ?? 'fcm',
                  })),
                Match.exhaustive,
              )

              const expectedWire = Match.value(provider).pipe(
                Match.when('apn', () => expectedWirePayloadFromCapturedRequest.apns),
                Match.when('fcm', () => expectedWirePayloadFromCapturedRequest.fcm),
                Match.exhaustive,
              )

              expect.soft(wire, 'Encoded wire payload should match expected provider wire shape').toEqual(expectedWire)
            })
          ),
        ),
    )

    scenario(
      'Should_RecordFailure_When_PushDeliveryFails',
      scope.pipe(
        Given('a subscription with a failing APNs mock')(
          'subscription',
          ({ db }) =>
            Effect.gen(function*() {
              apnSend.mockImplementationOnce(() => makeApnFailure('APN connection failed'))
              const [sub] = yield* insertSubscription(db, { clientId: SENDER_PUBKEY })
              yield* insertRule(db, { subscriptionId: sub!.id })
              return sub
            }),
        ),
        When('a signed statement is submitted')(() => submitSignedStatement()),
        And('should have 1 failed record')(
          ({ db, subscription }) =>
            Effect.gen(function*() {
              yield* settleDaemon
              const failed = yield* readFailedPushRecords(db, subscription!.id)
              expect.soft(failed, 'Should have 1 failed record').toHaveLength(1)
              expect.soft(failed[0], 'Failed record should be retryable').toMatchObject({
                deliveryChannel: 'apns',
                retryable: true,
              })
            }),
        ),
        And('should have 0 success records')(
          ({ db, subscription }) =>
            Effect.gen(function*() {
              const success = yield* readPushRecords(db, subscription!.id)
              expect.soft(success, 'Should have 0 success records').toHaveLength(0)
            }),
        ),
      ),
    )

    scenario(
      'Should_RecordNonRetryableFailure_When_ApnValidationFails',
      scope.pipe(
        Given('a subscription with APNs validation failure')(
          'subscription',
          ({ db }) =>
            Effect.gen(function*() {
              apnSend.mockImplementationOnce(() =>
                Effect.fail(PushNotificationValidationError.make({ message: 'invalid_device_token' }))
              )
              const [sub] = yield* insertSubscription(db, { clientId: SENDER_PUBKEY })
              yield* insertRule(db, { subscriptionId: sub!.id })
              return sub
            }),
        ),
        When('a signed statement is submitted')(() => submitSignedStatement()),
        Then('failed record should be marked non-retryable')(
          ({ db, subscription }) =>
            Effect.gen(function*() {
              yield* settleDaemon
              const failed = yield* readFailedPushRecords(db, subscription!.id)
              expect(failed, 'Should have one failed record').toHaveLength(1)
              expect(failed[0], 'Validation failures should be non-retryable').toMatchObject({
                deliveryChannel: 'apns',
                retryable: false,
              })
            }),
        ),
      ),
    )

    scenario(
      'Should_SkipDuplicate_When_SameStatementProcessedTwice',
      scope.pipe(
        Given('a subscription exists')(
          'subscription',
          ({ db }) =>
            Effect.gen(function*() {
              const [sub] = yield* insertSubscription(db, { clientId: SENDER_PUBKEY })
              yield* insertRule(db, { subscriptionId: sub!.id })
              return sub
            }),
        ),
        When('a signed statement is submitted once')(
          'first',
          () => submitSignedStatement(),
        ),
        Then('APNs should be called once')(() =>
          Effect.gen(function*() {
            yield* settleDaemon
            expect.soft(apnSend, 'APNs should be called once').toHaveBeenCalledOnce()
          })
        ),
        When('clearing mocks')(() => {
          vi.clearAllMocks()
        }),
        When('the same signed statement is submitted again')(
          ({ first }) => submitRawStatement(first.raw),
        ),
        And('APNs should not be called again')(() =>
          Effect.gen(function*() {
            yield* settleDaemon
            expect(apnSend, 'APNs should not be called again').not.toHaveBeenCalled()
          })
        ),
        And('exactly one push record exists')(
          ({ db, subscription }) =>
            Effect.gen(function*() {
              const records = yield* readPushRecords(db, subscription!.id)
              expect(records, 'Should have 1 push record total').toHaveLength(1)
            }),
        ),
      ),
    )

    scenario(
      'Should_IncrementRateCount_When_MultipleStatementsDelivered',
      scope.pipe(
        Given('a subscription exists')(
          'subscription',
          ({ db }) =>
            Effect.gen(function*() {
              const [sub] = yield* insertSubscription(db, { clientId: SENDER_PUBKEY })
              yield* insertRule(db, { subscriptionId: sub!.id })
              return sub
            }),
        ),
        When('two distinct signed statements are submitted')(() =>
          Effect.gen(function*() {
            yield* submitSignedStatement({ data: new TextEncoder().encode('msg 1') })
            yield* submitSignedStatement({ data: new TextEncoder().encode('msg 2') })
            yield* settleDaemon
          })
        ),
        Then('rate limit count should be 2')(
          ({ db, subscription }) =>
            Effect.gen(function*() {
              const rates = yield* readRateLimits(db, {
                senderPubkey: SENDER_PUBKEY,
                clientId: subscription!.clientId,
              })
              expect.soft(rates, 'Should have 1 rate limit record').toHaveLength(1)
              expect.soft(rates[0], 'Count should be 2').toMatchObject({ notificationCount: 2 })
            }),
        ),
      ),
    )

    scenario(
      'Should_SkipDelivery_When_RateLimitExceeded',
      scope.pipe(
        Given('a subscription exists')(
          'subscription',
          ({ db }) =>
            Effect.gen(function*() {
              const [sub] = yield* insertSubscription(db, { clientId: SENDER_PUBKEY })
              yield* insertRule(db, { subscriptionId: sub!.id })
              return sub
            }),
        ),
        And('rate limit is at maximum')(
          ({ db, subscription }) =>
            Effect.gen(function*() {
              const windowStart = yield* testClockNowDate
              yield* insertRateLimit(db, {
                senderPubkey: SENDER_PUBKEY,
                clientId: subscription!.clientId,
                windowStart,
                notificationCount: MAX_NOTIFICATIONS_PER_WINDOW,
              })
            }),
        ),
        When('a signed statement is submitted')(() => submitSignedStatement()),
        And('APNs should not be called when rate limited')(() =>
          Effect.gen(function*() {
            yield* settleDaemon
            expect(apnSend, 'APNs should not be called when rate limited').not.toHaveBeenCalled()
          })
        ),
        And('should have 0 push records when rate limited')(
          ({ db, subscription }) =>
            Effect.gen(function*() {
              const records = yield* readPushRecords(db, subscription!.id)
              expect.soft(records, 'Should have 0 push records when rate limited').toHaveLength(0)
            }),
        ),
      ),
    )

    scenario(
      'Should_NotInsertPushRecord_When_RateLimitedAndNewStatement',
      scope.pipe(
        Given('a subscription exists')(
          'subscription',
          ({ db }) =>
            Effect.gen(function*() {
              const [sub] = yield* insertSubscription(db, { clientId: SENDER_PUBKEY })
              yield* insertRule(db, { subscriptionId: sub!.id })
              return sub
            }),
        ),
        And('rate limit is at maximum')(
          ({ db, subscription }) =>
            Effect.gen(function*() {
              const windowStart = yield* testClockNowDate
              yield* insertRateLimit(db, {
                senderPubkey: SENDER_PUBKEY,
                clientId: subscription!.clientId,
                windowStart,
                notificationCount: MAX_NOTIFICATIONS_PER_WINDOW,
              })
            }),
        ),
        When('a never-seen signed statement is submitted')(() => submitSignedStatement()),
        And('should have 0 push records, proving rate limit blocked before dedup insert')(
          ({ db, subscription }) =>
            Effect.gen(function*() {
              yield* settleDaemon
              const records = yield* readPushRecords(db, subscription!.id)
              expect.soft(records, 'Should have 0 push records').toHaveLength(0)
            }),
        ),
      ),
    )

    scenario(
      'Multiple rules for the same subscription produce one delivery',
      scope.pipe(
        Given('Alice has an APNs subscription with rules for DMs and calls')(
          'subscription',
          ({ db }) =>
            Effect.gen(function*() {
              const [sub] = yield* insertSubscription(db, { clientId: SENDER_PUBKEY })
              yield* insertRule(db, { subscriptionId: sub!.id, topic: TOPIC as string })
              yield* insertRule(db, { subscriptionId: sub!.id, topic: TOPIC_2 as string })
              return sub
            }),
        ),
        When('Bob sends a statement matching both rules')(() => submitSignedStatement({ topics: [TOPIC, TOPIC_2] })),
        Then('one push notification should be delivered')(() =>
          Effect.gen(function*() {
            yield* settleDaemon
            expect(apnSend, 'Should send one push per subscription').toHaveBeenCalledOnce()
          })
        ),
        And('one delivery should be recorded')(
          ({ db, subscription }) =>
            Effect.gen(function*() {
              const records = yield* readPushRecords(db, subscription!.id)
              expect(records, 'Should have 1 delivery record').toHaveLength(1)
            }),
        ),
      ),
    )

    scenario(
      'Mixed rule counts across multiple subscriptions each produce one delivery',
      scope.pipe(
        Given('Alice has APNs and VoIP subscriptions, with two alert rules and one call rule')(
          'subscriptions',
          ({ db }) =>
            Effect.gen(function*() {
              const [subApns] = yield* insertSubscription(db, {
                clientId: SENDER_PUBKEY,
                notificationType: 'apns',
                token: 'test-apns-token',
              })
              yield* insertRule(db, { subscriptionId: subApns!.id, topic: TOPIC as string })
              yield* insertRule(db, { subscriptionId: subApns!.id, topic: TOPIC_2 as string })

              const [subVoip] = yield* insertSubscription(db, {
                clientId: SENDER_PUBKEY,
                notificationType: 'voip',
                token: 'test-voip-token',
              })
              yield* insertRule(db, { subscriptionId: subVoip!.id })

              return { subApns, subVoip }
            }),
        ),
        When('Bob sends a statement matching all rules')(() => submitSignedStatement({ topics: [TOPIC, TOPIC_2] })),
        Then('two push notifications should be delivered, one per subscription')(() =>
          Effect.gen(function*() {
            yield* settleDaemon
            expect(apnSend, 'Should send one push per subscription').toHaveBeenCalledTimes(2)
          })
        ),
        And('one delivery should be recorded per subscriber')(
          ({ db, subscriptions }) =>
            Effect.gen(function*() {
              const recordsApns = yield* readPushRecords(db, subscriptions.subApns!.id)
              const recordsVoip = yield* readPushRecords(db, subscriptions.subVoip!.id)
              expect.soft(recordsApns, 'APNs sub should have 1 record despite 2 matching rules').toHaveLength(1)
              expect.soft(recordsVoip, 'VoIP sub should have 1 record').toHaveLength(1)
            }),
        ),
      ),
    )

    scenario(
      'Should_RateLimitIndependently_When_MultipleSubscriptions',
      scope.pipe(
        Given('two subscriptions for different senders')(
          'subscriptions',
          ({ db }) =>
            Effect.gen(function*() {
              const [sub1] = yield* insertSubscription(db, { clientId: SENDER_PUBKEY })
              yield* insertRule(db, { subscriptionId: sub1!.id })

              const [sub2] = yield* insertSubscription(db, {
                clientId: OTHER_SENDER,
                notificationType: 'fcm',
                token: 'other-fcm-token',
              })
              yield* insertRule(db, { subscriptionId: sub2!.id, senderPubkey: SENDER_PUBKEY })

              return { sub1, sub2 }
            }),
        ),
        When('a signed statement is submitted')(() => submitSignedStatement()),
        And('both subscriptions should have rate count of 1')(
          ({ db, subscriptions }) =>
            Effect.gen(function*() {
              yield* settleDaemon
              const rates1 = yield* readRateLimits(db, {
                senderPubkey: SENDER_PUBKEY,
                clientId: subscriptions.sub1!.clientId,
              })
              const rates2 = yield* readRateLimits(db, {
                senderPubkey: SENDER_PUBKEY,
                clientId: subscriptions.sub2!.clientId,
              })
              expect.soft(rates1, 'sub1 should have 1 rate record').toHaveLength(1)
              expect.soft(rates2, 'sub2 should have 1 rate record').toHaveLength(1)
              expect.soft(rates1[0], 'sub1 count should be 1').toMatchObject({ notificationCount: 1 })
              expect.soft(rates2[0], 'sub2 count should be 1').toMatchObject({ notificationCount: 1 })
            }),
        ),
      ),
    )

    scenario(
      'Should_RateLimitPerSenderPerReceiver_When_OneSenderAtLimitAnotherBelow',
      scope.pipe(
        Given('a receiver subscription has rules for two senders')(
          'subscription',
          ({ db }) =>
            Effect.gen(function*() {
              const [subscription] = yield* insertSubscription(db, { clientId: RECEIVER_CLIENT_ID })
              yield* insertRule(db, {
                subscriptionId: subscription!.id,
                senderPubkey: SENDER_PUBKEY,
                topic: TOPIC as string,
              })
              yield* insertRule(db, {
                subscriptionId: subscription!.id,
                senderPubkey: OTHER_SENDER_PUBKEY,
                topic: TOPIC as string,
              })
              return subscription
            }),
        ),
        And('sender A is already rate limited for this receiver')(
          ({ db, subscription }) =>
            Effect.gen(function*() {
              const windowStart = yield* testClockNowDate
              yield* insertRateLimit(db, {
                senderPubkey: SENDER_PUBKEY,
                clientId: subscription!.clientId,
                windowStart,
                notificationCount: MAX_NOTIFICATIONS_PER_WINDOW,
              })
            }),
        ),
        When('sender B submits a matching statement')(() => submitSignedStatementFromOtherSender({ topics: [TOPIC] })),
        Then('delivery should still happen for sender B')(
          ({ db, subscription }) =>
            Effect.gen(function*() {
              yield* settleDaemon
              expect(apnSend, 'APNs should still be called for sender B').toHaveBeenCalledOnce()
              const senderARate = yield* readRateLimits(db, {
                senderPubkey: SENDER_PUBKEY,
                clientId: subscription!.clientId,
              })
              const senderBRate = yield* readRateLimits(db, {
                senderPubkey: OTHER_SENDER_PUBKEY,
                clientId: subscription!.clientId,
              })
              expect(senderARate, 'Sender A row remains').toHaveLength(1)
              expect(senderBRate, 'Sender B gets independent row').toHaveLength(1)
              expect(senderBRate[0]?.notificationCount).toBe(1)
            }),
        ),
      ),
    )

    scenarioOutline(
      'Should_ApplyRateLimitBoundary_When_<desc>',
      rateLimitBoundaryCases,
      ({ desc: _desc, initialCount, expectedApnCalls }) =>
        scope.pipe(
          Given('a subscription exists')(
            'subscription',
            ({ db }) =>
              Effect.gen(function*() {
                const [subscription] = yield* insertSubscription(db, { clientId: SENDER_PUBKEY })
                yield* insertRule(db, { subscriptionId: subscription!.id })
                return subscription
              }),
          ),
          And('rate limit row has initial count')(
            ({ db, subscription }) =>
              Effect.gen(function*() {
                const windowStart = yield* testClockNowDate
                yield* insertRateLimit(db, {
                  senderPubkey: SENDER_PUBKEY,
                  clientId: subscription!.clientId,
                  windowStart,
                  notificationCount: initialCount,
                })
              }),
          ),
          When('a signed statement is submitted')(() => submitSignedStatement()),
          Then('delivery count should match boundary expectation')(() =>
            Effect.gen(function*() {
              yield* settleDaemon
              expect(apnSend, 'APNs call count should match boundary behavior').toHaveBeenCalledTimes(expectedApnCalls)
            })
          ),
        ),
    )

    scenario(
      'Should_SkipDelivery_When_TokenMissingForChannel',
      scope.pipe(
        Given('a subscription with no token')(
          'subscription',
          ({ db }) =>
            Effect.gen(function*() {
              const [sub] = yield* insertSubscription(db, {
                clientId: SENDER_PUBKEY,
                token: null,
              })
              yield* insertRule(db, { subscriptionId: sub!.id })
              return sub
            }),
        ),
        When('a signed statement is submitted')(() => submitSignedStatement()),
        And('no push providers should be invoked')(() =>
          Effect.gen(function*() {
            yield* settleDaemon
            expect(apnSend, 'APNs should not be called').not.toHaveBeenCalled()
            expect(fcmSend, 'FCM should not be called').not.toHaveBeenCalled()
          })
        ),
        And('should have 0 push records')(
          ({ db, subscription }) =>
            Effect.gen(function*() {
              const records = yield* readPushRecords(db, subscription!.id)
              expect.soft(records, 'Should have 0 push records').toHaveLength(0)
            }),
        ),
      ),
    )

    scenario(
      'Should_ResumeDelivery_When_RateLimitWindowExpired',
      scope.pipe(
        Given('a subscription exists')(
          'subscription',
          ({ db }) =>
            Effect.gen(function*() {
              const [sub] = yield* insertSubscription(db, { clientId: SENDER_PUBKEY })
              yield* insertRule(db, { subscriptionId: sub!.id })
              return sub
            }),
        ),
        And('rate limit is at maximum')(
          ({ db, subscription }) =>
            Effect.gen(function*() {
              const windowStart = yield* testClockNowDate
              yield* insertRateLimit(db, {
                senderPubkey: SENDER_PUBKEY,
                clientId: subscription!.clientId,
                windowStart,
                notificationCount: MAX_NOTIFICATIONS_PER_WINDOW,
              })
            }),
        ),
        When('advancing past the cooldown period')(() =>
          Effect.gen(function*() {
            yield* TestClock.adjust(Duration.millis(RATE_LIMIT_COOLDOWN_MS + 1))
            yield* settleDaemon
          })
        ),
        When('a signed statement is submitted')(() => submitSignedStatement()),
        And('APNs should be called after cooldown expiry')(() =>
          Effect.gen(function*() {
            yield* settleDaemon
            expect(apnSend, 'APNs should be called after cooldown expiry').toHaveBeenCalledOnce()
          })
        ),
        And('rate limit state should reset and count current delivery only')(
          ({ db, subscription }) =>
            Effect.gen(function*() {
              const rates = yield* readRateLimits(db, {
                senderPubkey: SENDER_PUBKEY,
                clientId: subscription!.clientId,
              })
              expect(rates, 'Should have one rate-limit row').toHaveLength(1)
              expect(rates[0]?.notificationCount, 'Count should reset to one after cooldown').toBe(1)
            }),
        ),
      ),
    )

    scenario(
      'Should_DeliverBoth_When_SameSenderTopicWithAlertAndVoip',
      scope.pipe(
        Given('separate APNs and VoIP subscriptions for the same sender')(
          'subscription',
          ({ db }) =>
            Effect.gen(function*() {
              const [subApns] = yield* insertSubscription(db, {
                clientId: SENDER_PUBKEY,
                notificationType: 'apns',
                token: 'test-apns-token',
              })
              yield* insertRule(db, { subscriptionId: subApns!.id })

              const [subVoip] = yield* insertSubscription(db, {
                clientId: SENDER_PUBKEY,
                notificationType: 'voip',
                token: 'test-voip-token',
              })
              yield* insertRule(db, { subscriptionId: subVoip!.id })

              return { subApns, subVoip }
            }),
        ),
        When('a signed statement is submitted')(() => submitSignedStatement()),
        And('APNs should be called twice')(() =>
          Effect.gen(function*() {
            yield* settleDaemon
            expect(apnSend, 'APNs should be called twice (apns + voip)').toHaveBeenCalledTimes(2)
          })
        ),
        And('should have 2 push records across both subscriptions')(
          ({ db, subscription }) =>
            Effect.gen(function*() {
              const recordsApns = yield* readPushRecords(db, subscription!.subApns!.id)
              const recordsVoip = yield* readPushRecords(db, subscription!.subVoip!.id)
              expect.soft(recordsApns, 'APNs sub should have 1 push record').toHaveLength(1)
              expect.soft(recordsVoip, 'VoIP sub should have 1 push record').toHaveLength(1)
              expect.soft(recordsApns[0], 'APNs record channel').toMatchObject({
                deliveryChannel: 'apns',
              })
              expect.soft(recordsVoip[0], 'VoIP record channel').toMatchObject({
                deliveryChannel: 'voip_apns',
              })
            }),
        ),
      ),
    )

    scenario(
      'Should_StayBlocked_When_CooldownPeriodActive',
      scope.pipe(
        Given('a subscription exists')(
          'subscription',
          ({ db }) =>
            Effect.gen(function*() {
              const [sub] = yield* insertSubscription(db, { clientId: SENDER_PUBKEY })
              yield* insertRule(db, { subscriptionId: sub!.id })
              return sub
            }),
        ),
        And('rate limit is at maximum')(
          ({ db, subscription }) =>
            Effect.gen(function*() {
              const windowStart = yield* testClockNowDate
              yield* insertRateLimit(db, {
                senderPubkey: SENDER_PUBKEY,
                clientId: subscription!.clientId,
                windowStart,
                notificationCount: MAX_NOTIFICATIONS_PER_WINDOW,
              })
            }),
        ),
        When('advancing past the window but within cooldown')(() =>
          Effect.gen(function*() {
            yield* TestClock.adjust(Duration.millis(RATE_LIMIT_WINDOW_MS + 1))
            yield* settleDaemon
          })
        ),
        When('a signed statement is submitted')(() => submitSignedStatement()),
        And('APNs should not be called during cooldown')(() =>
          Effect.gen(function*() {
            yield* settleDaemon
            expect(apnSend, 'APNs should not be called during cooldown').not.toHaveBeenCalled()
          })
        ),
      ),
    )

    scenario(
      'Should_TruncatePayload_When_StatementExceedsPlatformLimit',
      scope.pipe(
        Given('a subscription exists')(
          'subscription',
          ({ db }) =>
            Effect.gen(function*() {
              const [sub] = yield* insertSubscription(db, { clientId: SENDER_PUBKEY })
              yield* insertRule(db, { subscriptionId: sub!.id })
              return sub
            }),
        ),
        When('a signed statement with large data is submitted')(() => {
          const largeData = new Uint8Array(2049).fill(0x41)
          return submitSignedStatement({ data: largeData })
        }),
        And('APNs should be called')(() =>
          Effect.gen(function*() {
            yield* settleDaemon
            expect(apnSend, 'APNs should be called').toHaveBeenCalledOnce()
          })
        ),
        And('truncated payload should send valid StatementPushRequest')(() => {
          expect(apnSend, 'APNs should receive valid StatementPushRequest').toHaveBeenCalledWith(
            expect.schemaMatching(Schema.standardSchemaV1(StatementPushRequest)),
          )
        }),
        And('truncated payload should have truncated flag set to true')(() => {
          expect(apnSend, 'APNs should receive truncated=true').toHaveBeenCalledWith(
            expect.objectContaining({ truncated: true }),
          )
        }),
        And('truncated payload should omit statement body data')(() => {
          expect(apnSend, 'APNs should receive message=null for truncated payload').toHaveBeenCalledWith(
            expect.objectContaining({ message: null }),
          )
        }),
      ),
    )

    scenario(
      'Should_RateLimitIndependently_When_SubAAtLimitSubBBelow',
      scope.pipe(
        Given('two subscriptions where A is at rate limit and B is below')(
          'subs',
          ({ db }) =>
            Effect.gen(function*() {
              const [subA] = yield* insertSubscription(db, { clientId: SENDER_PUBKEY })
              yield* insertRule(db, { subscriptionId: subA!.id })
              const windowStart = yield* testClockNowDate
              yield* insertRateLimit(db, {
                senderPubkey: SENDER_PUBKEY,
                clientId: subA!.clientId,
                windowStart,
                notificationCount: MAX_NOTIFICATIONS_PER_WINDOW,
              })

              const [subB] = yield* insertSubscription(db, {
                clientId: OTHER_SENDER,
                notificationType: 'fcm',
                token: 'other-fcm-token',
              })
              yield* insertRule(db, { subscriptionId: subB!.id, senderPubkey: SENDER_PUBKEY })

              return { subA, subB }
            }),
        ),
        When('a signed statement is submitted')(() => submitSignedStatement()),
        And('APNs should not be called for rate-limited sub A; FCM delivers for sub B')(() =>
          Effect.gen(function*() {
            yield* settleDaemon
            expect(apnSend, 'APNs should NOT be called for rate-limited sub A').not.toHaveBeenCalled()
            expect(fcmSend, 'FCM should be called for sub B').toHaveBeenCalledOnce()
          })
        ),
        And('sub A should have 0 push records')(
          ({ db, subs }) =>
            Effect.gen(function*() {
              const recordsA = yield* readPushRecords(db, subs.subA!.id)
              expect.soft(recordsA, 'Sub A should have 0 push records').toHaveLength(0)
            }),
        ),
        And('sub B should have 1 push record')(
          ({ db, subs }) =>
            Effect.gen(function*() {
              const recordsB = yield* readPushRecords(db, subs.subB!.id)
              expect.soft(recordsB, 'Sub B should have 1 push record').toHaveLength(1)
            }),
        ),
      ),
    )

    scenario(
      'Should_DeliverAlertOnly_When_VoipTokenMissing',
      scope.pipe(
        Given('an APNs subscription and a VoIP subscription with no token')(
          'subscription',
          ({ db }) =>
            Effect.gen(function*() {
              const [subApns] = yield* insertSubscription(db, {
                clientId: SENDER_PUBKEY,
                notificationType: 'apns',
                token: 'test-apns-token',
              })
              yield* insertRule(db, { subscriptionId: subApns!.id })

              const [subVoip] = yield* insertSubscription(db, {
                clientId: SENDER_PUBKEY,
                notificationType: 'voip',
                token: null,
              })
              yield* insertRule(db, { subscriptionId: subVoip!.id })

              return subApns
            }),
        ),
        When('a signed statement is submitted')(() => submitSignedStatement()),
        And('APNs should be called once for alert')(() =>
          Effect.gen(function*() {
            yield* settleDaemon
            expect(apnSend, 'APNs should be called once for alert').toHaveBeenCalledOnce()
          })
        ),
        And('should have 1 push record for alert via apns')(
          ({ db, subscription }) =>
            Effect.gen(function*() {
              const records = yield* readPushRecords(db, subscription!.id)
              expect.soft(records, 'Should have 1 push record').toHaveLength(1)
              expect.soft(records[0], 'Record should be alert via apns').toMatchObject({
                deliveryChannel: 'apns',
                notifyType: 'apns',
              })
            }),
        ),
      ),
    )

    scenario(
      'Should_RecordRetryableFailure_When_FcmDeliveryFails',
      scope.pipe(
        Given('an Android subscription with a failing FCM mock')(
          'subscription',
          ({ db }) =>
            Effect.gen(function*() {
              fcmSend.mockImplementationOnce(() =>
                Effect.fail(
                  PushNotificationServiceError.make({
                    cause: new Error('FCM connection failed'),
                  }),
                )
              )
              const [sub] = yield* insertSubscription(db, {
                clientId: SENDER_PUBKEY,
                notificationType: 'fcm',
                token: 'test-fcm-token',
              })
              yield* insertRule(db, { subscriptionId: sub!.id })
              return sub
            }),
        ),
        When('a signed statement is submitted')(() => submitSignedStatement()),
        And('FCM should have been called')(() =>
          Effect.gen(function*() {
            yield* settleDaemon
            expect(fcmSend, 'FCM should have been called').toHaveBeenCalledOnce()
          })
        ),
        And('should have 1 failed record')(
          ({ db, subscription }) =>
            Effect.gen(function*() {
              const failed = yield* readFailedPushRecords(db, subscription!.id)
              expect.soft(failed, 'Should have 1 failed record').toHaveLength(1)
              expect.soft(failed[0], 'Failed record should be retryable via FCM').toMatchObject({
                deliveryChannel: 'fcm',
                retryable: true,
              })
            }),
        ),
        And('should have 0 success records')(
          ({ db, subscription }) =>
            Effect.gen(function*() {
              const success = yield* readPushRecords(db, subscription!.id)
              expect.soft(success, 'Should have 0 success records').toHaveLength(0)
            }),
        ),
        And('subscription token should remain present')(
          ({ db, subscription }) =>
            Effect.gen(function*() {
              const rows = yield* readSubscriptionById(db, subscription!.id)
              expect(rows[0]?.token, 'Transient failure must not clear token').toBe('test-fcm-token')
            }),
        ),
      ),
    )

    scenario(
      'Should_ClearTokenAndRecordNonRetryable_When_ApnsTokenIsInvalid',
      scope.pipe(
        Given('an APNS subscription with a terminal token-invalid failure')(
          'subscription',
          ({ db }) =>
            Effect.gen(function*() {
              apnSend.mockImplementationOnce(() =>
                Effect.fail(
                  PushNotificationTokenInvalidError.make({
                    platform: 'ios',
                    reason: 'token_unregistered',
                    providerCode: 'Unregistered',
                    cause: new Error('Device token is no longer active'),
                  }),
                )
              )
              const [sub] = yield* insertSubscription(db, {
                clientId: SENDER_PUBKEY,
                notificationType: 'apns',
                token: 'test-apns-token',
              })
              yield* insertRule(db, { subscriptionId: sub!.id })
              return sub
            }),
        ),
        When('a signed statement is submitted')(() => submitSignedStatement()),
        And('APNs should have been called')(() =>
          Effect.gen(function*() {
            yield* settleDaemon
            expect(apnSend, 'APNs should have been called').toHaveBeenCalledOnce()
          })
        ),
        And('should record a non-retryable failure on the APNs channel')(
          ({ db, subscription }) =>
            Effect.gen(function*() {
              const failed = yield* readFailedPushRecords(db, subscription!.id)
              expect.soft(failed, 'Should have 1 failed record').toHaveLength(1)
              expect.soft(failed[0], 'Terminal token failure must be non-retryable').toMatchObject({
                deliveryChannel: 'apns',
                retryable: false,
              })
            }),
        ),
        And('subscription token should be cleared')(
          ({ db, subscription }) =>
            Effect.gen(function*() {
              const rows = yield* readSubscriptionById(db, subscription!.id)
              expect(rows[0]?.token, 'Terminal token failure must clear subscription token').toBeNull()
            }),
        ),
        And('should have 0 success records')(
          ({ db, subscription }) =>
            Effect.gen(function*() {
              const success = yield* readPushRecords(db, subscription!.id)
              expect.soft(success, 'Should have 0 success records').toHaveLength(0)
            }),
        ),
      ),
    )

    scenario(
      'Should_ClearTokenAndRecordNonRetryable_When_FcmTokenIsInvalid',
      scope.pipe(
        Given('an Android subscription with a terminal token-invalid FCM failure')(
          'subscription',
          ({ db }) =>
            Effect.gen(function*() {
              fcmSend.mockImplementationOnce(() =>
                Effect.fail(
                  PushNotificationTokenInvalidError.make({
                    platform: 'android',
                    reason: 'token_unregistered',
                    providerCode: 'messaging/registration-token-not-registered',
                    cause: new Error('The registration token is not a valid FCM registration token'),
                  }),
                )
              )
              const [sub] = yield* insertSubscription(db, {
                clientId: SENDER_PUBKEY,
                notificationType: 'fcm',
                token: 'test-fcm-token',
              })
              yield* insertRule(db, { subscriptionId: sub!.id })
              return sub
            }),
        ),
        When('a signed statement is submitted')(() => submitSignedStatement()),
        And('FCM should have been called')(() =>
          Effect.gen(function*() {
            yield* settleDaemon
            expect(fcmSend, 'FCM should have been called').toHaveBeenCalledOnce()
          })
        ),
        And('should record a non-retryable failure on the FCM channel')(
          ({ db, subscription }) =>
            Effect.gen(function*() {
              const failed = yield* readFailedPushRecords(db, subscription!.id)
              expect.soft(failed, 'Should have 1 failed record').toHaveLength(1)
              expect.soft(failed[0], 'Terminal token failure must be non-retryable').toMatchObject({
                deliveryChannel: 'fcm',
                retryable: false,
              })
            }),
        ),
        And('subscription token should be cleared')(
          ({ db, subscription }) =>
            Effect.gen(function*() {
              const rows = yield* readSubscriptionById(db, subscription!.id)
              expect(rows[0]?.token, 'Terminal token failure must clear subscription token').toBeNull()
            }),
        ),
        And('should have 0 success records')(
          ({ db, subscription }) =>
            Effect.gen(function*() {
              const success = yield* readPushRecords(db, subscription!.id)
              expect.soft(success, 'Should have 0 success records').toHaveLength(0)
            }),
        ),
      ),
    )

    scenario(
      'Should_RateLimit_When_ClientExceedsMaxPerWindow',
      scope.pipe(
        Given('a subscription exists')(
          'subscription',
          ({ db }) =>
            Effect.gen(function*() {
              apnSend.mockClear()
              const [sub] = yield* insertSubscription(db, { clientId: SENDER_PUBKEY })
              yield* insertRule(db, { subscriptionId: sub!.id })
              return sub
            }),
        ),
        When('sending max notifications through the store')(() =>
          Effect.gen(function*() {
            for (let i = 0; i < MAX_NOTIFICATIONS_PER_WINDOW; i++) {
              yield* submitSignedStatement({ data: new TextEncoder().encode(`msg ${i}`) })
            }
            yield* settleDaemon
          })
        ),
        When('sending one more notification')(() =>
          submitSignedStatement({ data: new TextEncoder().encode('overflow') })
        ),
        And('APNs should not send beyond the window cap')(() =>
          Effect.gen(function*() {
            yield* settleDaemon
            expect(apnSend.mock.calls.length, 'overflow must not add another APN send').toBe(
              MAX_NOTIFICATIONS_PER_WINDOW,
            )
          })
        ),
        And('rate limit count should be at max')(
          ({ db, subscription }) =>
            Effect.gen(function*() {
              const rates = yield* readRateLimits(db, {
                senderPubkey: SENDER_PUBKEY,
                clientId: subscription!.clientId,
              })
              expect.soft(rates, 'Should have 1 rate limit record').toHaveLength(1)
              expect.soft(rates[0], 'Count should be at max').toMatchObject({
                notificationCount: MAX_NOTIFICATIONS_PER_WINDOW,
              })
            }),
        ),
      ),
    )

    scenario(
      'Three matching rules for one subscription produce one delivery',
      scope.pipe(
        Given('Alice has an APNs subscription with three rules for different topics')(
          'subscription',
          ({ db }) =>
            Effect.gen(function*() {
              const [sub] = yield* insertSubscription(db, { clientId: SENDER_PUBKEY })
              yield* insertRule(db, { subscriptionId: sub!.id, topic: TOPIC as string })
              yield* insertRule(db, { subscriptionId: sub!.id, topic: TOPIC_2 as string })
              const TOPIC_3 = Topic.make('0x' + 'e'.repeat(64))
              yield* insertRule(db, { subscriptionId: sub!.id, topic: TOPIC_3 as string })
              return sub
            }),
        ),
        When('Bob sends a statement matching all three topics')(() =>
          submitSignedStatement({ topics: [TOPIC, TOPIC_2, Topic.make('0x' + 'e'.repeat(64))] })
        ),
        Then('one push notification should be delivered')(() =>
          Effect.gen(function*() {
            yield* settleDaemon
            expect(apnSend, 'Should send one push despite three matching rules').toHaveBeenCalledOnce()
          })
        ),
        And('one delivery should be recorded')(
          ({ db, subscription }) =>
            Effect.gen(function*() {
              const records = yield* readPushRecords(db, subscription!.id)
              expect(records, 'Should have 1 delivery record').toHaveLength(1)
            }),
        ),
      ),
    )

    scenario(
      'Rate limit unaffected when multiple rules match the same subscription',
      scope.pipe(
        Given('Alice has an APNs subscription with rules for DMs and calls')(
          'subscription',
          ({ db }) =>
            Effect.gen(function*() {
              const [sub] = yield* insertSubscription(db, { clientId: SENDER_PUBKEY })
              yield* insertRule(db, { subscriptionId: sub!.id, topic: TOPIC as string })
              yield* insertRule(db, { subscriptionId: sub!.id, topic: TOPIC_2 as string })
              return sub
            }),
        ),
        And('her rate limit is at maximum')(
          ({ db, subscription }) =>
            Effect.gen(function*() {
              const windowStart = yield* testClockNowDate
              yield* insertRateLimit(db, {
                senderPubkey: SENDER_PUBKEY,
                clientId: subscription!.clientId,
                windowStart,
                notificationCount: MAX_NOTIFICATIONS_PER_WINDOW,
              })
            }),
        ),
        When('Bob sends a statement matching both rules')(() => submitSignedStatement({ topics: [TOPIC, TOPIC_2] })),
        Then('no push notification should be delivered')(() =>
          Effect.gen(function*() {
            yield* settleDaemon
            expect(apnSend, 'Should not send when rate limited').not.toHaveBeenCalled()
          })
        ),
        And('the rate limit count should stay at max')(
          ({ db, subscription }) =>
            Effect.gen(function*() {
              const rates = yield* readRateLimits(db, {
                senderPubkey: SENDER_PUBKEY,
                clientId: subscription!.clientId,
              })
              expect.soft(rates, 'Should have 1 rate limit record').toHaveLength(1)
              expect.soft(rates[0], 'Count should remain at max, not inflated').toMatchObject({
                notificationCount: MAX_NOTIFICATIONS_PER_WINDOW,
              })
            }),
        ),
      ),
    )
  })
