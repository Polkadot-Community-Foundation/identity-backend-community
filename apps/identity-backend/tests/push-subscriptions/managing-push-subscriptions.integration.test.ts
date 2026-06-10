import { DB } from '#root/db/drizzle.js'
import * as schema from '#root/db/schema.js'
import { verifyJwt } from '#root/middleware/verify-jwt.js'
import { makeSubscriptionRouteWithoutDependencies } from '#root/routes/v1/subscriptions/routes.js'
import {
  RuleResponseSchema,
  RulesOperationResponseZod,
  SubscriptionResponseZod,
} from '#root/routes/v1/subscriptions/types.js'
import { OpenAPIHono, z } from '@hono/zod-openapi'
import { And, Given, Then, When } from '@identity-backend/effect-vitest-gherkin'
import { checkResponse, expectStatus } from '@identity-backend/testing/hono'
import { eq } from 'drizzle-orm'
import { Effect } from 'effect'
import { HTTPException } from 'hono/http-exception'
import { testClient } from 'hono/testing'
import { SignJWT } from 'jose'
import { OTHER_PUBKEY, OTHER_TOPIC, SECOND_CLIENT_PUBKEY, TEST_JWT_SECRET } from './fixtures.js'
import { cleanUp, insertRule, insertSubscription, SENDER_PUBKEY, TOPIC } from './helpers/subscription-test-layer.js'
import { apnSend, feature, scenarioLayer, sharedFileLayer, webPushSend } from './layers.js'

const SubscriptionListSchema = z.array(SubscriptionResponseZod)
const RuleListSchema = z.array(RuleResponseSchema)
const parseSubscriptionList = (value: unknown) => SubscriptionListSchema.parse(value)
const expectRulesOperationResponse = (value: unknown) =>
  expect(value).toEqual(expect.schemaMatching(RulesOperationResponseZod))

const signTestToken = (sub: string): Promise<string> =>
  new SignJWT({ sub }).setProtectedHeader({ alg: 'HS256' }).sign(new TextEncoder().encode(TEST_JWT_SECRET))

const signExpiredToken = (sub: string): Promise<string> =>
  new SignJWT({ sub })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime(1)
    .sign(new TextEncoder().encode(TEST_JWT_SECRET))

const signTokenWithSecret = (sub: string, secret: string): Promise<string> =>
  new SignJWT({ sub }).setProtectedHeader({ alg: 'HS256' }).sign(new TextEncoder().encode(secret))

interface JwtEnv {
  Variables: {
    jwtSub: string
  }
}

const makeClient = Effect.map(makeSubscriptionRouteWithoutDependencies, (route) => {
  const app = new OpenAPIHono<JwtEnv>()
    .use(verifyJwt(TEST_JWT_SECRET))
    .route('/subscriptions', route)
    .onError((err) => {
      if (err instanceof HTTPException) return err.getResponse()
      throw err
    })
  return testClient(app)
})

type Client = Effect.Effect.Success<typeof makeClient>

const createSubscription = (
  client: Client,
  token: string,
  notificationType: 'apns' | 'voip' | 'fcm',
  tok: string,
): Promise<{ res: Response; id: string }> =>
  client.subscriptions
    .$post(
      { json: { notificationType, token: tok } },
      { headers: { Authorization: `Bearer ${token}` } },
    )
    .then(async (res) => {
      const json = (await res.json()) as { id: string }
      return { res, id: json.id }
    })

const createSubscriptionCases = [
  {
    desc: 'apns',
    body: { notificationType: 'apns' as const, token: 'test-apns' },
    assert: { notificationType: 'apns', token: 'test-apns' },
  },
  {
    desc: 'fcm',
    body: { notificationType: 'fcm' as const, token: 'test-fcm' },
    assert: { notificationType: 'fcm', token: 'test-fcm' },
  },
  {
    desc: 'voip',
    body: { notificationType: 'voip' as const, token: 'test-voip' },
    assert: { notificationType: 'voip', token: 'test-voip' },
  },
]

const invalidCreateCases = [
  { desc: 'MissingNotificationType', body: { token: 'some-token' } },
  { desc: 'MissingToken', body: { notificationType: 'apns' } },
  { desc: 'EmptyToken', body: { notificationType: 'apns', token: '' } },
  { desc: 'InvalidNotificationType', body: { notificationType: 'sms', token: 'some-token' } },
  { desc: 'TokenTooLong', body: { notificationType: 'apns', token: 'x'.repeat(4097) } },
]

const invalidRuleCases = [
  { desc: 'MissingSenderPubkey', rule: { topic: '0x' + 'c'.repeat(64) } },
  { desc: 'MissingTopic', rule: { senderPubkey: SENDER_PUBKEY } },
  { desc: 'InvalidSenderPubkeyHex', rule: { senderPubkey: '0x123', topic: TOPIC } },
  { desc: 'InvalidTopicHex', rule: { senderPubkey: SENDER_PUBKEY, topic: '0xxyz' } },
  { desc: 'EmptyRules', body: { subscription_id: '00000000-0000-0000-0000-000000000000', rules: [] } },
]

const authFailureCases = [
  {
    desc: 'NoJwtProvided',
    makeAuthHeader: () => Promise.resolve(undefined as string | undefined),
  },
  {
    desc: 'MalformedJwt',
    makeAuthHeader: () => Promise.resolve('not-a-jwt'),
  },
  {
    desc: 'ExpiredJwt',
    makeAuthHeader: () => signExpiredToken(SENDER_PUBKEY),
  },
  {
    desc: 'WrongSignatureJwt',
    makeAuthHeader: () => signTokenWithSecret(SENDER_PUBKEY, 'wrong-secret'),
  },
]

const notFoundCases = [
  {
    op: 'DELETE rules' as const,
    fn: (c: Client, token: string) =>
      c.subscriptions.rules.$delete(
        {
          json: {
            subscription_id: '00000000-0000-0000-0000-000000000000',
            rules: [{ senderPubkey: SENDER_PUBKEY, topic: TOPIC }],
          },
        },
        { headers: { Authorization: `Bearer ${token}` } },
      ) as Promise<Response>,
  },
  {
    op: 'PUT rules' as const,
    fn: (c: Client, token: string) =>
      c.subscriptions.rules.$put(
        {
          json: {
            subscription_id: '00000000-0000-0000-0000-000000000000',
            rules: [{ senderPubkey: SENDER_PUBKEY, topic: TOPIC }],
          },
        },
        { headers: { Authorization: `Bearer ${token}` } },
      ) as Promise<Response>,
  },
  {
    op: 'POST rules' as const,
    fn: (c: Client, token: string) =>
      c.subscriptions.rules.$post(
        {
          json: {
            subscription_id: '00000000-0000-0000-0000-000000000000',
            rules: [{ senderPubkey: SENDER_PUBKEY, topic: TOPIC }],
          },
        },
        { headers: { Authorization: `Bearer ${token}` } },
      ) as Promise<Response>,
  },
]

const foreignOwnershipRuleOps = [
  {
    op: 'POST rules' as const,
    run: (c: Client, token: string, subscriptionId: string) =>
      c.subscriptions.rules.$post(
        {
          json: {
            subscription_id: subscriptionId,
            rules: [{ senderPubkey: SENDER_PUBKEY, topic: TOPIC }],
          },
        },
        { headers: { Authorization: `Bearer ${token}` } },
      ) as Promise<Response>,
  },
  {
    op: 'PUT rules' as const,
    run: (c: Client, token: string, subscriptionId: string) =>
      c.subscriptions.rules.$put(
        {
          json: {
            subscription_id: subscriptionId,
            rules: [{ senderPubkey: SENDER_PUBKEY, topic: TOPIC }],
          },
        },
        { headers: { Authorization: `Bearer ${token}` } },
      ) as Promise<Response>,
  },
  {
    op: 'DELETE rules' as const,
    run: (c: Client, token: string, subscriptionId: string) =>
      c.subscriptions.rules.$delete(
        {
          json: {
            subscription_id: subscriptionId,
            rules: [{ senderPubkey: SENDER_PUBKEY, topic: TOPIC }],
          },
        },
        { headers: { Authorization: `Bearer ${token}` } },
      ) as Promise<Response>,
  },
]

