import { USERNAME_DIGIT_V1_SET } from '#root/constants.js'
import { DB } from '#root/db/drizzle.js'
import * as schema from '#root/db/schema.js'
import { PriorityGroup } from '#root/username-registration/registration-queue/priority-group.schema.js'
import { And, Given, Then, When } from '@identity-backend/effect-vitest-gherkin'
import { Clock, Duration, Effect } from 'effect'
import { expect } from 'vitest'
import { generateUsernameData } from '../helpers/test-data.js'
import { insertQueueEntry } from './fixtures/insert-queue-entry.js'
import { addressFromSeed, QueueEntryBuilder } from './fixtures/queue-entry-builder.js'
import {
  cleanUpRegistrationQueue,
  enqueueRegistration,
  getRegistrationStatus,
  makeRegistrationQueueClient,
  observeRegistration,
  settleRegistrationQueueDaemon,
} from './fixtures/registration-queue-client.js'
import { feature, scenarioLayer, sharedFileLayer } from './layers.js'

const ALICE = addressFromSeed(101)
const BOB = addressFromSeed(102)
const CHARLIE = addressFromSeed(103)
const DAVE = addressFromSeed(104)

const queueEntry = (
  seed: number,
  params: {
    readonly username: string
    readonly priorityGroup: number
    readonly enqueuedAt?: Date
  },
) => {
  let builder = QueueEntryBuilder.fromSeed(seed)
    .withUsername(params.username)
    .withCandidateAccountId(addressFromSeed(seed))
    .withPriorityGroup(PriorityGroup.make(params.priorityGroup))

  if (params.enqueuedAt) {
    builder = builder.withEnqueuedAt(params.enqueuedAt)
  }

  return builder
}

const seedAllDigits = (username: string) =>
  Effect.gen(function*() {
    const db = yield* DB
    const records = USERNAME_DIGIT_V1_SET.map((digits, i) =>
      generateUsernameData({
        username,
        digits,
        network: 'polkadot',
      }, 500 + i)
    )
    yield* Effect.tryPromise(() => db.insert(schema.individualityUsernames).values(records))
  })

