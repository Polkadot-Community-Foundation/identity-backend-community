import { expect, Gherkin, Given, it, layer, makeFeature, Then, When } from '@identity-backend/effect-vitest-gherkin'
import { createExpiry } from '@novasamatech/sdk-statement'
import type { TopicFilter } from '@novasamatech/sdk-statement'
import { statementCodec } from '@novasamatech/sdk-statement'
import { Blake2256 } from '@polkadot-api/substrate-bindings'
import { toHex } from '@polkadot-api/utils'
import { Chunk, Duration, Effect, Exit, Fiber, HashSet, Layer, Metric, Stream } from 'effect'
import * as TestClock from 'effect/TestClock'
import { StatementStoreFake } from '../src/fake.js'
import { statementRejectionCounter, StatementStoreService } from '../src/index.js'
import { deterministicFixtureParts } from './fixtures/deterministic-bytes.js'
import { expectedProjection, projectComparable } from './fixtures/projection.js'
import {
  signedStatementOf,
  signedStatementWithoutProof,
  signedStatementWithoutTopics,
  withTamperedSignature,
} from './fixtures/signed-statement-builder.js'
import { observeOne } from './harness/observe.js'
import { statementStoreContractStreamTimeouts } from './harness/timings.js'

const Feature = makeFeature({ it, layer })
const fakeStream = statementStoreContractStreamTimeouts('Fake')

const withStore = <A, E>(f: (store: StatementStoreService.Definition) => Effect.Effect<A, E, never>) =>
  StatementStoreService.pipe(Effect.flatMap(f))

const randomTopic = (): `0x${string}` => {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return toHex(bytes) as `0x${string}`
}

const observeStatement = (hash: string) => withStore((store) => observeOne(store, hash, fakeStream.observeOne))

const observeOneFiltered = (hash: string, filter: TopicFilter) =>
  withStore((store) =>
    store.subscribeStatements(filter).pipe(
      Stream.filter((vs) => vs.statementHash === hash),
      Stream.take(1),
      Stream.runCollect,
      Effect.timeout(fakeStream.observeOneFiltered),
      Effect.map((chunk) => Chunk.toReadonlyArray(chunk)[0]!),
    )
  )

const observeBothHashes = (h1: string, h2: string) =>
  withStore((store) =>
    store.subscribeStatements('any').pipe(
      Stream.filter((vs) => vs.statementHash === h1 || vs.statementHash === h2),
      Stream.mapAccum(HashSet.empty<string>(), (seen, vs) => {
        const nextSeen = HashSet.add(seen, vs.statementHash)
        return [nextSeen, [nextSeen, vs] as const] as const
      }),
      Stream.takeUntil(([set]) => HashSet.has(set, h1) && HashSet.has(set, h2)),
      Stream.map(([, vs]) => vs),
      Stream.runCollect,
      Effect.timeout(fakeStream.observeBothMintedHashes),
      Effect.map((chunk) => Chunk.toReadonlyArray(chunk)),
    )
  )