feature('Managing Push Subscriptions')
  .withLayer(sharedFileLayer)
  .withScenarioLayer(scenarioLayer)
  .withScope({})
  .body(({ scenario, scenarioOutline, background, scope }) => {
    background(
      Effect.gen(function*() {
        yield* cleanUp
        apnSend.mockClear()
      }),
    )

    scenarioOutline(
      'Should_Return201_When_Creating<desc>',
      createSubscriptionCases,
      ({ desc: _desc, body, assert }) =>
        scope.pipe(
          Given('a subscription does not exist')(() => Effect.void),
          When('creating a subscription with valid payload')(
            'createRes',
            () =>
              Effect.gen(function*() {
                const client = yield* makeClient
                const token = yield* Effect.promise(() => signTestToken(SENDER_PUBKEY))
                return yield* Effect.promise(() =>
                  client.subscriptions.$post(
                    { json: body },
                    { headers: { Authorization: `Bearer ${token}` } },
                  )
                )
              }).pipe(Effect.flatMap(expectStatus(201))),
          ),
          Then('response should match expected shape')(
            ({ createRes }) =>
              Effect.gen(function*() {
                const json = yield* Effect.promise(() => createRes.json())
                expect(json).toEqual(expect.schemaMatching(SubscriptionResponseZod))
                expect.soft(json, 'Response should match expected shape').toMatchObject(assert)
                expect.soft(json.id, 'Should have id').toBeDefined()
                expect.soft(json.createdAt, 'Should have createdAt').toBeDefined()
                expect.soft(json.updatedAt, 'Should have updatedAt').toBeDefined()
                expect.soft(json.rules, 'Should have rules array').toEqual([])
              }),
          ),
        ),
    )

    scenario(
      'Should_StayRegisteredOnce_When_SameSubscriptionReRegistered',
      scope.pipe(
        Given('Alice has no push subscriptions')(() => Effect.void),
        When('Alice registers for APNs notifications with token "device-token-alpha"')(
          'firstRes',
          () =>
            Effect.gen(function*() {
              const client = yield* makeClient
              const token = yield* Effect.promise(() => signTestToken(SENDER_PUBKEY))
              const res = yield* Effect.promise(() =>
                client.subscriptions.$post(
                  { json: { notificationType: 'apns' as const, token: 'tok' } },
                  { headers: { Authorization: `Bearer ${token}` } },
                )
              )
              return res
            }),
        ),
        Then('Alice becomes subscribed to APNs notifications')(({ firstRes }) => {
          checkResponse(firstRes, 201)
        }),
        When('Alice registers for APNs notifications with the same token again')(
          'secondRes',
          () =>
            Effect.gen(function*() {
              const client = yield* makeClient
              const token = yield* Effect.promise(() => signTestToken(SENDER_PUBKEY))
              const res = yield* Effect.promise(() =>
                client.subscriptions.$post(
                  { json: { notificationType: 'apns' as const, token: 'tok' } },
                  { headers: { Authorization: `Bearer ${token}` } },
                )
              )
              return res
            }),
        ),
        Then('Alice remains subscribed to APNs notifications')(({ secondRes }) => {
          expect(secondRes.status).toBe(200)
        }),
        And('Alice has exactly one APNs subscription')(
          () =>
            Effect.gen(function*() {
              const client = yield* makeClient
              const token = yield* Effect.promise(() => signTestToken(SENDER_PUBKEY))
              const res = yield* Effect.promise(() =>
                client.subscriptions.$get({}, { headers: { Authorization: `Bearer ${token}` } })
              )
              checkResponse(res, 200)
              const subs = parseSubscriptionList(yield* Effect.promise(() => res.json() as Promise<unknown>))
              expect(subs).toHaveLength(1)
              expect(subs[0]?.token).toBe('tok')
            }),
        ),
      ),
    )

    scenario(
      'Should_Return200_When_SameTypeDifferentToken',
      scope.pipe(
        When('creating a subscription')(
          'firstRes',
          () =>
            Effect.gen(function*() {
              const client = yield* makeClient
              const token = yield* Effect.promise(() => signTestToken(SENDER_PUBKEY))
              const res = yield* Effect.promise(() =>
                client.subscriptions.$post(
                  { json: { notificationType: 'apns' as const, token: 'old-token' } },
                  { headers: { Authorization: `Bearer ${token}` } },
                )
              )
              return res
            }),
        ),
        Then('first POST should return 201')(({ firstRes }) => {
          checkResponse(firstRes, 201)
        }),
        When('updating with a different token')(
          'secondRes',
          () =>
            Effect.gen(function*() {
              const client = yield* makeClient
              const token = yield* Effect.promise(() => signTestToken(SENDER_PUBKEY))
              const res = yield* Effect.promise(() =>
                client.subscriptions.$post(
                  { json: { notificationType: 'apns' as const, token: 'new-token' } },
                  { headers: { Authorization: `Bearer ${token}` } },
                )
              )
              return res
            }),
        ),
        Then('second POST should return 200')(({ secondRes }) => {
          expect(secondRes.status, 'Token update should return 200').toBe(200)
        }),
        When('getting the subscription')(
          'getRes',
          () =>
            Effect.gen(function*() {
              const client = yield* makeClient
              const token = yield* Effect.promise(() => signTestToken(SENDER_PUBKEY))
              const res = yield* Effect.promise(() =>
                client.subscriptions.$get({}, { headers: { Authorization: `Bearer ${token}` } })
              )
              return res
            }),
        ),
        Then('subscription should have the new token')(
          ({ getRes }) =>
            Effect.gen(function*() {
              checkResponse(getRes, 200)
              const json = yield* Effect.promise(() => getRes.json() as Promise<unknown>)
              const subs = parseSubscriptionList(json)
              expect.soft(subs, 'Should be array').toHaveLength(1)
              expect.soft(subs[0], 'Token should be updated').toMatchObject({ token: 'new-token' })
            }),
        ),
      ),
    )

    scenarioOutline(
      'Should_Return400_When_<desc>',
      invalidCreateCases,
      ({ desc: _desc, body }) =>
        scope.pipe(
          Given('no subscription exists')(() => Effect.void),
          When('creating a subscription with invalid payload')(
            'res',
            () =>
              Effect.gen(function*() {
                const client = yield* makeClient
                const token = yield* Effect.promise(() => signTestToken(SENDER_PUBKEY))
                const res = yield* Effect.promise(() => (client.subscriptions.$post(
                  { json: body as Parameters<typeof client.subscriptions.$post>[0]['json'] },
                  { headers: { Authorization: `Bearer ${token}` } },
                ) as Promise<Response>))
                return res
              }),
          ),
          Then('should return 400')(({ res }) => {
            expect(res.status, 'Invalid create should be rejected').toBe(400)
          }),
          And('response content-type should be problem+json')(({ res }) => {
            expect(res.headers.get('content-type')).toBe('application/problem+json')
          }),
        ),
    )

    scenario(
      'Should_ReturnUpdatedSubscription_When_FullLifecycle',
      scope.pipe(
        When('creating a subscription')(
          'postRes',
          () =>
            Effect.gen(function*() {
              const client = yield* makeClient
              const token = yield* Effect.promise(() => signTestToken(SENDER_PUBKEY))
              const res = yield* Effect.promise(() =>
                client.subscriptions.$post(
                  { json: { notificationType: 'apns', token: 'old-token' } },
                  { headers: { Authorization: `Bearer ${token}` } },
                )
              )
              return res
            }),
        ),
        Then('create should return 201')(({ postRes }) => {
          checkResponse(postRes, 201)
        }),
        When('getting the subscription')(
          'getBefore',
          () =>
            Effect.gen(function*() {
              const client = yield* makeClient
              const token = yield* Effect.promise(() => signTestToken(SENDER_PUBKEY))
              const res = yield* Effect.promise(() =>
                client.subscriptions.$get({}, { headers: { Authorization: `Bearer ${token}` } })
              )
              return res
            }),
        ),
        Then('get should return 200 with old token')(
          ({ getBefore }) =>
            Effect.gen(function*() {
              checkResponse(getBefore, 200)
              const json = yield* Effect.promise(() => getBefore.json() as Promise<unknown>)
              const subs = parseSubscriptionList(json)
              expect.soft(subs, 'Should be array').toHaveLength(1)
              expect.soft(subs[0], 'Before update').toMatchObject({ token: 'old-token' })
            }),
        ),
        When('updating the subscription with new token')(
          'putRes',
          () =>
            Effect.gen(function*() {
              const client = yield* makeClient
              const token = yield* Effect.promise(() => signTestToken(SENDER_PUBKEY))
              const res = yield* Effect.promise(() =>
                client.subscriptions.$post(
                  { json: { notificationType: 'apns', token: 'new-token' } },
                  { headers: { Authorization: `Bearer ${token}` } },
                )
              )
              return res
            }),
        ),
        Then('update should return 200')(({ putRes }) => {
          checkResponse(putRes, 200)
        }),
        When('getting the subscription after update')(
          'getAfter',
          () =>
            Effect.gen(function*() {
              const client = yield* makeClient
              const token = yield* Effect.promise(() => signTestToken(SENDER_PUBKEY))
              const res = yield* Effect.promise(() =>
                client.subscriptions.$get({}, { headers: { Authorization: `Bearer ${token}` } })
              )
              return res
            }),
        ),
        Then('get should return updated token')(
          ({ getAfter }) =>
            Effect.gen(function*() {
              checkResponse(getAfter, 200)
              const json = yield* Effect.promise(() => getAfter.json() as Promise<unknown>)
              const subs = parseSubscriptionList(json)
              expect.soft(subs, 'Should be array').toHaveLength(1)
              expect.soft(subs[0], 'After update should have new token').toMatchObject({
                token: 'new-token',
              })
            }),
        ),
      ),
    )

    scenario(
      'Should_Return204ThenEmptyArray_When_Deleted',
      scope.pipe(
        Given('a subscription exists')(() => Effect.void),
        When('deleting the subscription')(
          'delRes',
          () =>
            Effect.gen(function*() {
              const client = yield* makeClient
              const token = yield* Effect.promise(() => signTestToken(SENDER_PUBKEY))
              // Create subscription
              const { id } = yield* Effect.promise(() => createSubscription(client, token, 'apns', 'tok'))
              // Delete
              const res = yield* Effect.promise(() =>
                client.subscriptions.$delete(
                  { json: { subscription_ids: [id] } },
                  { headers: { Authorization: `Bearer ${token}` } },
                )
              )
              return res
            }),
        ),
        Then('delete should return 204')(({ delRes }) => {
          expect(delRes.status, 'Delete should return 204').toBe(204)
        }),
        When('getting the deleted subscription')(
          'getRes',
          () =>
            Effect.gen(function*() {
              const client = yield* makeClient
              const token = yield* Effect.promise(() => signTestToken(SENDER_PUBKEY))
              const res = yield* Effect.promise(() =>
                client.subscriptions.$get({}, { headers: { Authorization: `Bearer ${token}` } })
              )
              return res
            }),
        ),
        Then('get should return 200 with empty array')(({ getRes }) => {
          checkResponse(getRes, 200)
        }),
        And('response should be empty array')(
          ({ getRes }) =>
            Effect.gen(function*() {
              const json = yield* Effect.promise(() => getRes.json() as Promise<unknown>)
              const subs = parseSubscriptionList(json)
              expect(subs, 'Should be empty array after delete').toHaveLength(0)
            }),
        ),
      ),
    )

    scenario(
      'Should_DeleteRules_When_SubscriptionDeleted',
      scope.pipe(
        Given('a subscription exists with rules')(() => Effect.void),
        When('deleting the subscription')(
          'delRes',
          () =>
            Effect.gen(function*() {
              const client = yield* makeClient
              const token = yield* Effect.promise(() => signTestToken(SENDER_PUBKEY))
              // Create subscription
              const { id } = yield* Effect.promise(() => createSubscription(client, token, 'apns', 'tok'))
              // Add a rule
              yield* Effect.promise(() =>
                client.subscriptions.rules.$post(
                  {
                    json: {
                      subscription_id: id,
                      rules: [{ senderPubkey: SENDER_PUBKEY, topic: TOPIC }],
                    },
                  },
                  { headers: { Authorization: `Bearer ${token}` } },
                )
              )
              // Verify rule exists
              const getBeforeDelete = yield* Effect.promise(() =>
                client.subscriptions.$get({}, { headers: { Authorization: `Bearer ${token}` } })
              )
              checkResponse(getBeforeDelete, 200)
              const jsonBefore = yield* Effect.promise(() => getBeforeDelete.json() as Promise<unknown>)
              const beforeSubs = parseSubscriptionList(jsonBefore)
              expect.soft(beforeSubs[0]?.rules, 'Should have 1 rule before delete').toHaveLength(1)
              // Delete subscription
              const res = yield* Effect.promise(() =>
                client.subscriptions.$delete(
                  { json: { subscription_ids: [id] } },
                  { headers: { Authorization: `Bearer ${token}` } },
                )
              )
              return res
            }),
        ),
        Then('delete should return 204')(({ delRes }) => {
          expect(delRes.status, 'Delete should return 204').toBe(204)
        }),
        When('getting the deleted subscription')(
          'getAfterDelete',
          () =>
            Effect.gen(function*() {
              const client = yield* makeClient
              const token = yield* Effect.promise(() => signTestToken(SENDER_PUBKEY))
              const res = yield* Effect.promise(() =>
                client.subscriptions.$get({}, { headers: { Authorization: `Bearer ${token}` } })
              )
              return res
            }),
        ),
        Then('get should return 200 with empty array since subscription and rules are gone')(({ getAfterDelete }) => {
          checkResponse(getAfterDelete, 200)
        }),
        And('response should be empty array')(
          ({ getAfterDelete }) =>
            Effect.gen(function*() {
              const json = yield* Effect.promise(() => getAfterDelete.json() as Promise<unknown>)
              const subs = parseSubscriptionList(json)
              expect(subs, 'Should be empty array after cascade delete').toHaveLength(0)
            }),
        ),
      ),
    )

    scenarioOutline(
      'Should_Return404_When_<op>_OnNonExistentSubscription',
      notFoundCases,
      ({ op: _op, fn }) =>
        scope.pipe(
          Given('no subscription exists')(() => Effect.void),
          When('performing operation on non-existent subscription')(
            'res',
            () =>
              Effect.gen(function*() {
                const client = yield* makeClient
                const token = yield* Effect.promise(() => signTestToken(SENDER_PUBKEY))
                const res = yield* Effect.promise(() => fn(client, token))
                return res
              }),
          ),
          Then('should return 404')(({ res }) => {
            expect(res.status, 'Should return 404').toBe(404)
          }),
        ),
    )

    scenario(
      'Should_AddRules_When_RulesProvided',
      scope.pipe(
        Given('a subscription exists')(() => Effect.void),
        When('adding 2 rules')(
          'res',
          () =>
            Effect.gen(function*() {
              const client = yield* makeClient
              const token = yield* Effect.promise(() => signTestToken(SENDER_PUBKEY))
              // Create subscription
              const { id } = yield* Effect.promise(() => createSubscription(client, token, 'apns', 'tok'))
              // Add 2 rules
              const res = yield* Effect.promise(() =>
                client.subscriptions.rules.$post(
                  {
                    json: {
                      subscription_id: id,
                      rules: [
                        { senderPubkey: SENDER_PUBKEY, topic: TOPIC },
                        { senderPubkey: OTHER_PUBKEY, topic: OTHER_TOPIC },
                      ],
                    },
                  },
                  { headers: { Authorization: `Bearer ${token}` } },
                )
              )
              return res
            }),
        ),
        Then('should return 201 with added=2, total=2')(
          ({ res }) =>
            Effect.gen(function*() {
              checkResponse(res, 201)
              const json = yield* Effect.promise(() => res.json())
              expectRulesOperationResponse(json)
              expect.soft(json, 'Should add 2 rules').toMatchObject({ added: 2, total: 2 })
            }),
        ),
      ),
    )

    scenarioOutline(
      'Should_Return400_When_<desc>',
      invalidRuleCases,
      ({ desc: _desc, body, rule }) =>
        scope.pipe(
          Given('a subscription exists')(() => Effect.void),
          When('adding rules with invalid payload')(
            'res',
            () =>
              Effect.gen(function*() {
                const client = yield* makeClient
                const token = yield* Effect.promise(() => signTestToken(SENDER_PUBKEY))
                const { id } = yield* Effect.promise(() => createSubscription(client, token, 'apns', 'tok'))
                const json = rule
                  ? {
                    subscription_id: id,
                    rules: [
                      { senderPubkey: rule.senderPubkey, topic: rule.topic } as { senderPubkey: string; topic: string },
                    ],
                  }
                  : {
                    subscription_id: body.subscription_id,
                    rules: body.rules as { senderPubkey: string; topic: string }[],
                  }
                const res = yield* Effect.promise(() => (client.subscriptions.rules.$post(
                  { json },
                  { headers: { Authorization: `Bearer ${token}` } },
                ) as Promise<Response>))
                return res
              }),
          ),
          Then('should return 400')(({ res }) => {
            expect(res.status, 'Invalid rule payload should be rejected').toBe(400)
          }),
          And('response content-type should be problem+json')(({ res }) => {
            expect(res.headers.get('content-type')).toBe('application/problem+json')
          }),
        ),
    )

    scenario(
      'Should_DeleteMatchingRules_When_RulesSpecified',
      scope.pipe(
        Given('a subscription exists with 2 rules')(() => Effect.void),
        When('deleting 1 of 2 rules')(
          'res',
          () =>
            Effect.gen(function*() {
              const client = yield* makeClient
              const token = yield* Effect.promise(() => signTestToken(SENDER_PUBKEY))
              // Create subscription
              const { id } = yield* Effect.promise(() => createSubscription(client, token, 'apns', 'tok'))
              // Add 2 rules
              yield* Effect.promise(() =>
                client.subscriptions.rules.$post(
                  {
                    json: {
                      subscription_id: id,
                      rules: [
                        { senderPubkey: SENDER_PUBKEY, topic: TOPIC },
                        { senderPubkey: OTHER_PUBKEY, topic: OTHER_TOPIC },
                      ],
                    },
                  },
                  { headers: { Authorization: `Bearer ${token}` } },
                )
              )
              // Delete 1 rule
              const res = yield* Effect.promise(() =>
                client.subscriptions.rules.$delete(
                  {
                    json: {
                      subscription_id: id,
                      rules: [{ senderPubkey: SENDER_PUBKEY, topic: TOPIC }],
                    },
                  },
                  { headers: { Authorization: `Bearer ${token}` } },
                )
              )
              return res
            }),
        ),
        Then('should return 200 with removed=1, total=1')(
          ({ res }) =>
            Effect.gen(function*() {
              checkResponse(res, 200)
              const json = yield* Effect.promise(() => res.json())
              expectRulesOperationResponse(json)
              expect.soft(json, 'Should delete 1 rule').toMatchObject({ removed: 1, total: 1 })
            }),
        ),
      ),
    )

    scenario(
      'Should_ReturnZero_When_DeletingEmptyRules',
      scope.pipe(
        Given('a subscription exists')(() => Effect.void),
        When('deleting with empty rules array')(
          'res',
          () =>
            Effect.gen(function*() {
              const client = yield* makeClient
              const token = yield* Effect.promise(() => signTestToken(SENDER_PUBKEY))
              // Create subscription
              const { id } = yield* Effect.promise(() => createSubscription(client, token, 'apns', 'tok'))
              // Delete with empty rules
              const res = yield* Effect.promise(() =>
                client.subscriptions.rules.$delete(
                  { json: { subscription_id: id, rules: [] } },
                  { headers: { Authorization: `Bearer ${token}` } },
                )
              )
              return res
            }),
        ),
        Then('should return 400')(({ res }) => {
          expect(res.status, 'Empty rules should be rejected').toBe(400)
        }),
        And('response content-type should be problem+json')(({ res }) => {
          expect(res.headers.get('content-type')).toBe('application/problem+json')
        }),
      ),
    )

    scenario(
      'Should_ReplaceAllRules_When_NewRulesProvided',
      scope.pipe(
        Given('a subscription exists with 1 rule')(() => Effect.void),
        When('replacing all rules with 1 new rule')(
          'res',
          () =>
            Effect.gen(function*() {
              const client = yield* makeClient
              const token = yield* Effect.promise(() => signTestToken(SENDER_PUBKEY))
              // Create subscription
              const { id } = yield* Effect.promise(() => createSubscription(client, token, 'apns', 'tok'))
              // Add 1 rule
              yield* Effect.promise(() =>
                client.subscriptions.rules.$post(
                  {
                    json: {
                      subscription_id: id,
                      rules: [{ senderPubkey: SENDER_PUBKEY, topic: TOPIC }],
                    },
                  },
                  { headers: { Authorization: `Bearer ${token}` } },
                )
              )
              // Replace with new rule
              const res = yield* Effect.promise(() =>
                client.subscriptions.rules.$put(
                  {
                    json: {
                      subscription_id: id,
                      rules: [{ senderPubkey: OTHER_PUBKEY, topic: OTHER_TOPIC }],
                    },
                  },
                  { headers: { Authorization: `Bearer ${token}` } },
                )
              )
              return res
            }),
        ),
        Then('should return 204 with no body')(
          ({ res }) =>
            Effect.gen(function*() {
              checkResponse(res, 204)
              const text = yield* Effect.promise(() => res.text())
              expect.soft(text, 'Should have empty body').toBe('')
            }),
        ),
      ),
    )

    scenario(
      'Should_Return400_When_ReplacingWithEmpty',
      scope.pipe(
        Given('a subscription exists with 1 rule')(() => Effect.void),
        When('replacing all rules with empty array')(
          'res',
          () =>
            Effect.gen(function*() {
              const client = yield* makeClient
              const token = yield* Effect.promise(() => signTestToken(SENDER_PUBKEY))
              // Create subscription
              const { id } = yield* Effect.promise(() => createSubscription(client, token, 'apns', 'tok'))
              // Add 1 rule
              yield* Effect.promise(() =>
                client.subscriptions.rules.$post(
                  {
                    json: {
                      subscription_id: id,
                      rules: [{ senderPubkey: SENDER_PUBKEY, topic: TOPIC }],
                    },
                  },
                  { headers: { Authorization: `Bearer ${token}` } },
                )
              )
              // Replace with empty
              const res = yield* Effect.promise(() =>
                client.subscriptions.rules.$put(
                  { json: { subscription_id: id, rules: [] } },
                  { headers: { Authorization: `Bearer ${token}` } },
                )
              )
              return res
            }),
        ),
        Then('should return 400')(({ res }) => {
          expect(res.status, 'Empty rules replacement should be rejected').toBe(400)
        }),
        And('response content-type should be problem+json')(({ res }) => {
          expect(res.headers.get('content-type')).toBe('application/problem+json')
        }),
      ),
    )

    scenario(
      'Should_ReturnRulesInResponse_When_FullRoundTrip',
      scope.pipe(
        Given('a subscription exists with 1 rule')(() => Effect.void),
        When('getting the subscription')(
          'getRes',
          () =>
            Effect.gen(function*() {
              const client = yield* makeClient
              const token = yield* Effect.promise(() => signTestToken(SENDER_PUBKEY))
              // Create subscription
              const { id } = yield* Effect.promise(() => createSubscription(client, token, 'apns', 'tok'))
              // Add 1 rule
              yield* Effect.promise(() =>
                client.subscriptions.rules.$post(
                  {
                    json: {
                      subscription_id: id,
                      rules: [{ senderPubkey: SENDER_PUBKEY, topic: TOPIC }],
                    },
                  },
                  { headers: { Authorization: `Bearer ${token}` } },
                )
              )
              // Get subscription
              const res = yield* Effect.promise(() =>
                client.subscriptions.$get({}, { headers: { Authorization: `Bearer ${token}` } })
              )
              return res
            }),
        ),
        Then('should return 200 with correct fields')(
          ({ getRes }) =>
            Effect.gen(function*() {
              checkResponse(getRes, 200)
              const json = yield* Effect.promise(() => getRes.json() as Promise<unknown>)
              const subs = parseSubscriptionList(json)
              expect(subs, 'Should be array').toHaveLength(1)
              const sub = subs[0]!
              expect.soft(sub, 'Should have correct notificationType').toMatchObject({ notificationType: 'apns' })
              expect.soft(sub.rules, 'Should have 1 rule').toHaveLength(1)
              const rule = sub.rules[0]!
              expect.soft(rule, 'Rule should have correct fields').toMatchObject({
                senderPubkey: SENDER_PUBKEY,
                topic: TOPIC,
              })
              expect.soft(rule.id, 'Rule should have id').toBeDefined()
              expect.soft(rule.subscriptionId, 'Rule should have subscriptionId').toBeDefined()
            }),
        ),
      ),
    )

    scenario(
      'Should_IgnoreDuplicate_When_SameRuleAddedTwice',
      scope.pipe(
        Given('a subscription exists')(() => Effect.void),
        When('adding a rule for the first time')(
          'firstRes',
          () =>
            Effect.gen(function*() {
              const client = yield* makeClient
              const token = yield* Effect.promise(() => signTestToken(SENDER_PUBKEY))
              // Create subscription
              const { id } = yield* Effect.promise(() => createSubscription(client, token, 'apns', 'tok'))
              // Add rule first time
              const res = yield* Effect.promise(() =>
                client.subscriptions.rules.$post(
                  {
                    json: {
                      subscription_id: id,
                      rules: [{ senderPubkey: SENDER_PUBKEY, topic: TOPIC }],
                    },
                  },
                  { headers: { Authorization: `Bearer ${token}` } },
                )
              )
              return res
            }),
        ),
        Then('first add should return 201 with added=1, total=1')(
          ({ firstRes }) =>
            Effect.gen(function*() {
              checkResponse(firstRes, 201)
              const json = yield* Effect.promise(() => firstRes.json())
              expectRulesOperationResponse(json)
              expect.soft(json, 'First add should succeed').toMatchObject({ added: 1, total: 1 })
            }),
        ),
        When('adding the same rule again')(
          'secondRes',
          () =>
            Effect.gen(function*() {
              const client = yield* makeClient
              const token = yield* Effect.promise(() => signTestToken(SENDER_PUBKEY))
              // Get the subscription id
              const getRes = yield* Effect.promise(() =>
                client.subscriptions.$get({}, { headers: { Authorization: `Bearer ${token}` } })
              )
              const subsJson = yield* Effect.promise(() => getRes.json() as Promise<unknown>)
              const subs = parseSubscriptionList(subsJson)
              const id = subs[0]!.id
              const res = yield* Effect.promise(() =>
                client.subscriptions.rules.$post(
                  {
                    json: {
                      subscription_id: id,
                      rules: [{ senderPubkey: SENDER_PUBKEY, topic: TOPIC }],
                    },
                  },
                  { headers: { Authorization: `Bearer ${token}` } },
                )
              )
              return res
            }),
        ),
        Then('second add should return 201 with added=0, total=1')(
          ({ secondRes }) =>
            Effect.gen(function*() {
              checkResponse(secondRes, 201)
              const json = yield* Effect.promise(() => secondRes.json())
              expectRulesOperationResponse(json)
              expect.soft(json, 'Duplicate rule should return added=0').toMatchObject({ added: 0, total: 1 })
            }),
        ),
      ),
    )

    scenario(
      'Should_ReturnZero_When_DeletingNonMatchingRules',
      scope.pipe(
        Given('a subscription exists with rule A')(() => Effect.void),
        When('deleting rule B which does not exist')(
          'res',
          () =>
            Effect.gen(function*() {
              const client = yield* makeClient
              const token = yield* Effect.promise(() => signTestToken(SENDER_PUBKEY))
              // Create subscription
              const { id } = yield* Effect.promise(() => createSubscription(client, token, 'apns', 'tok'))
              // Add rule A
              yield* Effect.promise(() =>
                client.subscriptions.rules.$post(
                  {
                    json: {
                      subscription_id: id,
                      rules: [{ senderPubkey: SENDER_PUBKEY, topic: TOPIC }],
                    },
                  },
                  { headers: { Authorization: `Bearer ${token}` } },
                )
              )
              // Delete rule B (different sender + topic)
              const res = yield* Effect.promise(() =>
                client.subscriptions.rules.$delete(
                  {
                    json: {
                      subscription_id: id,
                      rules: [{ senderPubkey: OTHER_PUBKEY, topic: OTHER_TOPIC }],
                    },
                  },
                  { headers: { Authorization: `Bearer ${token}` } },
                )
              )
              return res
            }),
        ),
        Then('should return 200 with removed=0, total=1')(
          ({ res }) =>
            Effect.gen(function*() {
              checkResponse(res, 200)
              const json = yield* Effect.promise(() => res.json())
              expectRulesOperationResponse(json)
              expect.soft(json, 'Non-matching delete should return removed=0, total=1').toMatchObject({
                removed: 0,
                total: 1,
              })
            }),
        ),
      ),
    )

    scenarioOutline(
      'Should_Return401_When_<desc>',
      authFailureCases,
      ({ desc: _desc, makeAuthHeader }) =>
        scope.pipe(
          When('creating a subscription with invalid auth')(
            'res',
            () =>
              Effect.gen(function*() {
                const client = yield* makeClient
                const token = yield* Effect.promise(() => makeAuthHeader())
                const res = yield* Effect.promise(() =>
                  client.subscriptions.$post(
                    { json: { notificationType: 'apns' as const, token: 'tok' } },
                    token === undefined ? undefined : { headers: { Authorization: `Bearer ${token}` } },
                  )
                )
                return res
              }),
          ),
          Then('should return 401')(({ res }) => {
            expect(res.status).toBe(401)
          }),
        ),
    )

    scenario(
      'Should_ReturnEmptyArray_When_GetWithNoSubscriptions',
      scope.pipe(
        When('getting subscriptions for a client with none')(
          'res',
          () =>
            Effect.gen(function*() {
              const client = yield* makeClient
              const token = yield* Effect.promise(() => signTestToken(SENDER_PUBKEY))
              return yield* Effect.promise(() =>
                client.subscriptions.$get({}, { headers: { Authorization: `Bearer ${token}` } })
              )
            }),
        ),
        Then('should return 200 with empty array')(
          ({ res }) =>
            Effect.gen(function*() {
              checkResponse(res, 200)
              const json = yield* Effect.promise(() => res.json() as Promise<unknown>)
              const subs = parseSubscriptionList(json)
              expect(subs).toHaveLength(0)
            }),
        ),
      ),
    )

    scenario(
      'Should_IsolateReadsByJwtSub_When_MultipleClientsHaveSubscriptions',
      scope.pipe(
        When('creating subscriptions for two distinct clients')(() =>
          Effect.gen(function*() {
            const client = yield* makeClient
            const tokenA = yield* Effect.promise(() => signTestToken(SENDER_PUBKEY))
            const tokenB = yield* Effect.promise(() => signTestToken(SECOND_CLIENT_PUBKEY))
            yield* Effect.promise(() => createSubscription(client, tokenA, 'apns', 'a-client-token'))
            yield* Effect.promise(() => createSubscription(client, tokenB, 'apns', 'b-client-token'))
          })
        ),
        Then('client A should only see client A rows')(() =>
          Effect.gen(function*() {
            const client = yield* makeClient
            const tokenA = yield* Effect.promise(() => signTestToken(SENDER_PUBKEY))
            const res = yield* Effect.promise(() =>
              client.subscriptions.$get({}, { headers: { Authorization: `Bearer ${tokenA}` } })
            )
            checkResponse(res, 200)
            const json = yield* Effect.promise(() => res.json() as Promise<unknown>)
            const subs = parseSubscriptionList(json)
            expect(subs).toHaveLength(1)
            expect(subs[0]?.token).toBe('a-client-token')
          })
        ),
      ),
    )

    scenario(
      'Should_DisplaceOldOwner_When_DifferentClientReusesTheSameToken',
      scope.pipe(
        Given('Bob registered for APNs notifications with token "shared-device-token"')(
          'first',
          () =>
            Effect.gen(function*() {
              const client = yield* makeClient
              const tokenA = yield* Effect.promise(() => signTestToken(SENDER_PUBKEY))
              return yield* Effect.promise(() =>
                client.subscriptions.$post(
                  { json: { notificationType: 'apns', token: 'shared-token' } },
                  { headers: { Authorization: `Bearer ${tokenA}` } },
                )
              )
            }),
        ),
        And('Bob is subscribed to APNs notifications')(({ first }) => {
          checkResponse(first, 201)
        }),
        When('Alice registers for APNs notifications with token "shared-device-token"')(
          'second',
          () =>
            Effect.gen(function*() {
              const client = yield* makeClient
              const tokenB = yield* Effect.promise(() => signTestToken(SECOND_CLIENT_PUBKEY))
              return yield* Effect.promise(() =>
                client.subscriptions.$post(
                  { json: { notificationType: 'apns', token: 'shared-token' } },
                  { headers: { Authorization: `Bearer ${tokenB}` } },
                )
              )
            }),
        ),
        Then('Alice is subscribed to APNs notifications with that token')(
          ({ second }) =>
            Effect.gen(function*() {
              checkResponse(second, 201)
              const client = yield* makeClient
              const tokenB = yield* Effect.promise(() => signTestToken(SECOND_CLIENT_PUBKEY))
              const resB = yield* Effect.promise(() =>
                client.subscriptions.$get({}, { headers: { Authorization: `Bearer ${tokenB}` } })
              )
              checkResponse(resB, 200)
              const subsB = parseSubscriptionList(yield* Effect.promise(() => resB.json() as Promise<unknown>))
              expect.soft(subsB).toHaveLength(1)
              expect.soft(subsB[0]?.token).toBe('shared-token')
              expect.soft(subsB[0]?.notificationType).toBe('apns')
            }),
        ),
        And('Bob is no longer subscribed to APNs notifications')(
          () =>
            Effect.gen(function*() {
              const client = yield* makeClient
              const tokenA = yield* Effect.promise(() => signTestToken(SENDER_PUBKEY))
              const resA = yield* Effect.promise(() =>
                client.subscriptions.$get({}, { headers: { Authorization: `Bearer ${tokenA}` } })
              )
              checkResponse(resA, 200)
              const subsA = parseSubscriptionList(yield* Effect.promise(() => resA.json() as Promise<unknown>))
              expect.soft(subsA).toHaveLength(0)
            }),
        ),
      ),
    )

    scenario(
      'Should_DisplaceOldOwner_When_DifferentClientReusesTheSameTokenUnderAnotherType',
      scope.pipe(
        Given('Bob registered for APNs notifications with token "cross-type-token"')(
          'first',
          () =>
            Effect.gen(function*() {
              const client = yield* makeClient
              const tokenA = yield* Effect.promise(() => signTestToken(SENDER_PUBKEY))
              return yield* Effect.promise(() =>
                client.subscriptions.$post(
                  { json: { notificationType: 'apns', token: 'cross-client-type-token' } },
                  { headers: { Authorization: `Bearer ${tokenA}` } },
                )
              )
            }),
        ),
        And('Bob is subscribed to APNs notifications')(({ first }) => {
          checkResponse(first, 201)
        }),
        When('Alice registers for VoIP notifications with token "cross-type-token"')(
          'second',
          () =>
            Effect.gen(function*() {
              const client = yield* makeClient
              const tokenB = yield* Effect.promise(() => signTestToken(SECOND_CLIENT_PUBKEY))
              return yield* Effect.promise(() =>
                client.subscriptions.$post(
                  { json: { notificationType: 'voip', token: 'cross-client-type-token' } },
                  { headers: { Authorization: `Bearer ${tokenB}` } },
                )
              )
            }),
        ),
        Then('Alice is subscribed to VoIP notifications with that token')(
          ({ second }) =>
            Effect.gen(function*() {
              checkResponse(second, 201)
              const client = yield* makeClient
              const tokenB = yield* Effect.promise(() => signTestToken(SECOND_CLIENT_PUBKEY))
              const resB = yield* Effect.promise(() =>
                client.subscriptions.$get({}, { headers: { Authorization: `Bearer ${tokenB}` } })
              )
              checkResponse(resB, 200)
              const subsB = parseSubscriptionList(yield* Effect.promise(() => resB.json() as Promise<unknown>))
              expect.soft(subsB).toHaveLength(1)
              expect.soft(subsB[0]?.token).toBe('cross-client-type-token')
              expect.soft(subsB[0]?.notificationType).toBe('voip')
            }),
        ),
        And('Bob is no longer subscribed to APNs notifications')(
          () =>
            Effect.gen(function*() {
              const client = yield* makeClient
              const tokenA = yield* Effect.promise(() => signTestToken(SENDER_PUBKEY))
              const resA = yield* Effect.promise(() =>
                client.subscriptions.$get({}, { headers: { Authorization: `Bearer ${tokenA}` } })
              )
              checkResponse(resA, 200)
              const subsA = parseSubscriptionList(yield* Effect.promise(() => resA.json() as Promise<unknown>))
              expect.soft(subsA).toHaveLength(0)
            }),
        ),
      ),
    )

    scenario(
      'Should_StaySubscribedToBothTypes_When_SameClientAddsAnotherTypeWithSameToken',
      scope.pipe(
        Given('Alice registered for APNs notifications with token "shared-token"')(
          'first',
          () =>
            Effect.gen(function*() {
              const client = yield* makeClient
              const token = yield* Effect.promise(() => signTestToken(SENDER_PUBKEY))
              return yield* Effect.promise(() =>
                client.subscriptions.$post(
                  { json: { notificationType: 'apns', token: 'cross-type-token' } },
                  { headers: { Authorization: `Bearer ${token}` } },
                )
              )
            }),
        ),
        And('Alice is subscribed to APNs notifications')(({ first }) => {
          checkResponse(first, 201)
        }),
        When('Alice registers for VoIP notifications with token "shared-token"')(
          'second',
          () =>
            Effect.gen(function*() {
              const client = yield* makeClient
              const token = yield* Effect.promise(() => signTestToken(SENDER_PUBKEY))
              return yield* Effect.promise(() =>
                client.subscriptions.$post(
                  { json: { notificationType: 'voip', token: 'cross-type-token' } },
                  { headers: { Authorization: `Bearer ${token}` } },
                )
              )
            }),
        ),
        Then('Alice is subscribed to both APNs and VoIP notifications with that token')(
          ({ second }) =>
            Effect.gen(function*() {
              checkResponse(second, 201)
              const client = yield* makeClient
              const token = yield* Effect.promise(() => signTestToken(SENDER_PUBKEY))
              const res = yield* Effect.promise(() =>
                client.subscriptions.$get({}, { headers: { Authorization: `Bearer ${token}` } })
              )
              checkResponse(res, 200)
              const subs = parseSubscriptionList(yield* Effect.promise(() => res.json() as Promise<unknown>))
              expect.soft(subs).toHaveLength(2)
              const types = subs.map((s) => s.notificationType).sort()
              expect.soft(types).toEqual(['apns', 'voip'])
              expect.soft(subs.every((s) => s.token === 'cross-type-token')).toBe(true)
            }),
        ),
      ),
    )

    scenario(
      'Should_RotateToken_When_SameClientReregistersUnderSameType',
      scope.pipe(
        Given('Alice registered for APNs notifications with token "old-token"')(
          'first',
          () =>
            Effect.gen(function*() {
              const client = yield* makeClient
              const token = yield* Effect.promise(() => signTestToken(SENDER_PUBKEY))
              return yield* Effect.promise(() =>
                client.subscriptions.$post(
                  { json: { notificationType: 'apns' as const, token: 'rotate-old' } },
                  { headers: { Authorization: `Bearer ${token}` } },
                )
              )
            }),
        ),
        And('Alice is subscribed to APNs notifications with the old token')(({ first }) => {
          checkResponse(first, 201)
        }),
        When('Alice registers for APNs notifications with token "new-token"')(
          'second',
          () =>
            Effect.gen(function*() {
              const client = yield* makeClient
              const token = yield* Effect.promise(() => signTestToken(SENDER_PUBKEY))
              return yield* Effect.promise(() =>
                client.subscriptions.$post(
                  { json: { notificationType: 'apns' as const, token: 'rotate-new' } },
                  { headers: { Authorization: `Bearer ${token}` } },
                )
              )
            }),
        ),
        Then('Alice is subscribed to APNs notifications with the new token')(
          ({ second }) =>
            Effect.gen(function*() {
              expect(second.status).toBe(200)
              const client = yield* makeClient
              const token = yield* Effect.promise(() => signTestToken(SENDER_PUBKEY))
              const res = yield* Effect.promise(() =>
                client.subscriptions.$get({}, { headers: { Authorization: `Bearer ${token}` } })
              )
              checkResponse(res, 200)
              const subs = parseSubscriptionList(yield* Effect.promise(() => res.json() as Promise<unknown>))
              expect.soft(subs).toHaveLength(1)
              expect.soft(subs[0]?.token).toBe('rotate-new')
            }),
        ),
      ),
    )

    scenario(
      'Should_LoseOwnedNotificationsAndRules_When_OwnerIsDisplaced',
      scope.pipe(
        Given('Bob registered for APNs notifications with token "cascade-token"')(
          'subId',
          () =>
            Effect.gen(function*() {
              const client = yield* makeClient
              const tokenA = yield* Effect.promise(() => signTestToken(SENDER_PUBKEY))
              const { id } = yield* Effect.promise(() => createSubscription(client, tokenA, 'apns', 'cascade-token'))
              yield* Effect.promise(() =>
                client.subscriptions.rules.$post(
                  {
                    json: {
                      subscription_id: id,
                      rules: [{ senderPubkey: SENDER_PUBKEY, topic: TOPIC }],
                    },
                  },
                  { headers: { Authorization: `Bearer ${tokenA}` } },
                )
              )
              const db = yield* DB
              yield* Effect.tryPromise(() =>
                db.insert(schema.pushRecord).values({
                  subscriptionId: id,
                  statementHash: 'cascade-statement-hash',
                  senderPubkey: SENDER_PUBKEY,
                  topic: TOPIC,
                  notifyType: 'apns',
                  deliveryChannel: 'apns',
                })
              )
              yield* Effect.tryPromise(() =>
                db.insert(schema.failedPushRecord).values({
                  subscriptionId: id,
                  statementHash: 'cascade-failed-hash',
                  senderPubkey: SENDER_PUBKEY,
                  topic: TOPIC,
                  notifyType: 'apns',
                  deliveryChannel: 'apns',
                  retryable: false,
                })
              )
              return id
            }),
        ),
        And('Bob has a notification rule and a delivered notification on that subscription')(
          () => Effect.void,
        ),
        When('Alice registers for APNs notifications with token "cascade-token"')(
          'displace',
          () =>
            Effect.gen(function*() {
              const client = yield* makeClient
              const tokenB = yield* Effect.promise(() => signTestToken(SECOND_CLIENT_PUBKEY))
              return yield* Effect.promise(() =>
                client.subscriptions.$post(
                  { json: { notificationType: 'apns' as const, token: 'cascade-token' } },
                  { headers: { Authorization: `Bearer ${tokenB}` } },
                )
              )
            }),
        ),
        Then("Bob's subscription, notification rule, and delivered notifications are forgotten")(
          ({ subId, displace }) =>
            Effect.gen(function*() {
              checkResponse(displace, 201)
              const db = yield* DB
              const subs = yield* Effect.tryPromise(() =>
                db.select().from(schema.pushSubscription)
                  .where(eq(schema.pushSubscription.id, subId))
              )
              const rules = yield* Effect.tryPromise(() =>
                db.select().from(schema.subscriptionRule)
                  .where(eq(schema.subscriptionRule.subscriptionId, subId))
              )
              const pushRecords = yield* Effect.tryPromise(() =>
                db.select().from(schema.pushRecord)
                  .where(eq(schema.pushRecord.subscriptionId, subId))
              )
              const failedPushRecords = yield* Effect.tryPromise(() =>
                db.select().from(schema.failedPushRecord)
                  .where(eq(schema.failedPushRecord.subscriptionId, subId))
              )
              expect.soft(subs).toHaveLength(0)
              expect.soft(rules).toHaveLength(0)
              expect.soft(pushRecords).toHaveLength(0)
              expect.soft(failedPushRecords).toHaveLength(0)
            }),
        ),
      ),
    )

    scenarioOutline(
      'Should_Return404_When_<op>_AgainstForeignSubscription',
      foreignOwnershipRuleOps,
      ({ op: _op, run }) =>
        scope.pipe(
          Given('a subscription exists for another client')(
            'foreignSubId',
            () =>
              Effect.gen(function*() {
                const client = yield* makeClient
                const tokenB = yield* Effect.promise(() => signTestToken(SECOND_CLIENT_PUBKEY))
                const { id } = yield* Effect.promise(() => createSubscription(client, tokenB, 'apns', 'foreign-token'))
                return id
              }),
          ),
          When('client A performs rule operation on foreign subscription')(
            'res',
            ({ foreignSubId }) =>
              Effect.gen(function*() {
                const client = yield* makeClient
                const tokenA = yield* Effect.promise(() => signTestToken(SENDER_PUBKEY))
                return yield* Effect.promise(() => run(client, tokenA, foreignSubId))
              }),
          ),
          Then('operation should return 404')(({ res }) => {
            expect(res.status).toBe(404)
          }),
        ),
    )

    scenario(
      'Should_IgnoreForeignDeletion_When_DeletingForeignSubscription',
      scope.pipe(
        Given('a foreign subscription exists')(
          'foreignSubId',
          () =>
            Effect.gen(function*() {
              const client = yield* makeClient
              const tokenB = yield* Effect.promise(() => signTestToken(SECOND_CLIENT_PUBKEY))
              const { id } = yield* Effect.promise(() => createSubscription(client, tokenB, 'apns', 'foreign-delete'))
              return id
            }),
        ),
        When('client A attempts deletion')(
          'deleteRes',
          ({ foreignSubId }) =>
            Effect.gen(function*() {
              const client = yield* makeClient
              const tokenA = yield* Effect.promise(() => signTestToken(SENDER_PUBKEY))
              return yield* Effect.promise(() =>
                client.subscriptions.$delete(
                  { json: { subscription_ids: [foreignSubId] } },
                  { headers: { Authorization: `Bearer ${tokenA}` } },
                )
              )
            }),
        ),
        Then('delete should return 204 and foreign row remains')(
          ({ deleteRes }) =>
            Effect.gen(function*() {
              expect(deleteRes.status).toBe(204)
              const client = yield* makeClient
              const tokenB = yield* Effect.promise(() => signTestToken(SECOND_CLIENT_PUBKEY))
              const getRes = yield* Effect.promise(() =>
                client.subscriptions.$get({}, { headers: { Authorization: `Bearer ${tokenB}` } })
              )
              checkResponse(getRes, 200)
              const json = yield* Effect.promise(() => getRes.json() as Promise<unknown>)
              const subs = parseSubscriptionList(json)
              expect(subs).toHaveLength(1)
            }),
        ),
      ),
    )

    scenario(
      'Should_DeleteMultipleSubscriptions_When_MultipleIdsProvided',
      scope.pipe(
        When('creating two subscriptions and deleting both ids in one request')(
          'deleteRes',
          () =>
            Effect.gen(function*() {
              const client = yield* makeClient
              const token = yield* Effect.promise(() => signTestToken(SENDER_PUBKEY))
              const { id: id1 } = yield* Effect.promise(() => createSubscription(client, token, 'apns', 'bulk-a'))
              const { id: id2 } = yield* Effect.promise(() => createSubscription(client, token, 'voip', 'bulk-b'))
              return yield* Effect.promise(() =>
                client.subscriptions.$delete(
                  { json: { subscription_ids: [id1, id2] } },
                  { headers: { Authorization: `Bearer ${token}` } },
                )
              )
            }),
        ),
        Then('delete should return 204 and list becomes empty')(
          ({ deleteRes }) =>
            Effect.gen(function*() {
              expect(deleteRes.status).toBe(204)
              const client = yield* makeClient
              const token = yield* Effect.promise(() => signTestToken(SENDER_PUBKEY))
              const getRes = yield* Effect.promise(() =>
                client.subscriptions.$get({}, { headers: { Authorization: `Bearer ${token}` } })
              )
              checkResponse(getRes, 200)
              const json = yield* Effect.promise(() => getRes.json() as Promise<unknown>)
              const subs = parseSubscriptionList(json)
              expect(subs).toHaveLength(0)
            }),
        ),
      ),
    )

    scenario(
      'Should_Return400_When_DeletingWithEmptySubscriptionIds',
      scope.pipe(
        When('deleting with empty id list')(
          'res',
          () =>
            Effect.gen(function*() {
              const client = yield* makeClient
              const token = yield* Effect.promise(() => signTestToken(SENDER_PUBKEY))
              return yield* Effect.promise(() =>
                client.subscriptions.$delete(
                  { json: { subscription_ids: [] } },
                  { headers: { Authorization: `Bearer ${token}` } },
                )
              )
            }),
        ),
        Then('should return 400')(({ res }) => {
          expect(res.status).toBe(400)
        }),
      ),
    )

    scenario(
      'Should_ReplaceRulesAtomically_When_PutCalledTwiceWithDifferentSets',
      scope.pipe(
        Given('a subscription exists with an initial rule set')(
          'subscriptionId',
          () =>
            Effect.gen(function*() {
              const client = yield* makeClient
              const token = yield* Effect.promise(() => signTestToken(SENDER_PUBKEY))
              const { id } = yield* Effect.promise(() => createSubscription(client, token, 'apns', 'atomic-token'))
              yield* Effect.promise(() =>
                client.subscriptions.rules.$put(
                  {
                    json: {
                      subscription_id: id,
                      rules: [
                        { senderPubkey: SENDER_PUBKEY, topic: TOPIC },
                        { senderPubkey: OTHER_PUBKEY, topic: OTHER_TOPIC },
                      ],
                    },
                  },
                  { headers: { Authorization: `Bearer ${token}` } },
                )
              )
              return id
            }),
        ),
        When('replacing with a new single-rule set')(
          ({ subscriptionId }) =>
            Effect.gen(function*() {
              const client = yield* makeClient
              const token = yield* Effect.promise(() => signTestToken(SENDER_PUBKEY))
              const putRes = yield* Effect.promise(() =>
                client.subscriptions.rules.$put(
                  {
                    json: {
                      subscription_id: subscriptionId,
                      rules: [{ senderPubkey: SENDER_PUBKEY, topic: OTHER_TOPIC }],
                    },
                  },
                  { headers: { Authorization: `Bearer ${token}` } },
                )
              )
              expect(putRes.status).toBe(204)
            }),
        ),
        Then('get should show only the new rule set')(
          () =>
            Effect.gen(function*() {
              const client = yield* makeClient
              const token = yield* Effect.promise(() => signTestToken(SENDER_PUBKEY))
              const getRes = yield* Effect.promise(() =>
                client.subscriptions.$get({}, { headers: { Authorization: `Bearer ${token}` } })
              )
              checkResponse(getRes, 200)
              const json = yield* Effect.promise(
                () => getRes.json() as Promise<Array<{ rules: unknown }>>,
              )
              expect(json).toEqual(expect.schemaMatching(SubscriptionListSchema))
              expect(json).toHaveLength(1)
              const normalizedRules = RuleListSchema.parse(json[0]?.rules).map((r) => ({
                senderPubkey: r.senderPubkey,
                topic: r.topic,
              }))
              expect(normalizedRules).toEqual([
                { senderPubkey: SENDER_PUBKEY, topic: OTHER_TOPIC },
              ])
            }),
        ),
      ),
    )

    scenario(
      'Should_HandleDuplicateRulesWithinSinglePostRequest',
      scope.pipe(
        When('posting duplicate rules in one request')(
          'res',
          () =>
            Effect.gen(function*() {
              const client = yield* makeClient
              const token = yield* Effect.promise(() => signTestToken(SENDER_PUBKEY))
              const { id } = yield* Effect.promise(() => createSubscription(client, token, 'apns', 'dup-post-token'))
              return yield* Effect.promise(() =>
                client.subscriptions.rules.$post(
                  {
                    json: {
                      subscription_id: id,
                      rules: [
                        { senderPubkey: SENDER_PUBKEY, topic: TOPIC },
                        { senderPubkey: SENDER_PUBKEY, topic: TOPIC },
                      ],
                    },
                  },
                  { headers: { Authorization: `Bearer ${token}` } },
                )
              )
            }),
        ),
        Then('operation should keep only one distinct rule')(
          ({ res }) =>
            Effect.gen(function*() {
              checkResponse(res, 201)
              const json = yield* Effect.promise(() => res.json() as Promise<{ added: number; total: number }>)
              expectRulesOperationResponse(json)
              expect(json).toMatchObject({ added: 1, total: 1 })
            }),
        ),
      ),
    )

    scenario(
      'Should_HandleDuplicateRulesWithinSinglePutRequest',
      scope.pipe(
        Given('a subscription exists')(
          'subscriptionId',
          () =>
            Effect.gen(function*() {
              const client = yield* makeClient
              const token = yield* Effect.promise(() => signTestToken(SENDER_PUBKEY))
              const { id } = yield* Effect.promise(() => createSubscription(client, token, 'apns', 'dup-put-token'))
              return id
            }),
        ),
        When('putting duplicate rules in one request')(
          'putRes',
          ({ subscriptionId }) =>
            Effect.gen(function*() {
              const client = yield* makeClient
              const token = yield* Effect.promise(() => signTestToken(SENDER_PUBKEY))
              return yield* Effect.promise(() =>
                client.subscriptions.rules.$put(
                  {
                    json: {
                      subscription_id: subscriptionId,
                      rules: [
                        { senderPubkey: SENDER_PUBKEY, topic: TOPIC },
                        { senderPubkey: SENDER_PUBKEY, topic: TOPIC },
                      ],
                    },
                  },
                  { headers: { Authorization: `Bearer ${token}` } },
                )
              )
            }),
        ),
        Then('put should succeed and keep one distinct rule')(
          ({ putRes }) =>
            Effect.gen(function*() {
              expect(putRes.status).toBe(204)
              const client = yield* makeClient
              const token = yield* Effect.promise(() => signTestToken(SENDER_PUBKEY))
              const getRes = yield* Effect.promise(() =>
                client.subscriptions.$get({}, { headers: { Authorization: `Bearer ${token}` } })
              )
              checkResponse(getRes, 200)
              const json = yield* Effect.promise(
                () => getRes.json() as Promise<Array<{ rules: unknown }>>,
              )
              expect(json).toEqual(expect.schemaMatching(SubscriptionListSchema))
              expect(json).toHaveLength(1)
              const normalizedRules = RuleListSchema.parse(json[0]?.rules).map((r) => ({
                senderPubkey: r.senderPubkey,
                topic: r.topic,
              }))
              expect(normalizedRules).toEqual([
                { senderPubkey: SENDER_PUBKEY, topic: TOPIC },
              ])
            }),
        ),
      ),
    )

    scenario(
      'Should_ReturnBoth_When_MultipleSubscriptionsForSameClient',
      scope.pipe(
        Given('a subscription does not exist')(() => Effect.void),
        When('creating an APNs subscription')(
          'apnsRes',
          () =>
            Effect.gen(function*() {
              const client = yield* makeClient
              const token = yield* Effect.promise(() => signTestToken(SENDER_PUBKEY))
              const res = yield* Effect.promise(() =>
                client.subscriptions.$post(
                  { json: { notificationType: 'apns' as const, token: 'apns-token' } },
                  { headers: { Authorization: `Bearer ${token}` } },
                )
              )
              return res
            }),
        ),
        Then('APNs creation should return 201')(({ apnsRes }) => {
          checkResponse(apnsRes, 201)
        }),
        When('creating a VoIP subscription for the same client')(
          'voipRes',
          () =>
            Effect.gen(function*() {
              const client = yield* makeClient
              const token = yield* Effect.promise(() => signTestToken(SENDER_PUBKEY))
              const res = yield* Effect.promise(() =>
                client.subscriptions.$post(
                  { json: { notificationType: 'voip' as const, token: 'voip-token' } },
                  { headers: { Authorization: `Bearer ${token}` } },
                )
              )
              return res
            }),
        ),
        Then('VoIP creation should return 201')(({ voipRes }) => {
          checkResponse(voipRes, 201)
        }),
        When('getting all subscriptions for the client')(
          'getRes',
          () =>
            Effect.gen(function*() {
              const client = yield* makeClient
              const token = yield* Effect.promise(() => signTestToken(SENDER_PUBKEY))
              const res = yield* Effect.promise(() =>
                client.subscriptions.$get({}, { headers: { Authorization: `Bearer ${token}` } })
              )
              return res
            }),
        ),
        Then('should return 200 with both subscriptions')(
          ({ getRes }) =>
            Effect.gen(function*() {
              checkResponse(getRes, 200)
              const json = yield* Effect.promise(() => getRes.json() as Promise<unknown>)
              const subs = parseSubscriptionList(json)
              expect.soft(subs, 'Should have 2 subscriptions').toHaveLength(2)
              const ids = subs.map((s) => s.id)
              expect.soft(ids[0], 'Subscription IDs should be distinct').not.toBe(ids[1])
              const types = subs.map((s) => s.notificationType).sort()
              expect.soft(types, 'Should have apns and voip').toEqual(['apns', 'voip'])
            }),
        ),
      ),
    )
  })