feature('Registration Queue Mechanics')
  .withLayer(sharedFileLayer)
  .withScenarioLayer(scenarioLayer)
  .withScope({})
  .body(({ scenario, background, scope }) => {
    background(
      Effect.gen(function*() {
        yield* cleanUpRegistrationQueue
      }),
    )

    // ═════════════════════════════════════════════════════════════════════
    // Rule: Each priority slot selects the earliest waiting person from
    // the groups eligible for that slot. Empty slots are skipped.
    // ═════════════════════════════════════════════════════════════════════

    scenario(
      'Empty higher-priority slots are skipped when the waiting list advances',
      scope.pipe(
        Given('people are waiting in groups three, two, and one')(() =>
          insertQueueEntry(
            queueEntry(30, { username: 'thirty', priorityGroup: 3 }),
            queueEntry(20, { username: 'twenty', priorityGroup: 2 }),
            queueEntry(10, { username: 'lowest', priorityGroup: 1 }),
          )
        ),
        When('the waiting list advances once')(
          'observations',
          () =>
            Effect.gen(function*() {
              yield* settleRegistrationQueueDaemon
              const thirtyClient = yield* makeRegistrationQueueClient()
              const twentyClient = yield* makeRegistrationQueueClient()
              const lowestClient = yield* makeRegistrationQueueClient()
              return yield* Effect.all({
                thirty: observeRegistration(thirtyClient, addressFromSeed(30), 'thirty'),
                twenty: observeRegistration(twentyClient, addressFromSeed(20), 'twenty'),
                lowest: observeRegistration(lowestClient, addressFromSeed(10), 'lowest'),
              }, { concurrency: 'unbounded' })
            }),
        ),
        Then('only the eligible lower slots move people forward')(({ observations }) =>
          Effect.sync(() => {
            expect.soft(observations, 'Groups three, two, and one fill slots two through four').toMatchObject({
              thirty: {
                queuePosition: null,
                visibleStatus: expect.stringMatching(/^(RESERVED|ASSIGNED)$/),
              },
              twenty: {
                queuePosition: null,
                visibleStatus: expect.stringMatching(/^(RESERVED|ASSIGNED)$/),
              },
              lowest: {
                queuePosition: null,
                visibleStatus: expect.stringMatching(/^(RESERVED|ASSIGNED)$/),
              },
            })
          })
        ),
      ),
    )

    scenario(
      'Highest-priority people can fill every eligible slot in one round',
      scope.pipe(
        Given('four people are waiting in the highest priority group')(() =>
          insertQueueEntry(
            queueEntry(41, { username: 'highone', priorityGroup: 4 }),
            queueEntry(42, { username: 'hightwo', priorityGroup: 4 }),
            queueEntry(43, { username: 'highthree', priorityGroup: 4 }),
            queueEntry(44, { username: 'highfour', priorityGroup: 4 }),
          )
        ),
        And('a lower-priority person is also waiting')(() =>
          insertQueueEntry(queueEntry(12, { username: 'lowspare', priorityGroup: 1 }))
        ),
        When('the waiting list advances once')(
          'observations',
          () =>
            Effect.gen(function*() {
              yield* settleRegistrationQueueDaemon
              const highoneClient = yield* makeRegistrationQueueClient()
              const hightwoClient = yield* makeRegistrationQueueClient()
              const highthreeClient = yield* makeRegistrationQueueClient()
              const highfourClient = yield* makeRegistrationQueueClient()
              const lowspareClient = yield* makeRegistrationQueueClient()
              return yield* Effect.all({
                highone: observeRegistration(highoneClient, addressFromSeed(41), 'highone'),
                hightwo: observeRegistration(hightwoClient, addressFromSeed(42), 'hightwo'),
                highthree: observeRegistration(highthreeClient, addressFromSeed(43), 'highthree'),
                highfour: observeRegistration(highfourClient, addressFromSeed(44), 'highfour'),
                lowspare: observeRegistration(lowspareClient, addressFromSeed(12), 'lowspare'),
              }, { concurrency: 'unbounded' })
            }),
        ),
        Then('the highest-priority people move before the lower-priority person')(({ observations }) =>
          Effect.sync(() => {
            const moved = [
              observations.highone,
              observations.hightwo,
              observations.highthree,
              observations.highfour,
            ].filter((entry) => entry.visibleStatus !== null)

            expect.soft(moved.length, 'All four highest-priority entries are selected').toBe(4)
            expect.soft(observations.lowspare, 'The lower-priority person remains queued').toMatchObject({
              queuePosition: expect.any(Number),
              visibleStatus: null,
            })
          })
        ),
      ),
    )

    scenario(
      'People in the same priority group keep their arrival order',
      scope.pipe(
        Given('Bob joined a priority group before Alice')(() =>
          Effect.gen(function*() {
            const now = yield* Clock.currentTimeMillis
            yield* insertQueueEntry(
              queueEntry(30, {
                username: 'earlybob',
                priorityGroup: 3,
                enqueuedAt: new Date(now),
              }),
              queueEntry(31, {
                username: 'latealice',
                priorityGroup: 3,
                enqueuedAt: new Date(now + Duration.toMillis(Duration.minutes(1))),
              }),
            )
          })
        ),
        When('they each check their place in line')(
          'statuses',
          () =>
            Effect.gen(function*() {
              const bobClient = yield* makeRegistrationQueueClient()
              const aliceClient = yield* makeRegistrationQueueClient()
              const [bob, alice] = yield* Effect.all([
                getRegistrationStatus(bobClient, addressFromSeed(30)),
                getRegistrationStatus(aliceClient, addressFromSeed(31)),
              ], { concurrency: 'unbounded' })
              return { bob, alice }
            }),
        ),
        Then('Bob is ahead of Alice within that priority group')(({ statuses }) =>
          Effect.gen(function*() {
            const bobRes = statuses.bob
            const aliceRes = statuses.alice
            expect(bobRes.status).toBe(200)
            expect(aliceRes.status).toBe(200)
            const bob = yield* Effect.promise(() => bobRes.json())
            const alice = yield* Effect.promise(() => aliceRes.json())

            expect.soft(bob.queuePosition, 'Earlier group-three entry is first among peers').toBe(1)
            expect.soft(alice.queuePosition, 'Later group-three entry is after the peer').toBe(2)
          })
        ),
      ),
    )

    // ═════════════════════════════════════════════════════════════════════
    // Rule: Queue status reflects priority order and wait estimates.
    // ═════════════════════════════════════════════════════════════════════

    scenario(
      'A later top-up moves ahead in the displayed queue position',
      scope.pipe(
        Given('Alice joined before a higher-priority Bob')(() =>
          Effect.gen(function*() {
            const now = yield* Clock.currentTimeMillis
            yield* insertQueueEntry(
              queueEntry(10, {
                username: 'alicepos',
                priorityGroup: 1,
                enqueuedAt: new Date(now),
              }),
              queueEntry(30, {
                username: 'bobpos',
                priorityGroup: 3,
                enqueuedAt: new Date(now + Duration.toMillis(Duration.minutes(1))),
              }),
            )
          })
        ),
        When('they each check their queue status')(
          'statuses',
          () =>
            Effect.gen(function*() {
              const aliceClient = yield* makeRegistrationQueueClient()
              const bobClient = yield* makeRegistrationQueueClient()
              const [alice, bob] = yield* Effect.all([
                getRegistrationStatus(aliceClient, addressFromSeed(10)),
                getRegistrationStatus(bobClient, addressFromSeed(30)),
              ], { concurrency: 'unbounded' })
              return { alice, bob }
            }),
        ),
        Then('Bob is shown ahead with the expected wait details')(({ statuses }) =>
          Effect.gen(function*() {
            const aliceRes = statuses.alice
            const bobRes = statuses.bob
            expect(aliceRes.status).toBe(200)
            expect(bobRes.status).toBe(200)
            const aliceJson = yield* Effect.promise(() => aliceRes.json())
            const bobJson = yield* Effect.promise(() => bobRes.json())

            expect.soft(bobJson).toMatchObject({
              queuePosition: 1,
              group: 3,
              estimatedIterationsRemaining: 1,
            })
            expect.soft(aliceJson).toMatchObject({
              queuePosition: 2,
              group: 1,
              estimatedIterationsRemaining: 1,
            })
          })
        ),
      ),
    )

    // ═════════════════════════════════════════════════════════════════════
    // Rule: Places become available again after processing or cleanup.
    // ═════════════════════════════════════════════════════════════════════

    scenario(
      'A new person can join after the waiting list advances',
      scope.pipe(
        Given('the waiting list is full')(() =>
          Effect.gen(function*() {
            yield* enqueueRegistration(yield* makeRegistrationQueueClient(), ALICE, 'alicea')
            yield* enqueueRegistration(yield* makeRegistrationQueueClient(), BOB, 'bobbob')
            yield* enqueueRegistration(yield* makeRegistrationQueueClient(), CHARLIE, 'charli')
          })
        ),
        When('one place is freed by processing')(
          'responses',
          () =>
            Effect.gen(function*() {
              const fullClient = yield* makeRegistrationQueueClient()
              const fullRes = yield* enqueueRegistration(fullClient, DAVE, 'davedv')
              yield* settleRegistrationQueueDaemon
              const aliceClient = yield* makeRegistrationQueueClient()
              const bobClient = yield* makeRegistrationQueueClient()
              const charlieClient = yield* makeRegistrationQueueClient()
              const processed = yield* Effect.all([
                observeRegistration(aliceClient, ALICE, 'alicea'),
                observeRegistration(bobClient, BOB, 'bobbob'),
                observeRegistration(charlieClient, CHARLIE, 'charli'),
              ], { concurrency: 'unbounded' })
              const acceptedRes = yield* enqueueRegistration(fullClient, DAVE, 'davedv')
              return { acceptedRes, fullRes, processed }
            }),
        ),
        Then('Dave receives the freed place')(({ responses }) =>
          Effect.sync(() => {
            const visibleProcessed = responses.processed.filter((entry) => entry.visibleStatus !== null)
            expect(responses.fullRes.status).toBe(409)
            expect(responses.acceptedRes.status).toBe(200)
            expect.soft(visibleProcessed.length, 'The freed place came from a visible username reservation').toBe(1)
            expect.soft(visibleProcessed[0]?.visibleStatus, 'The processed username is searchable').toEqual(
              expect.stringMatching(/^(RESERVED|ASSIGNED)$/),
            )
          })
        ),
      ),
    )

    // ═════════════════════════════════════════════════════════════════════
    // Rule: A person stays queued when no username reservation can be made.
    // ═════════════════════════════════════════════════════════════════════

    scenario(
      'A person is not removed when all username digits are already taken',
      scope.pipe(
        Given('Alice is waiting for a username with no available digits')(() =>
          Effect.gen(function*() {
            yield* seedAllDigits('takenname')
            yield* insertQueueEntry(
              QueueEntryBuilder.fromSeed(81)
                .withUsername('takenname')
                .withCandidateAccountId(ALICE)
                .withPriorityGroup(PriorityGroup.make(4)),
            )
          })
        ),
        When('the waiting list advances')(
          'status',
          () =>
            Effect.gen(function*() {
              yield* settleRegistrationQueueDaemon
              const client = yield* makeRegistrationQueueClient()
              const res = yield* getRegistrationStatus(client, ALICE)
              expect(res.status).toBe(200)
              return yield* Effect.promise(() => res.json())
            }),
        ),
        Then('Alice remains waiting for a future reservation attempt')(({ status }) =>
          Effect.sync(() => {
            expect.soft(status, 'No reservation means Alice remains queued').toMatchObject({
              queuePosition: expect.any(Number),
              group: expect.any(Number),
              estimatedIterationsRemaining: expect.any(Number),
            })
          })
        ),
      ),
    )
  })