Feature('StatementStore fake')
  .withScenarioLayer(StatementStoreFake)
  .liveClock()
  .body(({ scenario }) => {
    scenario(
      'Should_ReturnNew_When_StatementIsValid',
      Gherkin.Do.pipe(
        Given('a valid signed statement')('signed', () => signedStatementOf()),
        When('the statement is submitted')(
          'result',
          ({ signed }) => withStore((store) => store.submit(signed.raw)),
        ),
        Then('the result is new')(({ result }) => Effect.sync(() => expect(result).toEqual({ status: 'new' }))),
      ),
    )

    scenario(
      'Should_RejectDuplicate_When_SameStatementResubmitted',
      Gherkin.Do.pipe(
        Given('a signed statement with expiry')('signed', () => signedStatementOf()),
        When('the statement is submitted twice')(
          'outcome',
          ({ signed }) =>
            withStore((store) =>
              Effect.gen(function*() {
                if (signed.expiry === null) {
                  return yield* Effect.fail(
                    new Error('fixture must include expiry for channelPriorityTooLow parity'),
                  )
                }
                const first = yield* store.submit(signed.raw)
                const second = yield* store.submit(signed.raw)
                return { first, second }
              })
            ),
        ),
        Then('the first is new and the second is channelPriorityTooLow with equal expiries')(({ outcome }) =>
          Effect.sync(() => {
            expect(outcome.first).toEqual({ status: 'new' })
            expect(outcome.second).toMatchObject({ status: 'rejected', reason: 'channelPriorityTooLow' })
            if (outcome.second.status === 'rejected' && outcome.second.reason === 'channelPriorityTooLow') {
              expect(outcome.second.min_expiry).toEqual(outcome.second.submitted_expiry)
            }
          })
        ),
      ),
    )

    scenario(
      'Should_ReturnBadProof_When_SignatureTampered',
      Gherkin.Do.pipe(
        Given('a tampered signed statement')(
          'tampered',
          () => signedStatementOf().pipe(Effect.map(withTamperedSignature)),
        ),
        When('submitted')(
          'result',
          ({ tampered }) => withStore((store) => store.submit(tampered.raw)),
        ),
        Then('the result is invalid badProof')(({ result }) =>
          Effect.sync(() => expect(result).toEqual({ status: 'invalid', reason: 'badProof' }))
        ),
      ),
    )

    scenario(
      'Should_IncrementRejectionMetric_When_StatementRejected',
      Gherkin.Do.pipe(
        Given('a tampered signed statement')(
          'tampered',
          () => signedStatementOf().pipe(Effect.map(withTamperedSignature)),
        ),
        When('submitted and metric is read')(
          'result',
          ({ tampered }) =>
            Effect.gen(function*() {
              const store = yield* StatementStoreService
              const submitResult = yield* store.submit(tampered.raw)
              const metricValue = yield* Metric.value(statementRejectionCounter)
              return { submitResult, metricValue }
            }),
        ),
        Then('the submission is rejected and metric is incremented')(({ result }) =>
          Effect.sync(() => {
            expect(result.submitResult).toEqual({ status: 'invalid', reason: 'badProof' })
            expect(result.metricValue).toBeDefined()
          })
        ),
      ),
    )

    scenario(
      'Should_ReturnNoProof_When_ProofMissingFromPayload',
      Gherkin.Do.pipe(
        Given('a statement without proof')('withoutProof', () => signedStatementWithoutProof()),
        When('submitted')(
          'result',
          ({ withoutProof }) => withStore((store) => store.submit(withoutProof)),
        ),
        Then('the result is invalid noProof')(({ result }) =>
          Effect.sync(() => expect(result).toEqual({ status: 'invalid', reason: 'noProof' }))
        ),
      ),
    )

    scenario(
      'Should_ReturnAlreadyExpired_When_ExpiryTimestampInPast',
      Gherkin.Do.pipe(
        Given('a statement with a past expiry timestamp')(
          'signed',
          () => signedStatementOf({ ...deterministicFixtureParts('fake-expired'), expiry: 1n }),
        ),
        When('submitted')(
          'result',
          ({ signed }) => withStore((store) => store.submit(signed.raw)),
        ),
        Then('the result is invalid alreadyExpired')(({ result }) =>
          Effect.sync(() => expect(result).toEqual({ status: 'invalid', reason: 'alreadyExpired' }))
        ),
      ),
    )

    scenario(
      'Should_AcceptAsNew_When_StatementHasNoTopics',
      Gherkin.Do.pipe(
        Given('a statement signed with no topics')('raw', () => signedStatementWithoutTopics()),
        When('submitted')(
          'result',
          ({ raw }) => withStore((store) => store.submit(raw)),
        ),
        Then('the result is new')(({ result }) => Effect.sync(() => expect(result).toEqual({ status: 'new' }))),
      ),
    )

    scenario(
      'Should_AcceptResubmit_When_DuplicateHasNoChannel',
      Gherkin.Do.pipe(
        Given('a signed statement without channel')(
          'signed',
          () => signedStatementOf({ channel: null }),
        ),
        When('the statement is submitted twice')(
          'outcome',
          ({ signed }) =>
            withStore((store) =>
              Effect.gen(function*() {
                const first = yield* store.submit(signed.raw)
                const second = yield* store.submit(signed.raw)
                return { first, second }
              })
            ),
        ),
        Then('both submits return new')(({ outcome }) =>
          Effect.sync(() => {
            expect(outcome.first).toEqual({ status: 'new' })
            expect(outcome.second).toEqual({ status: 'new' })
          })
        ),
      ),
    )

    scenario(
      'Should_ProjectAllFields_When_GetStatementsContainsSubmittedHash',
      Gherkin.Do.pipe(
        Given('a signed statement is submitted to the store')(
          'fixture',
          () =>
            signedStatementOf().pipe(
              Effect.flatMap((signed) =>
                withStore((store) => store.submit(signed.raw)).pipe(
                  Effect.map(() => ({ signed, expected: expectedProjection(signed) })),
                )
              ),
            ),
        ),
        When('getStatements is called')('rows', () => withStore((store) => store.getStatements('any'))),
        Then('the projected row matches the expected projection')(({ fixture, rows }) =>
          Effect.sync(() => {
            const projected = rows.find((vs) => vs.statementHash === fixture.expected.statementHash)
            expect(projected).toBeDefined()
            expect(projectComparable(projected!)).toEqual(fixture.expected)
          })
        ),
      ),
    )

    scenario(
      'Should_MatchBlake2256Hash_When_ReadingBackFromStore',
      Gherkin.Do.pipe(
        Given('a signed statement is submitted')(
          'fixture',
          () =>
            signedStatementOf().pipe(
              Effect.flatMap((signed) => {
                const expectedHash = toHex(Blake2256(statementCodec.enc(signed.raw)))
                return withStore((store) => store.submit(signed.raw)).pipe(
                  Effect.map(() => ({ expectedHash })),
                )
              }),
            ),
        ),
        When('getStatements is called')('rows', () => withStore((store) => store.getStatements('any'))),
        Then('the row hash matches the Blake2-256 encoding')(({ fixture, rows }) =>
          Effect.sync(() => {
            const row = rows.find((vs) => vs.statementHash === fixture.expectedHash)
            expect(row).toBeDefined()
            expect(row!.statementHash).toBe(fixture.expectedHash)
          })
        ),
      ),
    )

    scenario(
      'Should_PreserveTopicOrder_When_GetStatementsReturnsMultiTopic',
      Gherkin.Do.pipe(
        Given('a statement with four topics is submitted')(
          'fixture',
          () =>
            Effect.sync(() => [randomTopic(), randomTopic(), randomTopic(), randomTopic()] as const).pipe(
              Effect.flatMap((topics) =>
                signedStatementOf({ topics }).pipe(
                  Effect.flatMap((signed) => {
                    const expected = expectedProjection(signed)
                    return withStore((store) => store.submit(signed.raw)).pipe(
                      Effect.map(() => ({ topics, expected })),
                    )
                  }),
                )
              ),
            ),
        ),
        When('getStatements is called')('rows', () => withStore((store) => store.getStatements('any'))),
        Then('topic order and the projected row match expected')(({ fixture, rows }) =>
          Effect.sync(() => {
            const row = rows.find((vs) => vs.statementHash === fixture.expected.statementHash)
            expect(row).toBeDefined()
            expect([...row!.topics]).toEqual([...fixture.topics])
            expect(projectComparable(row!)).toEqual(fixture.expected)
          })
        ),
      ),
    )

    scenario(
      'Should_ProjectNullChannel_When_ChannelFieldOmitted',
      Gherkin.Do.pipe(
        Given('a statement with null channel is submitted')(
          'fixture',
          () =>
            signedStatementOf({ channel: null }).pipe(
              Effect.flatMap((signed) => {
                const expected = expectedProjection(signed)
                return withStore((store) => store.submit(signed.raw)).pipe(
                  Effect.map(() => ({ expected })),
                )
              }),
            ),
        ),
        When('getStatements is called')('rows', () => withStore((store) => store.getStatements('any'))),
        Then('the projected channel is null')(({ fixture, rows }) =>
          Effect.sync(() => {
            expect(fixture.expected.channel).toBeNull()
            const row = rows.find((vs) => vs.statementHash === fixture.expected.statementHash)
            expect(row).toBeDefined()
            expect(projectComparable(row!)).toEqual(fixture.expected)
          })
        ),
      ),
    )

    scenario(
      'Should_ReturnAlreadyExpired_When_ExpiryOmittedFromFixture',
      Gherkin.Do.pipe(
        Given('a statement with null expiry is submitted')(
          'fixture',
          () =>
            signedStatementOf({ expiry: null }).pipe(
              Effect.flatMap((signed) =>
                withStore((store) => store.submit(signed.raw)).pipe(
                  Effect.map((submit) => ({ statementHash: expectedProjection(signed).statementHash, submit })),
                )
              ),
            ),
        ),
        When('getStatements is called')('rows', () => withStore((store) => store.getStatements('any'))),
        Then('the submit result is invalid alreadyExpired and no row is stored')(({ fixture, rows }) =>
          Effect.sync(() => {
            expect(fixture.submit).toEqual({ status: 'invalid', reason: 'alreadyExpired' })
            const row = rows.find((vs) => vs.statementHash === fixture.statementHash)
            expect(row).toBeUndefined()
          })
        ),
      ),
    )

    scenario(
      'Should_ProjectEmptyData_When_PayloadUsesZeroByteData',
      Gherkin.Do.pipe(
        Given('a statement with empty data is submitted')(
          'fixture',
          () =>
            signedStatementOf({ data: new Uint8Array(0) }).pipe(
              Effect.flatMap((signed) => {
                const expected = expectedProjection(signed)
                return withStore((store) => store.submit(signed.raw)).pipe(
                  Effect.map(() => ({ expected })),
                )
              }),
            ),
        ),
        When('getStatements is called')('rows', () => withStore((store) => store.getStatements('any'))),
        Then('the projected statementData is an empty hex string')(({ fixture, rows }) =>
          Effect.sync(() => {
            expect(fixture.expected.statementData).toBe(toHex(new Uint8Array(0)))
            const row = rows.find((vs) => vs.statementHash === fixture.expected.statementHash)
            expect(row).toBeDefined()
            expect(projectComparable(row!)).toEqual(fixture.expected)
          })
        ),
      ),
    )

    scenario(
      'Should_PreserveTopicOrder_When_SubscribingToMultiTopicStatement',
      Gherkin.Do.pipe(
        Given('a statement with four topics is submitted')(
          'fixture',
          () =>
            Effect.sync(() => [randomTopic(), randomTopic(), randomTopic(), randomTopic()] as const).pipe(
              Effect.flatMap((topics) =>
                signedStatementOf({ topics }).pipe(
                  Effect.flatMap((signed) => {
                    const expected = expectedProjection(signed)
                    return withStore((store) => store.submit(signed.raw)).pipe(
                      Effect.map(() => ({ topics, expected })),
                    )
                  }),
                )
              ),
            ),
        ),
        When('the subscription returns the observed statement')(
          'observed',
          ({ fixture }) => observeStatement(fixture.expected.statementHash),
        ),
        Then('topic order and the projected row match expected')(({ fixture, observed }) =>
          Effect.sync(() => {
            expect([...observed.topics]).toEqual([...fixture.topics])
            expect(projectComparable(observed)).toEqual(fixture.expected)
          })
        ),
      ),
    )

    scenario(
      'Should_ApplyFilters_When_GetStatementsWithMixedTopics',
      Gherkin.Do.pipe(
        Given('three statements with distinct topics are submitted')(
          'submitted',
          () =>
            Effect.gen(function*() {
              const topicA = randomTopic()
              const topicB = randomTopic()
              const topicC = randomTopic()
              const one = yield* signedStatementOf({ topics: [topicA], channel: randomTopic() })
              const two = yield* signedStatementOf({ topics: [topicB], channel: randomTopic() })
              const both = yield* signedStatementOf({ topics: [topicA, topicB], channel: randomTopic() })
              const store = yield* StatementStoreService
              yield* store.submit(one.raw)
              yield* store.submit(two.raw)
              yield* store.submit(both.raw)
              return {
                topicA,
                topicB,
                topicC,
                hOne: expectedProjection(one).statementHash,
                hTwo: expectedProjection(two).statementHash,
                hBoth: expectedProjection(both).statementHash,
              }
            }),
        ),
        When('getStatements is called with all filter variants')(
          'filters',
          ({ submitted }) =>
            Effect.gen(function*() {
              const store = yield* StatementStoreService
              const anyRows = yield* store.getStatements('any')
              const matchAll = yield* store.getStatements({ matchAll: [submitted.topicA, submitted.topicB] })
              const matchAny = yield* store.getStatements({ matchAny: [submitted.topicA] })
              const noneMatch = yield* store.getStatements({ matchAll: [submitted.topicC] })
              const matchAllSingleA = yield* store.getStatements({ matchAll: [submitted.topicA] })
              const matchAnySingleA = yield* store.getStatements({ matchAny: [submitted.topicA] })
              return { anyRows, matchAll, matchAny, noneMatch, matchAllSingleA, matchAnySingleA }
            }),
        ),
        Then('all filter results match expected membership')(({ submitted, filters }) =>
          Effect.sync(() => {
            const has = (rows: typeof filters.anyRows, h: string) => rows.some((s) => String(s.statementHash) === h)
            expect(has(filters.anyRows, submitted.hOne)).toBe(true)
            expect(has(filters.anyRows, submitted.hTwo)).toBe(true)
            expect(has(filters.anyRows, submitted.hBoth)).toBe(true)
            expect(has(filters.matchAll, submitted.hBoth)).toBe(true)
            expect(has(filters.matchAll, submitted.hOne)).toBe(false)
            expect(has(filters.matchAll, submitted.hTwo)).toBe(false)
            expect(has(filters.matchAny, submitted.hOne)).toBe(true)
            expect(has(filters.matchAny, submitted.hBoth)).toBe(true)
            expect(has(filters.matchAny, submitted.hTwo)).toBe(false)
            expect(has(filters.noneMatch, submitted.hOne)).toBe(false)
            expect(has(filters.noneMatch, submitted.hTwo)).toBe(false)
            expect(has(filters.noneMatch, submitted.hBoth)).toBe(false)
            expect(filters.matchAllSingleA.map((s) => String(s.statementHash)).toSorted()).toEqual(
              filters.matchAnySingleA.map((s) => String(s.statementHash)).toSorted(),
            )
          })
        ),
      ),
    )

    scenario(
      'Should_ProduceDistinctHashes_When_SameTopicsDifferentPayload',
      Gherkin.Do.pipe(
        Given('two statements with the same topics but different data are signed')(
          'pair',
          () =>
            Effect.gen(function*() {
              const topics = [randomTopic()] as const
              const a = yield* signedStatementOf({
                topics,
                channel: randomTopic(),
                data: new TextEncoder().encode('payload-a'),
              })
              const b = yield* signedStatementOf({
                topics,
                channel: randomTopic(),
                data: new TextEncoder().encode('payload-b'),
              })
              return { a, b }
            }),
        ),
        Then('their hashes are distinct')(({ pair }) =>
          Effect.sync(() => {
            expect(expectedProjection(pair.a).statementHash).not.toBe(expectedProjection(pair.b).statementHash)
          })
        ),
      ),
    )

    scenario(
      'Should_ProduceDistinctHashes_When_SamePayloadDifferentTopics',
      Gherkin.Do.pipe(
        Given('two statements with the same data but different topics are signed')(
          'pair',
          () =>
            Effect.gen(function*() {
              const data = new TextEncoder().encode('shared-data')
              const a = yield* signedStatementOf({ topics: [randomTopic()], channel: randomTopic(), data })
              const b = yield* signedStatementOf({ topics: [randomTopic()], channel: randomTopic(), data })
              return { a, b }
            }),
        ),
        Then('their hashes are distinct')(({ pair }) =>
          Effect.sync(() => {
            expect(expectedProjection(pair.a).statementHash).not.toBe(expectedProjection(pair.b).statementHash)
          })
        ),
      ),
    )

    scenario(
      'Should_ReplayStatement_When_SubscribingAfterSubmit',
      Gherkin.Do.pipe(
        Given('a signed statement is submitted')(
          'fixture',
          () =>
            signedStatementOf().pipe(
              Effect.flatMap((signed) => {
                const expected = expectedProjection(signed)
                return withStore((store) => store.submit(signed.raw)).pipe(
                  Effect.map(() => ({ expected })),
                )
              }),
            ),
        ),
        When('the subscription is opened after the submit')(
          'observed',
          ({ fixture }) => observeStatement(fixture.expected.statementHash),
        ),
        Then('the replayed projection matches expected')(({ fixture, observed }) =>
          Effect.sync(() => expect(projectComparable(observed)).toEqual(fixture.expected))
        ),
      ),
    )

    scenario(
      'Should_ReplayBothHashes_When_SubscribingAfterSequentialSubmits',
      Gherkin.Do.pipe(
        Given('two statements are submitted sequentially')(
          'submitted',
          () =>
            Effect.gen(function*() {
              const s1 = yield* signedStatementOf({ channel: randomTopic() })
              const s2 = yield* signedStatementOf({ channel: randomTopic() })
              const store = yield* StatementStoreService
              const r1 = yield* store.submit(s1.raw)
              const r2 = yield* store.submit(s2.raw)
              return {
                h1: expectedProjection(s1).statementHash,
                h2: expectedProjection(s2).statementHash,
                r1,
                r2,
              }
            }),
        ),
        When('the subscription stream replays both')(
          'batch',
          ({ submitted }) => observeBothHashes(submitted.h1, submitted.h2),
        ),
        Then('both submit results are new and both hashes appear in the batch')(({ submitted, batch }) =>
          Effect.sync(() => {
            expect(submitted.r1).toEqual({ status: 'new' })
            expect(submitted.r2).toEqual({ status: 'new' })
            const hashes = HashSet.fromIterable(batch.map((vs) => vs.statementHash))
            expect(HashSet.size(hashes)).toBe(2)
            expect(HashSet.has(hashes, submitted.h1)).toBe(true)
            expect(HashSet.has(hashes, submitted.h2)).toBe(true)
          })
        ),
      ),
    )

    scenario(
      'Should_ReplayMatchAllSubset_When_SubscribingAfterMixedSubmits',
      Gherkin.Do.pipe(
        Given('a non-matching and a matching statement are submitted')(
          'fixture',
          () =>
            Effect.gen(function*() {
              const topicA = randomTopic()
              const topicB = randomTopic()
              const miss = yield* signedStatementOf({ topics: [topicA], channel: randomTopic() })
              const hit = yield* signedStatementOf({ topics: [topicA, topicB], channel: randomTopic() })
              const expected = expectedProjection(hit)
              const store = yield* StatementStoreService
              yield* store.submit(miss.raw)
              yield* store.submit(hit.raw)
              return { topicA, topicB, expected }
            }),
        ),
        When('the filtered subscription replays with matchAll')(
          'observed',
          ({ fixture }) =>
            observeOneFiltered(fixture.expected.statementHash, { matchAll: [fixture.topicA, fixture.topicB] }),
        ),
        Then('the observed projection matches the matching statement')(({ fixture, observed }) =>
          Effect.sync(() => expect(projectComparable(observed)).toEqual(fixture.expected))
        ),
      ),
    )

    scenario(
      'Should_EmitAfterSubscribe_When_SubmitRunsAfterFork',
      Gherkin.Do.pipe(
        Given('a signed statement and its expected projection')(
          'fixture',
          () => signedStatementOf().pipe(Effect.map((signed) => ({ signed, expected: expectedProjection(signed) }))),
        ),
        When('an observer is forked then the statement is submitted after the scheduling lead')(
          'outcome',
          ({ fixture }) =>
            Effect.gen(function*() {
              const fiber = yield* Effect.fork(observeStatement(fixture.expected.statementHash))
              const submit = yield* withStore((store) => store.submit(fixture.signed.raw))
              const observed = yield* Fiber.join(fiber)
              return { submit, observed }
            }),
        ),
        Then('the submit is new and the observer received the correct projection')(({ fixture, outcome }) =>
          Effect.sync(() => {
            expect(outcome.submit).toEqual({ status: 'new' })
            expect(projectComparable(outcome.observed)).toEqual(fixture.expected)
          })
        ),
      ),
    )

    scenario(
      'Should_EmitBothHashes_When_SubscribedBeforeSequentialSubmits',
      Gherkin.Do.pipe(
        Given('two signed statements are prepared')(
          'pair',
          () =>
            Effect.gen(function*() {
              const s1 = yield* signedStatementOf({ channel: randomTopic() })
              const s2 = yield* signedStatementOf({ channel: randomTopic() })
              return {
                s1,
                s2,
                h1: expectedProjection(s1).statementHash,
                h2: expectedProjection(s2).statementHash,
              }
            }),
        ),
        When('a batch observer is forked then both statements are submitted after the scheduling lead')(
          'batch',
          ({ pair }) =>
            Effect.gen(function*() {
              const fiber = yield* Effect.fork(observeBothHashes(pair.h1, pair.h2))
              const store = yield* StatementStoreService
              yield* store.submit(pair.s1.raw)
              yield* store.submit(pair.s2.raw)
              return yield* Fiber.join(fiber)
            }),
        ),
        Then('both hashes are present in the observed batch')(({ pair, batch }) =>
          Effect.sync(() => {
            const hashes = HashSet.fromIterable(batch.map((vs) => vs.statementHash))
            expect(HashSet.size(hashes)).toBe(2)
            expect(HashSet.has(hashes, pair.h1)).toBe(true)
            expect(HashSet.has(hashes, pair.h2)).toBe(true)
          })
        ),
      ),
    )

    scenario(
      'Should_FilterStreamByMatchAll_When_SelectiveTopicsRequested',
      Gherkin.Do.pipe(
        Given('a non-matching and a matching statement are prepared')(
          'fixture',
          () =>
            Effect.gen(function*() {
              const topicA = randomTopic()
              const topicB = randomTopic()
              const miss = yield* signedStatementOf({ topics: [topicA], channel: randomTopic() })
              const hit = yield* signedStatementOf({ topics: [topicA, topicB], channel: randomTopic() })
              const expected = expectedProjection(hit)
              return { topicA, topicB, miss, hit, expected }
            }),
        ),
        When('a matchAll observer is forked then both statements are submitted')(
          'observed',
          ({ fixture }) =>
            Effect.gen(function*() {
              const fiber = yield* Effect.fork(
                observeOneFiltered(fixture.expected.statementHash, {
                  matchAll: [fixture.topicA, fixture.topicB],
                }),
              )
              const store = yield* StatementStoreService
              yield* store.submit(fixture.miss.raw)
              yield* store.submit(fixture.hit.raw)
              return yield* Fiber.join(fiber)
            }),
        ),
        Then('only the matching statement is observed')(({ fixture, observed }) =>
          Effect.sync(() => expect(projectComparable(observed)).toEqual(fixture.expected))
        ),
      ),
    )

    scenario(
      'Should_FilterStreamByMatchAny_When_AlternativeTopicsRequested',
      Gherkin.Do.pipe(
        Given('a non-matching and a matching statement are prepared')(
          'fixture',
          () =>
            Effect.gen(function*() {
              const topicA = randomTopic()
              const topicB = randomTopic()
              const miss = yield* signedStatementOf({ topics: [topicA], channel: randomTopic() })
              const hit = yield* signedStatementOf({ topics: [topicA, topicB], channel: randomTopic() })
              const expected = expectedProjection(hit)
              return { topicA, topicB, miss, hit, expected }
            }),
        ),
        When('a matchAny observer is forked then both statements are submitted')(
          'observed',
          ({ fixture }) =>
            Effect.gen(function*() {
              const fiber = yield* Effect.fork(
                observeOneFiltered(fixture.expected.statementHash, { matchAny: [fixture.topicB] }),
              )
              const store = yield* StatementStoreService
              yield* store.submit(fixture.miss.raw)
              yield* store.submit(fixture.hit.raw)
              return yield* Fiber.join(fiber)
            }),
        ),
        Then('only the matching statement is observed')(({ fixture, observed }) =>
          Effect.sync(() => expect(projectComparable(observed)).toEqual(fixture.expected))
        ),
      ),
    )

    scenario(
      'Should_AllowFreshSubscribe_When_PriorScopedStreamCompletes',
      Gherkin.Do.pipe(
        Given('a first statement is submitted through a completed scoped subscription')(
          'firstDone',
          () =>
            signedStatementOf({ channel: randomTopic() }).pipe(
              Effect.flatMap((signed1) =>
                Effect.scoped(
                  Effect.gen(function*() {
                    const h1 = expectedProjection(signed1).statementHash
                    const fiber = yield* Effect.fork(observeStatement(h1))
                    yield* withStore((store) => store.submit(signed1.raw))
                    yield* Fiber.join(fiber)
                  }),
                )
              ),
            ),
        ),
        When('a second statement is submitted after the scoped stream closed')(
          'outcome',
          () =>
            signedStatementOf({ channel: randomTopic() }).pipe(
              Effect.flatMap((signed2) => {
                const expected2 = expectedProjection(signed2)
                return withStore((store) => store.submit(signed2.raw)).pipe(
                  Effect.zipRight(observeStatement(expected2.statementHash)),
                  Effect.map((observed2) => ({ expected2, observed2 })),
                )
              }),
            ),
        ),
        Then('the second subscription receives the correct projection')(({ outcome }) =>
          Effect.sync(() => expect(projectComparable(outcome.observed2)).toEqual(outcome.expected2))
        ),
      ),
    )

    scenario(
      'Should_DeliverToAllConcurrentFibers_When_SameHashObserved',
      Gherkin.Do.pipe(
        Given('a signed statement and its expected projection')(
          'fixture',
          () => signedStatementOf().pipe(Effect.map((signed) => ({ signed, expected: expectedProjection(signed) }))),
        ),
        When('two concurrent observers are forked and the statement is submitted after the scheduling lead')(
          'outcome',
          ({ fixture }) =>
            Effect.gen(function*() {
              const fiberOne = yield* Effect.fork(observeStatement(fixture.expected.statementHash))
              const fiberTwo = yield* Effect.fork(observeStatement(fixture.expected.statementHash))
              yield* withStore((store) => store.submit(fixture.signed.raw))
              const one = yield* Fiber.join(fiberOne)
              const two = yield* Fiber.join(fiberTwo)
              return { one, two }
            }),
        ),
        Then('both observers received the expected projection')(({ fixture, outcome }) =>
          Effect.sync(() => {
            expect(projectComparable(outcome.one)).toEqual(fixture.expected)
            expect(projectComparable(outcome.two)).toEqual(fixture.expected)
          })
        ),
      ),
    )
  })