// Broadcasting push notifications
//
// Personas:
//   Pat the Publisher — broadcasts with signer = SENDER_PUBKEY.
//   Eve the Outsider — JWT sub "eve", broadcasts with same signer.
//     Auth is gated by subscription rules ACL, not JWT subject.
//   Alice / Bob — subscribers who have registered for push notifications
//     from Pat on specific topics.

const TOPIC_TREASURY = '0x' + 'd'.repeat(64)

const broadcastAnnouncement = {
  signer: SENDER_PUBKEY,
  topics: [TOPIC],
  content: {
    title: 'Governance vote opens tomorrow',
    body: 'Please review RFC 42 before casting your vote.',
    deeplink: 'app://governance/rfc-42',
  },
}

const broadcastInvalidCases = [
  { field: 'a non-hex signer', body: { ...broadcastAnnouncement, signer: 'not-hex' } },
  { field: 'empty topics', body: { ...broadcastAnnouncement, topics: [] } },
  {
    field: 'an empty title',
    body: { ...broadcastAnnouncement, content: { ...broadcastAnnouncement.content, title: '' } },
  },
]

const givenSubscribedToPat = (persona: 'Alice' | 'Bob', topic: string) =>
  Effect.gen(function*() {
    const db = yield* DB
    const [sub] = yield* insertSubscription(db, { clientId: persona.toLowerCase(), notificationType: 'apns' })
    yield* insertRule(db, { subscriptionId: sub!.id, senderPubkey: SENDER_PUBKEY, topic })
  })

