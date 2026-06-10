import { ProblemDetailWithErrorsZod, ProblemDetailZod } from '#root/lib/problem-details.js'
import { z } from '@hono/zod-openapi'
import { And, Given, Then, When } from '@identity-backend/effect-vitest-gherkin'
import { Effect } from 'effect'
import { expect } from 'vitest'
import { insertQueueEntry } from './fixtures/insert-queue-entry.js'
import { addressFromSeed, QueueEntryBuilder } from './fixtures/queue-entry-builder.js'
import {
  cleanUpRegistrationQueue,
  enqueueRegistration,
  getRegistrationStatus,
  makeRegistrationQueueClient,
  observeRegistration,
  settleRegistrationQueueBalanceCheck,
  settleRegistrationQueueDaemon,
} from './fixtures/registration-queue-client.js'
import { feature, scenarioLayer, sharedFileLayer } from './layers.js'

const ALICE = `0x${'AA'.repeat(32)}`
const BOB = `0x${'BB'.repeat(32)}`
const CHARLIE = `0x${'CC'.repeat(32)}`
const DAVE = `0x${'DD'.repeat(32)}`

feature('Registration Queue')
  .withLayer(sharedFileLayer)
  .withScenarioLayer(scenarioLayer)
  .withScope({})
  .body(({ scenario, scenarioOutline, background, scope }) => {
    background(
      Effect.gen(function*() {
        yield* cleanUpRegistrationQueue
      }),
    )

    // ═════════════════════════════════════════════════════════════════════
    // Rule: A person may sign up once per account. Duplicate sign-ups
    // from the same account are rejected.
    // ═════════════════════════════════════════════════════════════════════

    scenario(
      'Alice joins the registration waiting list for the first time',
      scope.pipe(
        Given('Alice wants to claim a username for her account')(() => Effect.void),
        When('Alice submits the name "alice" for her account')(
          'enqueueRes',
          () =>
            Effect.gen(function*() {
              const client = yield* makeRegistrationQueueClient()
              return yield* enqueueRegistration(client, ALICE, 'alice')
            }),
        ),
        Then('Alice is placed in the waiting list at a specific position')(
          ({ enqueueRes }) =>
            Effect.gen(function*() {
              expect(enqueueRes.status).toBe(200)
              const json = yield* Effect.promise(() => enqueueRes.json())
              expect(json).toMatchObject({
                registrationOutcome: 'QUEUED',
              })
            }),
        ),
      ),
    )

    scenario(
      'Alice is told she is already on the waiting list when she tries again',
      scope.pipe(
        Given('Alice already has a pending spot on the waiting list')(() =>
          Effect.gen(function*() {
            const client = yield* makeRegistrationQueueClient()
            yield* enqueueRegistration(client, ALICE, 'alice')
          })
        ),
        When('Alice tries to submit a different name from the same account')(
          'duplicateRes',
          () =>
            Effect.gen(function*() {
              const client = yield* makeRegistrationQueueClient()
              return yield* enqueueRegistration(client, ALICE, 'bob')
            }),
        ),
        Then('Alice is told she already has a spot waiting')(({ duplicateRes }) =>
          Effect.gen(function*() {
            expect(duplicateRes.status).toBe(409)
            const json = yield* Effect.promise(() => duplicateRes.json())
            expect(json).toEqual(expect.schemaMatching(ProblemDetailZod))
          })
        ),
      ),
    )

    // ═════════════════════════════════════════════════════════════════════
    // Rule: Anyone can check whether they are on the waiting list. They
    // see their place in line or a clear indication they are not on it.
    // ═════════════════════════════════════════════════════════════════════

    scenario(
      'Alice sees her place in line after joining',
      scope.pipe(
        Given('Alice is on the registration waiting list')(() =>
          Effect.gen(function*() {
            const client = yield* makeRegistrationQueueClient()
            yield* enqueueRegistration(client, ALICE, 'alice')
          })
        ),
        When('Alice checks whether she is on the list')(
          'statusRes',
          () =>
            Effect.gen(function*() {
              const client = yield* makeRegistrationQueueClient()
              return yield* getRegistrationStatus(client, ALICE)
            }),
        ),
        Then('Alice sees her position and that she is still waiting')(({ statusRes }) =>
          Effect.gen(function*() {
            expect(statusRes.status).toBe(200)
            const json = yield* Effect.promise(() => statusRes.json())
            expect(json).toEqual(expect.schemaMatching(z.object({
              queuePosition: z.number(),
              group: z.number(),
              estimatedIterationsRemaining: z.number(),
            })))
            expect(json.queuePosition).toBeGreaterThan(0)
          })
        ),
      ),
    )

    scenario(
      'Bob is told he is not on the waiting list',
      scope.pipe(
        Given('Bob has never joined the registration waiting list')(() => Effect.void),
        When('Bob checks whether he is on the list')(
          'statusRes',
          () =>
            Effect.gen(function*() {
              const client = yield* makeRegistrationQueueClient()
              return yield* getRegistrationStatus(client, BOB)
            }),
        ),
        Then('Bob is told his name does not appear on the list')(({ statusRes }) =>
          Effect.gen(function*() {
            expect(statusRes.status).toBe(404)
            const json = yield* Effect.promise(() => statusRes.json())
            expect(json).toEqual(expect.schemaMatching(ProblemDetailZod))
          })
        ),
      ),
    )

    scenario(
      'Alice sees she has been moved forward in the waiting list',
      scope.pipe(
        Given('Alice has been moved forward from the waiting list')(
          'setup',
          () =>
            Effect.gen(function*() {
              const client = yield* makeRegistrationQueueClient()
              const res = yield* enqueueRegistration(client, ALICE, 'alice')
              yield* enqueueRegistration(client, BOB, 'bob')
              expect(res.status).toBe(200)
              yield* settleRegistrationQueueDaemon
              return undefined
            }),
        ),
        When('Alice checks whether she is on the list')(
          'statusRes',
          () =>
            Effect.gen(function*() {
              const client = yield* makeRegistrationQueueClient()
              return yield* getRegistrationStatus(client, ALICE)
            }),
        ),
        Then('Alice sees she is no longer waiting in line')(({ statusRes }) =>
          Effect.gen(function*() {
            expect.soft(statusRes.status, 'Processed accounts have no queue row').toBe(404)
            expect(statusRes.status).toBe(404)
            const json = yield* Effect.promise(() => statusRes.json())
            expect.soft(json.detail, 'GET status returns an error payload when absent from queue').toEqual(
              expect.any(String),
            )
          })
        ),
      ),
    )

    // ═════════════════════════════════════════════════════════════════════
    // Rule: The waiting list has a maximum size. Once full, no more
    // people may join.
    // ═════════════════════════════════════════════════════════════════════

    scenario(
      'Dave is told the waiting list is full',
      scope.pipe(
        Given('the waiting list has reached its limit of three people')(() =>
          Effect.gen(function*() {
            const client = yield* makeRegistrationQueueClient()
            const aliceRes = yield* enqueueRegistration(client, ALICE, 'alice').pipe(
              Effect.flatMap((r) => Effect.sync(() => r.status)),
            )
            const bobRes = yield* enqueueRegistration(client, BOB, 'bob').pipe(
              Effect.flatMap((r) => Effect.sync(() => r.status)),
            )
            const charlieRes = yield* enqueueRegistration(client, CHARLIE, 'charlie').pipe(
              Effect.flatMap((r) => Effect.sync(() => r.status)),
            )
            yield* Effect.log(`DEBUG statuses: alice=${aliceRes} bob=${bobRes} charlie=${charlieRes}`)
          })
        ),
        When('Dave tries to join the waiting list')(
          'fullRes',
          () =>
            Effect.gen(function*() {
              const client = yield* makeRegistrationQueueClient()
              return yield* enqueueRegistration(client, DAVE, 'dave')
            }),
        ),
        Then('Dave is told there is no more room')(({ fullRes }) =>
          Effect.gen(function*() {
            expect(fullRes.status).toBe(409)
            const json = yield* Effect.promise(() => fullRes.json())
            expect(json).toEqual(expect.schemaMatching(ProblemDetailZod))
          })
        ),
      ),
    )

    // ═════════════════════════════════════════════════════════════════════
    // Rule: The waiting list is first-come-first-served. People who join
    // earlier receive an earlier position.
    // ═════════════════════════════════════════════════════════════════════

    scenario(
      'Alice, Bob, and Charlie are placed in order of arrival',
      scope.pipe(
        Given('Alice is the first to join the waiting list')(() =>
          Effect.gen(function*() {
            const client = yield* makeRegistrationQueueClient()
            yield* enqueueRegistration(client, ALICE, 'alice')
          })
        ),
        And('Bob is the second to join')(() =>
          Effect.gen(function*() {
            const client = yield* makeRegistrationQueueClient()
            yield* enqueueRegistration(client, BOB, 'bob')
          })
        ),
        And('Charlie is the third to join')(() =>
          Effect.gen(function*() {
            const client = yield* makeRegistrationQueueClient()
            yield* enqueueRegistration(client, CHARLIE, 'charlie')
          })
        ),
        When('they each check their position')(
          'statuses',
          () =>
            Effect.gen(function*() {
              const aliceClient = yield* makeRegistrationQueueClient()
              const bobClient = yield* makeRegistrationQueueClient()
              const charlieClient = yield* makeRegistrationQueueClient()
              const aliceRes = yield* getRegistrationStatus(aliceClient, ALICE)
              const bobRes = yield* getRegistrationStatus(bobClient, BOB)
              const charlieRes = yield* getRegistrationStatus(charlieClient, CHARLIE)
              return { aliceRes, bobRes, charlieRes }
            }),
        ),
        Then('Alice is first in line, Bob is second, and Charlie is third')(({ statuses }) =>
          Effect.gen(function*() {
            const aliceRes = statuses.aliceRes
            const bobRes = statuses.bobRes
            const charlieRes = statuses.charlieRes
            expect(aliceRes.status).toBe(200)
            expect(bobRes.status).toBe(200)
            expect(charlieRes.status).toBe(200)
            const aliceJson = yield* Effect.promise(() => aliceRes.json())
            const bobJson = yield* Effect.promise(() => bobRes.json())
            const charlieJson = yield* Effect.promise(() => charlieRes.json())
            expect(aliceJson.queuePosition).toBe(1)
            expect(bobJson.queuePosition).toBe(2)
            expect(charlieJson.queuePosition).toBe(3)
          })
        ),
      ),
    )

    // ═════════════════════════════════════════════════════════════════════
    // Rule: The system checks that request data is valid before accepting
    // it. Invalid data is rejected with clear feedback.
    // ═════════════════════════════════════════════════════════════════════

    scenarioOutline(
      'Alice is told her request is invalid when <reason>',
      [
        { reason: 'she provides an empty name', body: { username: '', candidateAccountId: ALICE } },
        { reason: 'the name is too long', body: { username: 'x'.repeat(33), candidateAccountId: ALICE } },
      ],
      ({ reason: _reason, body }) =>
        scope.pipe(
          Given('Alice wants to join the registration waiting list')(() => Effect.void),
          When('Alice submits her request')(
            'res',
            () =>
              Effect.gen(function*() {
                const client = yield* makeRegistrationQueueClient()
                return yield* enqueueRegistration(client, body.candidateAccountId, body.username)
              }),
          ),
          Then('Alice is told her request could not be processed')(({ res }) =>
            Effect.gen(function*() {
              expect(res.status).toBe(400)
              const json = yield* Effect.promise(() => res.json())
              expect(json).toEqual(expect.schemaMatching(ProblemDetailWithErrorsZod))
            })
          ),
        ),
    )

    // ═════════════════════════════════════════════════════════════════════
    // Rule: The waiting list advances periodically. People at the front
    // of the line are moved forward for registration.
    // ═════════════════════════════════════════════════════════════════════

    scenario(
      'Alice is moved forward when the waiting list advances; Bob stays in line',
      scope.pipe(
        Given('Alice and Bob are first and second on the waiting list')(() =>
          Effect.gen(function*() {
            const client = yield* makeRegistrationQueueClient()
            yield* enqueueRegistration(client, ALICE, 'alice')
            yield* enqueueRegistration(client, BOB, 'bob')
          })
        ),
        When('the waiting list advances to the next round')(
          'observations',
          () =>
            Effect.gen(function*() {
              yield* settleRegistrationQueueDaemon
              const aliceClient = yield* makeRegistrationQueueClient()
              const bobClient = yield* makeRegistrationQueueClient()
              const [alice, bob] = yield* Effect.all([
                observeRegistration(aliceClient, ALICE, 'alice'),
                observeRegistration(bobClient, BOB, 'bob'),
              ], { concurrency: 'unbounded' })
              return { alice, bob }
            }),
        ),
        Then('Alice is no longer waiting but Bob still has his place in line')(({ observations }) =>
          Effect.sync(() => {
            expect.soft(observations, 'Alice is selected and Bob remains queued').toMatchObject({
              alice: {
                queuePosition: null,
                visibleStatus: expect.stringMatching(/^(RESERVED|ASSIGNED)$/),
              },
              bob: {
                queuePosition: expect.any(Number),
                visibleStatus: null,
              },
            })
            expect.soft(observations.bob.queuePosition, 'Bob still has a positive waiting position').toBeGreaterThan(0)
          })
        ),
      ),
    )

    scenario(
      'The daemon stays healthy when the waiting list is empty',
      scope.pipe(
        Given('nobody is on the registration waiting list')(() => Effect.void),
        When('the waiting list advances to the next round')(
          'statusRes',
          () =>
            Effect.gen(function*() {
              yield* settleRegistrationQueueDaemon
              const client = yield* makeRegistrationQueueClient()
              return yield* getRegistrationStatus(client, ALICE)
            }),
        ),
        Then('the system is still operational and responds to queries')(({ statusRes }) =>
          Effect.gen(function*() {
            expect(statusRes.status).toBe(404)
            const json = yield* Effect.promise(() => statusRes.json())
            expect(json).toEqual(expect.schemaMatching(ProblemDetailZod))
          })
        ),
      ),
    )

    scenario(
      'Only one person in the lowest priority tier is moved forward per round',
      scope.pipe(
        Given('four people have joined the waiting list at the lowest priority tier')(() =>
          Effect.gen(function*() {
            yield* insertQueueEntry(
              QueueEntryBuilder.fromSeed(1).withUsername('alice').withCandidateAccountId(ALICE),
              QueueEntryBuilder.fromSeed(2).withUsername('bob').withCandidateAccountId(BOB),
              QueueEntryBuilder.fromSeed(3).withUsername('charlie').withCandidateAccountId(CHARLIE),
              QueueEntryBuilder.fromSeed(4).withUsername('dave').withCandidateAccountId(DAVE),
            )
          })
        ),
        When('the waiting list advances once')(
          'observations',
          () =>
            Effect.gen(function*() {
              yield* settleRegistrationQueueDaemon
              const aliceClient = yield* makeRegistrationQueueClient()
              const bobClient = yield* makeRegistrationQueueClient()
              const charlieClient = yield* makeRegistrationQueueClient()
              const daveClient = yield* makeRegistrationQueueClient()
              const [alice, bob, charlie, dave] = yield* Effect.all([
                observeRegistration(aliceClient, ALICE, 'alice'),
                observeRegistration(bobClient, BOB, 'bob'),
                observeRegistration(charlieClient, CHARLIE, 'charlie'),
                observeRegistration(daveClient, DAVE, 'dave'),
              ], { concurrency: 'unbounded' })
              return { alice, bob, charlie, dave }
            }),
        ),
        Then('three people are still waiting and one has been moved forward')(({ observations }) =>
          Effect.sync(() => {
            const waiting = Object.values(observations).filter((entry) => entry.queuePosition !== null)
            const visible = Object.values(observations).filter((entry) => entry.visibleStatus !== null)

            expect.soft({
              waitingCount: waiting.length,
              visibleReservedCount: visible.length,
            }, 'Exactly one lowest-tier person leaves the queue and becomes visible').toStrictEqual({
              waitingCount: 3,
              visibleReservedCount: 1,
            })
            expect.soft(visible[0]?.visibleStatus, 'The moved person is reserved or assigned').toEqual(
              expect.stringMatching(/^(RESERVED|ASSIGNED)$/),
            )
          })
        ),
      ),
    )

    scenario(
      'Top-ups move people into higher priority tiers before the waiting list advances',
      scope.pipe(
        Given('five people have joined the waiting list with different account balances')(() =>
          Effect.gen(function*() {
            yield* insertQueueEntry(
              QueueEntryBuilder.fromSeed(40).withUsername('forty').withCandidateAccountId(addressFromSeed(40)),
              QueueEntryBuilder.fromSeed(30).withUsername('thirty').withCandidateAccountId(addressFromSeed(30)),
              QueueEntryBuilder.fromSeed(20).withUsername('twenty').withCandidateAccountId(addressFromSeed(20)),
              QueueEntryBuilder.fromSeed(10).withUsername('ten').withCandidateAccountId(addressFromSeed(10)),
              QueueEntryBuilder.fromSeed(11).withUsername('spare').withCandidateAccountId(addressFromSeed(11)),
            )
          })
        ),
        When('the system notices those balances and the waiting list advances')(
          'observations',
          () =>
            Effect.gen(function*() {
              yield* settleRegistrationQueueBalanceCheck
              yield* settleRegistrationQueueDaemon
              const c40 = yield* makeRegistrationQueueClient()
              const c30 = yield* makeRegistrationQueueClient()
              const c20 = yield* makeRegistrationQueueClient()
              const c10 = yield* makeRegistrationQueueClient()
              const c11 = yield* makeRegistrationQueueClient()
              const [forty, thirty, twenty, ten, spare] = yield* Effect.all([
                observeRegistration(c40, addressFromSeed(40), 'forty'),
                observeRegistration(c30, addressFromSeed(30), 'thirty'),
                observeRegistration(c20, addressFromSeed(20), 'twenty'),
                observeRegistration(c10, addressFromSeed(10), 'ten'),
                observeRegistration(c11, addressFromSeed(11), 'spare'),
              ], { concurrency: 'unbounded' })
              return { forty, thirty, twenty, ten, spare }
            }),
        ),
        Then('the configured priority slots are filled before the extra lowest-priority person')(({ observations }) =>
          Effect.sync(() => {
            expect.soft(observations, 'Priority tiers are applied before processing slots are filled').toMatchObject({
              forty: {
                queuePosition: null,
                visibleStatus: expect.stringMatching(/^(RESERVED|ASSIGNED)$/),
              },
              thirty: {
                queuePosition: null,
                visibleStatus: expect.stringMatching(/^(RESERVED|ASSIGNED)$/),
              },
              twenty: {
                queuePosition: null,
                visibleStatus: expect.stringMatching(/^(RESERVED|ASSIGNED)$/),
              },
              ten: {
                queuePosition: null,
                visibleStatus: expect.stringMatching(/^(RESERVED|ASSIGNED)$/),
              },
              spare: {
                queuePosition: expect.any(Number),
                visibleStatus: null,
              },
            })
            expect.soft(observations.spare.queuePosition, 'The extra lowest-priority person remains queued')
              .toBeGreaterThan(0)
          })
        ),
      ),
    )

    // ═════════════════════════════════════════════════════════════════════
    // Rule: Entries already processed in a prior daemon cycle are left
    // alone when the daemon runs again.
    // ═════════════════════════════════════════════════════════════════════

    scenario(
      'Alice and Bob are both processed after two daemon rounds',
      scope.pipe(
        Given('Alice and Bob are first and second on the waiting list')(() =>
          Effect.gen(function*() {
            const client = yield* makeRegistrationQueueClient()
            yield* enqueueRegistration(client, ALICE, 'alice')
            yield* enqueueRegistration(client, BOB, 'bob')
          })
        ),
        When('the waiting list advances twice')(
          'observations',
          () =>
            Effect.gen(function*() {
              yield* settleRegistrationQueueDaemon
              yield* settleRegistrationQueueDaemon
              const aliceClient = yield* makeRegistrationQueueClient()
              const bobClient = yield* makeRegistrationQueueClient()
              const [alice, bob] = yield* Effect.all([
                observeRegistration(aliceClient, ALICE, 'alice'),
                observeRegistration(bobClient, BOB, 'bob'),
              ], { concurrency: 'unbounded' })
              return { alice, bob }
            }),
        ),
        Then('Alice and Bob are no longer waiting in line')(({ observations }) =>
          Effect.sync(() => {
            expect.soft(observations, 'Alice and Bob both leave the queue and become visible').toMatchObject({
              alice: {
                queuePosition: null,
                visibleStatus: expect.stringMatching(/^(RESERVED|ASSIGNED)$/),
              },
              bob: {
                queuePosition: null,
                visibleStatus: expect.stringMatching(/^(RESERVED|ASSIGNED)$/),
              },
            })
          })
        ),
      ),
    )

    // ═══════════════════════════════════════════════════════════════════════
    // Rule: Moving out of the queue reserves the username in the search view.
    // ═══════════════════════════════════════════════════════════════════════

    scenario(
      'A queued username is visible after the waiting list advances',
      scope.pipe(
        Given('an entry has been queued for username "eve"')(() =>
          Effect.gen(function*() {
            const client = yield* makeRegistrationQueueClient()
            yield* enqueueRegistration(client, addressFromSeed(5), 'eve')
          })
        ),
        When('the waiting list advances')(
          'observation',
          () =>
            Effect.gen(function*() {
              yield* settleRegistrationQueueDaemon
              const client = yield* makeRegistrationQueueClient()
              return yield* observeRegistration(client, addressFromSeed(5), 'eve')
            }),
        ),
        Then('the username "eve" is visible as reserved or assigned')(({ observation }) =>
          Effect.sync(() => {
            expect.soft(observation, 'Eve leaves the queue and becomes visible').toMatchObject({
              queuePosition: null,
              visibleStatus: expect.stringMatching(/^(RESERVED|ASSIGNED)$/),
            })
          })
        ),
      ),
    )
  })