Feature('StatementStore fake expiry filtering')
  .withScenarioLayer(Layer.mergeAll(StatementStoreFake, TestClock.defaultTestClock))
  .body(({ scenario }) => {
    scenario(
      'Should_NotEmitInStream_When_StoredStatementHasExpired',
      Gherkin.Do.pipe(
        Given('a submitted statement that expires at one second')(
          'fixture',
          () =>
            Effect.gen(function*() {
              const signed = yield* signedStatementOf({ expiry: createExpiry(1, 0) })
              const statementHash = expectedProjection(signed).statementHash
              const submit = yield* withStore((store) => store.submit(signed.raw))
              return { statementHash, submit }
            }),
        ),
        When('the test clock advances past expiry and a replay subscription is awaited')(
          'observed',
          ({ fixture }) =>
            Effect.gen(function*() {
              const waitForReplay = withStore((store) =>
                store.subscribeStatements('any').pipe(
                  Stream.filter((vs) => vs.statementHash === fixture.statementHash),
                  Stream.take(1),
                  Stream.runCollect,
                  Effect.timeout(Duration.seconds(1)),
                )
              )
              yield* TestClock.adjust(Duration.seconds(2))
              const replayFiber = yield* Effect.fork(waitForReplay)
              yield* TestClock.adjust(Duration.seconds(1))
              return yield* Fiber.join(replayFiber).pipe(Effect.exit)
            }),
        ),
        Then('submit is new and the replay request times out with no emission')(({ fixture, observed }) =>
          Effect.sync(() => {
            expect(fixture.submit).toEqual({ status: 'new' })
            expect(Exit.isFailure(observed)).toBe(true)
          })
        ),
      ),
    )

    scenario(
      'Should_NotReturnInGetStatements_When_StoredStatementHasExpired',
      Gherkin.Do.pipe(
        Given('a submitted statement that expires at one second')(
          'fixture',
          () =>
            Effect.gen(function*() {
              const signed = yield* signedStatementOf({ expiry: createExpiry(1, 0) })
              const statementHash = expectedProjection(signed).statementHash
              const submit = yield* withStore((store) => store.submit(signed.raw))
              return { statementHash, submit }
            }),
        ),
        When('the test clock advances past expiry and getStatements is called')(
          'rows',
          () =>
            Effect.gen(function*() {
              yield* TestClock.adjust(Duration.seconds(2))
              return yield* withStore((store) => store.getStatements('any'))
            }),
        ),
        Then('submit is new and no expired row is returned')(({ fixture, rows }) =>
          Effect.sync(() => {
            expect(fixture.submit).toEqual({ status: 'new' })
            const row = rows.find((vs) => vs.statementHash === fixture.statementHash)
            expect(row).toBeUndefined()
          })
        ),
      ),
    )

    scenario(
      'Should_KeepRejectingNoExpiry_When_ExpiryFieldOmitted',
      Gherkin.Do.pipe(
        Given('a statement whose expiry field is omitted')(
          'submit',
          () =>
            signedStatementOf({ expiry: null }).pipe(
              Effect.flatMap((signed) => withStore((store) => store.submit(signed.raw))),
            ),
        ),
        Then('submit remains invalid alreadyExpired')(({ submit }) =>
          Effect.sync(() => expect(submit).toEqual({ status: 'invalid', reason: 'alreadyExpired' }))
        ),
      ),
    )
  })