const givenWebSubscribedToPat = (persona: 'Alice' | 'Bob', topic: string) =>
  Effect.gen(function*() {
    const db = yield* DB
    const [sub] = yield* insertSubscription(db, {
      clientId: persona.toLowerCase(),
      notificationType: 'web',
      token: null,
      endpoint: 'https://fcm.googleapis.com/fcm/send/web-' + persona.toLowerCase(),
      p256dhKey: 'B'.repeat(87),
      authKey: 'A'.repeat(22),
      contentEncoding: 'aes128gcm' as const,
    })
    yield* insertRule(db, { subscriptionId: sub!.id, senderPubkey: SENDER_PUBKEY, topic })
  })

const deliveryChannelCases = [
  {
    desc: 'APNs',
    persona: 'Alice' as const,
    givenSetup: () => givenSubscribedToPat('Alice', TOPIC),
    deviceAssertion: () => expect(apnSend).toHaveBeenCalledTimes(1),
  },
  {
    desc: 'Web Push',
    persona: 'Alice' as const,
    givenSetup: () => givenWebSubscribedToPat('Alice', TOPIC),
    deviceAssertion: () => expect(webPushSend).toHaveBeenCalledTimes(1),
  },
]

feature('Broadcasting push notifications')
  .withLayer(sharedFileLayer)
  .withScenarioLayer(scenarioLayer)
  .withScope({})
  .body(({ scenario, scenarioOutline, background, scope }) => {
    background(
      Effect.gen(function*() {
        yield* cleanUp
        apnSend.mockClear()
        webPushSend.mockClear()
      }),
    )

    scenarioOutline(
      'Should_SucceedWithMessageHash_When_AuthorizedPublisherBroadcastsOver<desc>',
      deliveryChannelCases,
      ({ persona, givenSetup, deviceAssertion }) =>
        scope.pipe(
          Given(`${persona} has subscribed to notifications from Pat on topic "governance" via <desc>`)(
            () => givenSetup(),
          ),
          When('Pat publishes a broadcast to topic "governance"')(
            'res',
            () =>
              Effect.gen(function*() {
                const client = yield* makeClient
                const token = yield* Effect.promise(() => signTestToken('publisher'))
                return yield* Effect.promise(() =>
                  client.subscriptions.broadcast.$post(
                    { json: broadcastAnnouncement },
                    { headers: { Authorization: `Bearer ${token}` } },
                  )
                )
              }).pipe(Effect.flatMap(expectStatus(200))),
          ),
          Then('the response is 200 with a message hash')(
            ({ res }) =>
              Effect.gen(function*() {
                const json = yield* Effect.promise(() => res.json() as Promise<{ message_hash?: string }>)
                expect(json.message_hash).toMatch(/^0x[0-9a-f]{64}$/)
              }),
          ),
          And(`${persona} receives the notification on her device`)(
            () =>
              Effect.sync(() => {
                deviceAssertion()
              }),
          ),
        ),
    )

    scenario(
      'Should_Return401_When_NoJwtProvided',
      scope.pipe(
        Given('no authentication is required for setup')(() => Effect.void),
        When('an unauthenticated caller publishes a broadcast')(
          'res',
          () =>
            Effect.gen(function*() {
              const client = yield* makeClient
              return yield* Effect.promise(() => client.subscriptions.broadcast.$post({ json: broadcastAnnouncement }))
            }),
        ),
        Then('the response is 401')(({ res }) => expectStatus(401)(res)),
      ),
    )

    scenario(
      'Should_Return200_When_JwtAuthedWithNoMatchingRules',
      scope.pipe(
        Given('no authentication is required for setup')(() => Effect.void),
        When('Eve publishes a broadcast')(
          'res',
          () =>
            Effect.gen(function*() {
              const client = yield* makeClient
              const token = yield* Effect.promise(() => signTestToken('eve'))
              return yield* Effect.promise(() =>
                client.subscriptions.broadcast.$post(
                  { json: broadcastAnnouncement },
                  { headers: { Authorization: `Bearer ${token}` } },
                )
              )
            }),
        ),
        Then('the response is 200 with delivered=0')(
          ({ res }) =>
            Effect.gen(function*() {
              const status = yield* Effect.promise(() => Promise.resolve(res.status))
              expect(status).toBe(200)
              const json = yield* Effect.promise(() => res.json() as Promise<{ delivered?: number }>)
              expect(json.delivered).toBe(0)
            }),
        ),
      ),
    )

    scenarioOutline(
      'Should_Return400_When_PayloadHas<field>',
      broadcastInvalidCases,
      ({ body }) =>
        scope.pipe(
          Given('Pat is an authorized publisher')(() => Effect.void),
          When('Pat publishes a broadcast with <field>')(
            'res',
            () =>
              Effect.gen(function*() {
                const client = yield* makeClient
                const token = yield* Effect.promise(() => signTestToken('publisher'))
                return yield* Effect.promise(() =>
                  client.subscriptions.broadcast.$post(
                    { json: body },
                    { headers: { Authorization: `Bearer ${token}` } },
                  )
                )
              }),
          ),
          Then('the response is 400')(({ res }) => expectStatus(400)(res)),
        ),
    )

    scenario(
      'Should_Return200WithHash_When_NoSubscriptionsMatch',
      scope.pipe(
        Given('no subscribers have registered for push notifications')(() => Effect.void),
        When('Pat publishes a broadcast to topic "governance"')(
          'res',
          () =>
            Effect.gen(function*() {
              const client = yield* makeClient
              const token = yield* Effect.promise(() => signTestToken('publisher'))
              return yield* Effect.promise(() =>
                client.subscriptions.broadcast.$post(
                  { json: broadcastAnnouncement },
                  { headers: { Authorization: `Bearer ${token}` } },
                )
              )
            }).pipe(Effect.flatMap(expectStatus(200))),
        ),
        Then('the response is 200 with a message hash')(
          ({ res }) =>
            Effect.gen(function*() {
              const json = yield* Effect.promise(() => res.json() as Promise<{ message_hash?: string }>)
              expect(json.message_hash).toMatch(/^0x[0-9a-f]{64}$/)
            }),
        ),
        And('no notifications are delivered')(
          () =>
            Effect.sync(() => {
              expect(apnSend).not.toHaveBeenCalled()
            }),
        ),
      ),
    )

    scenario(
      'Should_DeliverOnlyToMatchingSubscribers_When_MultipleSubscriptionsExist',
      scope.pipe(
        Given('Alice has subscribed to notifications from Pat on topic "governance"')(
          () => givenSubscribedToPat('Alice', TOPIC),
        ),
        And('Bob has subscribed to notifications from Pat on topic "treasury"')(
          () => givenSubscribedToPat('Bob', TOPIC_TREASURY),
        ),
        When('Pat publishes a broadcast to topic "governance"')(
          'res',
          () =>
            Effect.gen(function*() {
              const client = yield* makeClient
              const token = yield* Effect.promise(() => signTestToken('publisher'))
              return yield* Effect.promise(() =>
                client.subscriptions.broadcast.$post(
                  { json: broadcastAnnouncement },
                  { headers: { Authorization: `Bearer ${token}` } },
                )
              )
            }).pipe(Effect.flatMap(expectStatus(200))),
        ),
        Then('the response is 200 with a message hash')(
          ({ res }) =>
            Effect.gen(function*() {
              const json = yield* Effect.promise(() => res.json() as Promise<{ message_hash?: string }>)
              expect(json.message_hash).toMatch(/^0x[0-9a-f]{64}$/)
            }),
        ),
        And('only Alice receives the notification')(
          () =>
            Effect.sync(() => {
              expect(apnSend).toHaveBeenCalledTimes(1)
            }),
        ),
      ),
    )

    scenario(
      'Should_ProduceSameHash_When_IdenticalBroadcastSentTwice',
      scope.pipe(
        Given('Alice has subscribed to notifications from Pat on topic "governance"')(
          () => givenSubscribedToPat('Alice', TOPIC),
        ),
        When('Pat publishes a broadcast to topic "governance"')(
          'firstRes',
          () =>
            Effect.gen(function*() {
              const client = yield* makeClient
              const token = yield* Effect.promise(() => signTestToken('publisher'))
              return yield* Effect.promise(() =>
                client.subscriptions.broadcast.$post(
                  { json: broadcastAnnouncement },
                  { headers: { Authorization: `Bearer ${token}` } },
                )
              )
            }).pipe(Effect.flatMap(expectStatus(200))),
        ),
        Then('the first response includes a message hash')(() => Effect.void),
        When('Pat publishes the same broadcast again')(
          'secondRes',
          () =>
            Effect.gen(function*() {
              const client = yield* makeClient
              const token = yield* Effect.promise(() => signTestToken('publisher'))
              return yield* Effect.promise(() =>
                client.subscriptions.broadcast.$post(
                  { json: broadcastAnnouncement },
                  { headers: { Authorization: `Bearer ${token}` } },
                )
              )
            }).pipe(Effect.flatMap(expectStatus(200))),
        ),
        Then('both responses return the same message hash')(
          ({ firstRes, secondRes }) =>
            Effect.gen(function*() {
              const firstJson = yield* Effect.promise(() => firstRes.json() as Promise<{ message_hash?: string }>)
              const secondJson = yield* Effect.promise(() => secondRes.json() as Promise<{ message_hash?: string }>)
              expect(secondJson.message_hash).toBe(firstJson.message_hash)
            }),
        ),
      ),
    )

    scenario(
      'Should_ProduceSameHash_When_TopicsProvidedInDifferentOrder',
      scope.pipe(
        When('Pat publishes a broadcast to topics "governance" and "treasury" in that order')(
          'firstRes',
          () =>
            Effect.gen(function*() {
              const client = yield* makeClient
              const token = yield* Effect.promise(() => signTestToken('publisher'))
              return yield* Effect.promise(() =>
                client.subscriptions.broadcast.$post(
                  { json: { ...broadcastAnnouncement, topics: [TOPIC, TOPIC_TREASURY] } },
                  { headers: { Authorization: `Bearer ${token}` } },
                )
              )
            }).pipe(Effect.flatMap(expectStatus(200))),
        ),
        Then('the first response includes a message hash')(() => Effect.void),
        When('Pat publishes a broadcast to topics "treasury" and "governance" in that order')(
          'secondRes',
          () =>
            Effect.gen(function*() {
              const client = yield* makeClient
              const token = yield* Effect.promise(() => signTestToken('publisher'))
              return yield* Effect.promise(() =>
                client.subscriptions.broadcast.$post(
                  { json: { ...broadcastAnnouncement, topics: [TOPIC_TREASURY, TOPIC] } },
                  { headers: { Authorization: `Bearer ${token}` } },
                )
              )
            }).pipe(Effect.flatMap(expectStatus(200))),
        ),
        Then('both responses return the same message hash')(
          ({ firstRes, secondRes }) =>
            Effect.gen(function*() {
              const firstJson = yield* Effect.promise(() => firstRes.json() as Promise<{ message_hash?: string }>)
              const secondJson = yield* Effect.promise(() => secondRes.json() as Promise<{ message_hash?: string }>)
              expect(secondJson.message_hash).toBe(firstJson.message_hash)
            }),
        ),
      ),
    )
  })
