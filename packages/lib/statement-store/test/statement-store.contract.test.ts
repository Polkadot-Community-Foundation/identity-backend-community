import {
  expect,
  Gherkin,
  Given,
  it,
  layer,
  makeFeature,
  pairwiseFor,
  Then,
} from '@identity-backend/effect-vitest-gherkin'
import type { TopicFilter } from '@novasamatech/sdk-statement'
import { createExpiry, statementCodec } from '@novasamatech/sdk-statement'
import { Blake2256 } from '@polkadot-api/substrate-bindings'
import { toHex } from '@polkadot-api/utils'
import { Chunk, Clock, Duration, Effect, Fiber, HashSet, Layer, Option, Stream } from 'effect'
import { getWsProvider } from 'polkadot-api/ws'
import { StatementStoreFake } from '../src/fake.js'
import { StatementStoreConfig, StatementStoreError, StatementStoreService } from '../src/index.js'
import { StatementStoreLive } from '../src/live.js'
import {
  deterministicFixtureParts as deterministicFixtureBase,
  deterministicMultiTopics,
} from './fixtures/deterministic-bytes.js'
import { expectedProjection, projectComparable } from './fixtures/projection.js'
import {
  signedStatementOf,
  signedStatementWithoutTopics,
  withTamperedSignature,
} from './fixtures/signed-statement-builder.js'
import { normalizeFilters, normalizeProjection, normalizeStream, normalizeSubmit } from './harness/normalize.js'
import { observeOne } from './harness/observe.js'
import {
  liveReplaySettleDuration,
  statementStoreContractStreamTimeouts,
  streamExpiryLeadDuration,
  streamExpirySettleBuffer,
  subscribeBeforeSubmitLeadDuration,
} from './harness/timings.js'
import { hasPpnRuntimeEnv, PpnRuntime, PpnRuntimeLayer } from './runtime/ppn-runtime.js'

const featureFactory = makeFeature({ it, layer })

const pairwiseStores = pairwiseFor(
  {
    a: { name: 'Fake', layer: StatementStoreFake },
    b: {
      name: 'Live',
      layer: Layer.unwrapEffect(
        Effect.gen(function*() {
          const rt = yield* PpnRuntime
          return Layer.provideMerge(
            StatementStoreLive,
            Layer.succeed(StatementStoreConfig, { provider: getWsProvider(rt.wsUrl) }),
          )
        }),
      ),
    },
  },
  StatementStoreService,
)

const contractPartsGiven = Given('pairwise contract fixture parts')(
  'contractParts',
  () =>
    Effect.gen(function*() {
      const ppn = yield* PpnRuntime
      const contractParts = (label: string) => deterministicFixtureBase(`${ppn.scenarioSalt}:${label}`)
      return contractParts
    }),
)

const liveStream = statementStoreContractStreamTimeouts('Live')

const observeOneFrom = (store: StatementStoreService.Definition, hash: string) =>
  observeOne(store, hash, liveStream.observeOne)

const observeOneFilteredFrom = (
  store: StatementStoreService.Definition,
  hash: string,
  filter: TopicFilter,
) =>
  store.subscribeStatements(filter).pipe(
    Stream.filter((vs) => vs.statementHash === hash),
    Stream.take(1),
    Stream.runCollect,
    Effect.timeout(liveStream.observeOneFiltered),
    Effect.map((chunk) => Chunk.toReadonlyArray(chunk)[0]!),
  )

const observeBothHashesFrom = (
  store: StatementStoreService.Definition,
  h1: string,
  h2: string,
) =>
  store.subscribeStatements('any').pipe(
    Stream.filter((vs) => vs.statementHash === h1 || vs.statementHash === h2),
    Stream.mapAccum(HashSet.empty<string>(), (seen, vs) => {
      const nextSeen = HashSet.add(seen, vs.statementHash)
      return [nextSeen, [nextSeen, vs] as const] as const
    }),
    Stream.takeUntil(([set]) => HashSet.has(set, h1) && HashSet.has(set, h2)),
    Stream.map(([, vs]) => vs),
    Stream.runCollect,
    Effect.timeout(liveStream.observeBothMintedHashes),
    Effect.map((chunk) => Chunk.toReadonlyArray(chunk)),
  )

const waitUntilStatementFilteredFromGet = (
  store: StatementStoreService.Definition,
  hash: string,
  maxWait: Duration.Duration,
) =>
  Effect.gen(function*() {
    const pollUntilFiltered = (): Effect.Effect<void, StatementStoreError, never> =>
      store.getStatements('any').pipe(
        Effect.flatMap((rows) => {
          const found = rows.some((vs) => vs.statementHash === hash)
          if (!found) {
            return Effect.void
          }
          return Effect.sleep(Duration.millis(250)).pipe(Effect.zipRight(pollUntilFiltered()))
        }),
      )

    return yield* pollUntilFiltered().pipe(
      Effect.timeoutOption(maxWait),
      Effect.map(Option.isSome),
    )
  })

const Feature = hasPpnRuntimeEnv() ? featureFactory : featureFactory.skip
Feature('StatementStore pairwise contract (Fake vs Live)', { tags: ['ppn'] })
  .withLayer(PpnRuntimeLayer, { excludeTestServices: true })
  .liveClock()
  .body(({ scenario }) => {
    scenario(
      'Should_MatchBothSides_When_NewStatementSubmitted',
      Gherkin.Do.pipe(
        contractPartsGiven,
        Given('a deterministic signed statement')(
          'signed',
          ({ contractParts }) => signedStatementOf(contractParts('pairwise-submit-new')),
        ),
        pairwiseStores('the statement is submitted to each side')(
          'result',
          ({ signed }) => (store) => store.submit(signed.raw),
        ),
        Then('Fake and Live results match')(({ result }) =>
          Effect.sync(() => expect(normalizeSubmit(result.a)).toEqual(normalizeSubmit(result.b)))
        ),
      ),
    )

    scenario(
      'Should_MatchBothSides_When_DuplicateResubmittedWithExpiry',
      Gherkin.Do.pipe(
        contractPartsGiven,
        Given('a deterministic signed statement')(
          'signed',
          ({ contractParts }) => signedStatementOf(contractParts('pairwise-cplow')),
        ),
        pairwiseStores('the statement is submitted twice')(
          'result',
          ({ signed }) => (store) =>
            Effect.gen(function*() {
              const first = yield* store.submit(signed.raw)
              const second = yield* store.submit(signed.raw)
              return { first, second } as const
            }),
        ),
        Then('both sides return the same first and second results')(({ result }) =>
          Effect.sync(() => {
            expect(normalizeSubmit(result.a.first)).toEqual(normalizeSubmit(result.b.first))
            expect(normalizeSubmit(result.a.second)).toEqual(normalizeSubmit(result.b.second))
          })
        ),
      ),
    )

    scenario(
      'Should_MatchBothSides_When_SignatureTampered',
      Gherkin.Do.pipe(
        contractPartsGiven,
        Given('a tampered signed statement')(
          'signed',
          ({ contractParts }) =>
            signedStatementOf(contractParts('pairwise-badproof')).pipe(Effect.map(withTamperedSignature)),
        ),
        pairwiseStores('submitted')(
          'result',
          ({ signed }) => (store) => store.submit(signed.raw),
        ),
        Then('Fake and Live results match')(({ result }) =>
          Effect.sync(() => expect(normalizeSubmit(result.a)).toEqual(normalizeSubmit(result.b)))
        ),
      ),
    )

    scenario(
      'Should_MatchBothSides_When_ProofMissingFromPayload',
      Gherkin.Do.pipe(
        contractPartsGiven,
        Given('a statement with proof stripped')(
          'withoutProof',
          ({ contractParts }) =>
            signedStatementOf(contractParts('pairwise-noproof')).pipe(
              Effect.map(({ raw }) => {
                const { proof: _, ...stripped } = raw
                return stripped
              }),
            ),
        ),
        pairwiseStores('submitted')(
          'result',
          ({ withoutProof }) => (store) => store.submit(withoutProof),
        ),
        Then('Fake and Live results match')(({ result }) =>
          Effect.sync(() => expect(normalizeSubmit(result.a)).toEqual(normalizeSubmit(result.b)))
        ),
      ),
    )

    scenario(
      'Should_MatchBothSides_When_ExpiryTimestampInPast',
      Gherkin.Do.pipe(
        contractPartsGiven,
        Given('a statement with a past expiry')(
          'signed',
          ({ contractParts }) => signedStatementOf({ ...contractParts('pairwise-expired'), expiry: 1n }),
        ),
        pairwiseStores('submitted')(
          'result',
          ({ signed }) => (store) => store.submit(signed.raw),
        ),
        Then('Fake and Live results match')(({ result }) =>
          Effect.sync(() => expect(normalizeSubmit(result.a)).toEqual(normalizeSubmit(result.b)))
        ),
      ),
    )

    scenario(
      'Should_MatchBothSides_When_StoredStatementExpiresAfterSubmit',
      Gherkin.Do.pipe(
        contractPartsGiven,
        pairwiseStores('a near-future-expiry statement is submitted, expires, then disappears')(
          'outcome',
          ({ contractParts }) => (store) =>
            Effect.gen(function*() {
              const nowMs = yield* Clock.currentTimeMillis
              const expirySec = Math.ceil(
                (nowMs + Duration.toMillis(streamExpiryLeadDuration)) / 1000,
              )
              const signed = yield* signedStatementOf({
                ...contractParts('pairwise-stream-expiry'),
                expiry: createExpiry(expirySec, 0),
              })

              const submit = yield* store.submit(signed.raw)
              const hash = expectedProjection(signed).statementHash
              const filtered = yield* waitUntilStatementFilteredFromGet(
                store,
                hash,
                Duration.sum(streamExpiryLeadDuration, streamExpirySettleBuffer),
              )

              return { submit: normalizeSubmit(submit), filtered }
            }),
        ),
        Then('both sides accepted the submission and later filtered the expired row')(({ outcome }) =>
          Effect.sync(() => {
            expect(outcome.a.submit).toEqual({ status: 'new' })
            expect(outcome.b.submit).toEqual({ status: 'new' })
            expect(outcome.a.filtered).toBe(true)
            expect(outcome.b.filtered).toBe(true)
          })
        ),
      ),
    )

    scenario(
      'Should_MatchBothSides_When_StatementHasNoTopics',
      Gherkin.Do.pipe(
        contractPartsGiven,
        Given('a statement signed with no topics')('raw', () => signedStatementWithoutTopics()),
        pairwiseStores('submitted')(
          'result',
          ({ raw }) => (store) => store.submit(raw),
        ),
        Then('Fake and Live results match')(({ result }) =>
          Effect.sync(() => expect(normalizeSubmit(result.a)).toEqual(normalizeSubmit(result.b)))
        ),
      ),
    )

    scenario(
      'Should_MatchBothSides_When_GetStatementsProjectAllFields',
      Gherkin.Do.pipe(
        contractPartsGiven,
        Given('a deterministic statement is submitted')(
          'fixture',
          ({ contractParts }) =>
            signedStatementOf(contractParts('pairwise-proj-all')).pipe(
              Effect.map((signed) => ({ signed, h: expectedProjection(signed).statementHash })),
            ),
        ),
        pairwiseStores('getStatements returns projected rows')(
          'result',
          ({ fixture }) => (store) =>
            Effect.gen(function*() {
              yield* store.submit(fixture.signed.raw)
              const all = yield* store.getStatements('any')
              const rows = normalizeProjection(all, projectComparable, [fixture.h])
              return rows[0]!
            }),
        ),
        Then('Fake and Live projection rows match')(({ result }) =>
          Effect.sync(() => expect(result.a).toEqual(result.b))
        ),
      ),
    )

    scenario(
      'Should_MatchBothSides_When_HashKeyIsBlake2256Encoded',
      Gherkin.Do.pipe(
        contractPartsGiven,
        Given('a deterministic statement is submitted')(
          'fixture',
          ({ contractParts }) =>
            signedStatementOf(contractParts('pairwise-blake')).pipe(
              Effect.map((signed) => ({
                signed,
                expectedHash: toHex(Blake2256(statementCodec.enc(signed.raw))),
              })),
            ),
        ),
        pairwiseStores('getStatements returns a row with the computed hash')(
          'result',
          ({ fixture }) => (store) =>
            Effect.gen(function*() {
              yield* store.submit(fixture.signed.raw)
              const all = yield* store.getStatements('any')
              const row = all.find((vs) => vs.statementHash === fixture.expectedHash)
              return row!.statementHash
            }),
        ),
        Then('Fake and Live hashes match')(({ result }) => Effect.sync(() => expect(result.a).toEqual(result.b))),
      ),
    )

    scenario(
      'Should_MatchBothSides_When_GetStatementsPreservesTopicOrder',
      Gherkin.Do.pipe(
        contractPartsGiven,
        Given('a deterministic multi-topic statement is submitted')(
          'fixture',
          ({ contractParts }) => {
            const topics = deterministicMultiTopics('pairwise-topic-order', 4)
            return signedStatementOf({ ...contractParts('pairwise-topic-order'), topics }).pipe(
              Effect.map((signed) => ({ signed, h: expectedProjection(signed).statementHash })),
            )
          },
        ),
        pairwiseStores('getStatements returns the row')(
          'result',
          ({ fixture }) => (store) =>
            Effect.gen(function*() {
              yield* store.submit(fixture.signed.raw)
              const all = yield* store.getStatements('any')
              const row = all.find((vs) => vs.statementHash === fixture.h)
              return { topics: [...row!.topics], row: projectComparable(row!) }
            }),
        ),
        Then('Fake and Live topic order and projection match')(({ result }) =>
          Effect.sync(() => expect(result.a).toEqual(result.b))
        ),
      ),
    )

    scenario(
      'Should_MatchBothSides_When_ChannelFieldOmitted',
      Gherkin.Do.pipe(
        contractPartsGiven,
        Given('a null-channel statement is submitted')(
          'fixture',
          ({ contractParts }) =>
            signedStatementOf({ ...contractParts('pairwise-null-chan'), channel: null }).pipe(
              Effect.map((signed) => ({ signed, h: expectedProjection(signed).statementHash })),
            ),
        ),
        pairwiseStores('getStatements returns the row')(
          'result',
          ({ fixture }) => (store) =>
            Effect.gen(function*() {
              yield* store.submit(fixture.signed.raw)
              const all = yield* store.getStatements('any')
              return projectComparable(all.find((vs) => vs.statementHash === fixture.h)!)
            }),
        ),
        Then('Fake and Live projected rows match')(({ result }) =>
          Effect.sync(() => expect(result.a).toEqual(result.b))
        ),
      ),
    )

    scenario(
      'Should_MatchBothSides_When_ExpiryOmittedFromPayload',
      Gherkin.Do.pipe(
        contractPartsGiven,
        Given('a null-expiry statement is submitted')(
          'fixture',
          ({ contractParts }) =>
            signedStatementOf({ ...contractParts('pairwise-null-exp'), expiry: null }).pipe(
              Effect.map((signed) => ({ signed })),
            ),
        ),
        pairwiseStores('submitted')(
          'result',
          ({ fixture }) => (store) => store.submit(fixture.signed.raw),
        ),
        Then('Fake and Live submit results match')(({ result }) =>
          Effect.sync(() => expect(normalizeSubmit(result.a)).toEqual(normalizeSubmit(result.b)))
        ),
      ),
    )

    scenario(
      'Should_MatchBothSides_When_PayloadUsesZeroByteData',
      Gherkin.Do.pipe(
        contractPartsGiven,
        Given('an empty-data statement is submitted')(
          'fixture',
          ({ contractParts }) =>
            signedStatementOf({ ...contractParts('pairwise-empty-data'), data: new Uint8Array(0) }).pipe(
              Effect.map((signed) => ({ signed, h: expectedProjection(signed).statementHash })),
            ),
        ),
        pairwiseStores('getStatements returns the row')(
          'result',
          ({ fixture }) => (store) =>
            Effect.gen(function*() {
              yield* store.submit(fixture.signed.raw)
              const all = yield* store.getStatements('any')
              return projectComparable(all.find((vs) => vs.statementHash === fixture.h)!)
            }),
        ),
        Then('Fake and Live projected rows match')(({ result }) =>
          Effect.sync(() => expect(result.a).toEqual(result.b))
        ),
      ),
    )

    scenario(
      'Should_MatchBothSides_When_SubscribePreservesTopicOrder',
      Gherkin.Do.pipe(
        contractPartsGiven,
        Given('a multi-topic statement is submitted')(
          'fixture',
          ({ contractParts }) => {
            const topics = deterministicMultiTopics('pairwise-sub-topics', 4)
            return signedStatementOf({ ...contractParts('pairwise-sub-topics'), topics }).pipe(
              Effect.map((signed) => ({ signed, expected: expectedProjection(signed) })),
            )
          },
        ),
        pairwiseStores('the subscription stream delivers the statement')(
          'result',
          ({ fixture }) => (store) =>
            Effect.gen(function*() {
              yield* store.submit(fixture.signed.raw)
              const observed = yield* observeOneFrom(store, fixture.expected.statementHash)
              return { topics: [...observed.topics], projected: projectComparable(observed) }
            }),
        ),
        Then('Fake and Live topic order and projection match')(({ result }) =>
          Effect.sync(() => expect(result.a).toEqual(result.b))
        ),
      ),
    )

    scenario(
      'Should_MatchBothSides_When_GetStatementsAppliesMixedTopicFilters',
      Gherkin.Do.pipe(
        contractPartsGiven,
        Given('three statements with distinct topics are submitted')(
          'fixture',
          ({ contractParts }) =>
            Effect.gen(function*() {
              const [topicA, topicB, topicC] = deterministicMultiTopics('pairwise-filters', 3)
              const one = yield* signedStatementOf({ ...contractParts('pairwise-f-one'), topics: [topicA] })
              const two = yield* signedStatementOf({ ...contractParts('pairwise-f-two'), topics: [topicB] })
              const both = yield* signedStatementOf({
                ...contractParts('pairwise-f-both'),
                topics: [topicA, topicB],
              })
              return {
                one,
                two,
                both,
                topicA,
                topicB,
                topicC,
                hOne: expectedProjection(one).statementHash,
                hTwo: expectedProjection(two).statementHash,
                hBoth: expectedProjection(both).statementHash,
              }
            }),
        ),
        pairwiseStores('getStatements with all filter variants')(
          'result',
          ({ fixture }) => (store) =>
            Effect.gen(function*() {
              const { topicA, topicB, topicC } = fixture
              yield* store.submit(fixture.one.raw)
              yield* store.submit(fixture.two.raw)
              yield* store.submit(fixture.both.raw)
              const anyRows = yield* store.getStatements('any')
              const matchAll = yield* store.getStatements({ matchAll: [topicA, topicB] })
              const matchAny = yield* store.getStatements({ matchAny: [topicA] })
              const noneMatch = yield* store.getStatements({ matchAll: [topicC] })
              const matchAllSingleA = yield* store.getStatements({ matchAll: [topicA] })
              const matchAnySingleA = yield* store.getStatements({ matchAny: [topicA] })
              return {
                flags: {
                  anyHasOne: anyRows.some((s) => String(s.statementHash) === fixture.hOne),
                  anyHasTwo: anyRows.some((s) => String(s.statementHash) === fixture.hTwo),
                  anyHasBoth: anyRows.some((s) => String(s.statementHash) === fixture.hBoth),
                  matchAllABHasBoth: matchAll.some((s) => String(s.statementHash) === fixture.hBoth),
                  matchAllABExcludesAOnly: !matchAll.some((s) => String(s.statementHash) === fixture.hOne),
                  matchAllABExcludesBOnly: !matchAll.some((s) => String(s.statementHash) === fixture.hTwo),
                  matchAnyAHasOne: matchAny.some((s) => String(s.statementHash) === fixture.hOne),
                  matchAnyAHasBoth: matchAny.some((s) => String(s.statementHash) === fixture.hBoth),
                  matchAnyAExcludesBOnly: !matchAny.some((s) => String(s.statementHash) === fixture.hTwo),
                },
                noLeakInTopicCFilter: normalizeFilters(noneMatch, [fixture.hOne, fixture.hTwo, fixture.hBoth]),
                singleTopicEquiv: matchAllSingleA.map((s) => String(s.statementHash)).toSorted().join(',') ===
                  matchAnySingleA.map((s) => String(s.statementHash)).toSorted().join(','),
              }
            }),
        ),
        Then('Fake and Live filter results match')(({ result }) =>
          Effect.sync(() => expect(result.a).toEqual(result.b))
        ),
      ),
    )

    scenario(
      'Should_MatchBothSides_When_SubscribeReplayAfterSubmit',
      Gherkin.Do.pipe(
        contractPartsGiven,
        Given('a deterministic statement is submitted')(
          'fixture',
          ({ contractParts }) =>
            signedStatementOf(contractParts('pairwise-replay-one')).pipe(
              Effect.map((signed) => ({ signed, expected: expectedProjection(signed) })),
            ),
        ),
        pairwiseStores('the subscription replays the statement')(
          'result',
          ({ fixture }) => (store) =>
            Effect.gen(function*() {
              yield* store.submit(fixture.signed.raw)
              const observed = yield* observeOneFrom(store, fixture.expected.statementHash)
              return projectComparable(observed)
            }),
        ),
        Then('Fake and Live projections match')(({ result }) => Effect.sync(() => expect(result.a).toEqual(result.b))),
      ),
    )

    scenario(
      'Should_MatchBothSides_When_SubscribeReplaysBothAfterSequentialSubmit',
      Gherkin.Do.pipe(
        contractPartsGiven,
        Given('two deterministic statements are prepared')('pair', ({ contractParts }) =>
          Effect.gen(function*() {
            const s1 = yield* signedStatementOf(contractParts('pairwise-rb-one'))
            const s2 = yield* signedStatementOf(contractParts('pairwise-rb-two'))
            return {
              s1,
              s2,
              h1: expectedProjection(s1).statementHash,
              h2: expectedProjection(s2).statementHash,
            }
          })),
        pairwiseStores('both are submitted then the replay stream is observed')(
          'result',
          ({ pair }) => (store) =>
            Effect.gen(function*() {
              const r1 = yield* store.submit(pair.s1.raw)
              const r2 = yield* store.submit(pair.s2.raw)
              expect(r1).toEqual({ status: 'new' })
              expect(r2).toEqual({ status: 'new' })
              yield* Effect.sleep(liveReplaySettleDuration)
              const batch = yield* observeBothHashesFrom(store, pair.h1, pair.h2)
              return normalizeStream(batch)
            }),
        ),
        Then('Fake and Live stream results match')(({ result }) =>
          Effect.sync(() => expect(result.a).toEqual(result.b))
        ),
      ),
    )

    scenario(
      'Should_MatchBothSides_When_SubscribeReplayMatchAllSubset',
      Gherkin.Do.pipe(
        contractPartsGiven,
        Given('a non-matching and a matching statement are prepared')(
          'fixture',
          ({ contractParts }) =>
            Effect.gen(function*() {
              const [topicA, topicB] = deterministicMultiTopics('pairwise-rmall', 2)
              const miss = yield* signedStatementOf({ ...contractParts('pairwise-rmall-miss'), topics: [topicA] })
              const hit = yield* signedStatementOf({
                ...contractParts('pairwise-rmall-hit'),
                topics: [topicA, topicB],
              })
              return { topicA, topicB, miss, hit, expected: expectedProjection(hit) }
            }),
        ),
        pairwiseStores('both submitted then filtered subscription replays matching statement')(
          'result',
          ({ fixture }) => (store) =>
            Effect.gen(function*() {
              yield* store.submit(fixture.miss.raw)
              yield* store.submit(fixture.hit.raw)
              const observed = yield* observeOneFilteredFrom(
                store,
                fixture.expected.statementHash,
                { matchAll: [fixture.topicA, fixture.topicB] },
              )
              return projectComparable(observed)
            }),
        ),
        Then('Fake and Live observed projections match')(({ result }) =>
          Effect.sync(() => expect(result.a).toEqual(result.b))
        ),
      ),
    )

    scenario(
      'Should_MatchBothSides_When_SubscribeEmitsAfterFork',
      Gherkin.Do.pipe(
        contractPartsGiven,
        Given('a deterministic statement and expected projection')(
          'fixture',
          ({ contractParts }) =>
            signedStatementOf(contractParts('pairwise-fork')).pipe(
              Effect.map((signed) => ({ signed, expected: expectedProjection(signed) })),
            ),
        ),
        pairwiseStores('an observer is forked then the statement is submitted after the scheduling lead')(
          'result',
          ({ fixture }) => (store) =>
            Effect.gen(function*() {
              const fiber = yield* Effect.fork(observeOneFrom(store, fixture.expected.statementHash))
              yield* Effect.sleep(subscribeBeforeSubmitLeadDuration)
              const submit = yield* store.submit(fixture.signed.raw)
              const observed = yield* Fiber.join(fiber)
              return { submit: normalizeSubmit(submit), projected: projectComparable(observed) }
            }),
        ),
        Then('Fake and Live submit results and projections match')(({ result }) =>
          Effect.sync(() => expect(result.a).toEqual(result.b))
        ),
      ),
    )

    scenario(
      'Should_MatchBothSides_When_SubscribedBeforeSequentialSubmits',
      Gherkin.Do.pipe(
        contractPartsGiven,
        Given('two deterministic statements are prepared')('pair', ({ contractParts }) =>
          Effect.gen(function*() {
            const s1 = yield* signedStatementOf(contractParts('pairwise-sbs-one'))
            const s2 = yield* signedStatementOf(contractParts('pairwise-sbs-two'))
            return {
              s1,
              s2,
              h1: expectedProjection(s1).statementHash,
              h2: expectedProjection(s2).statementHash,
            }
          })),
        pairwiseStores('batch observer forked then both submitted after the scheduling lead')(
          'result',
          ({ pair }) => (store) =>
            Effect.gen(function*() {
              const fiber = yield* Effect.fork(observeBothHashesFrom(store, pair.h1, pair.h2))
              yield* Effect.sleep(subscribeBeforeSubmitLeadDuration)
              yield* store.submit(pair.s1.raw)
              yield* store.submit(pair.s2.raw)
              const batch = yield* Fiber.join(fiber)
              return normalizeStream(batch)
            }),
        ),
        Then('Fake and Live stream results match')(({ result }) =>
          Effect.sync(() => expect(result.a).toEqual(result.b))
        ),
      ),
    )

    scenario(
      'Should_MatchBothSides_When_SubscribeFilterMatchAll',
      Gherkin.Do.pipe(
        contractPartsGiven,
        Given('a non-matching and a matching statement are prepared')(
          'fixture',
          ({ contractParts }) =>
            Effect.gen(function*() {
              const [topicA, topicB] = deterministicMultiTopics('pairwise-sfm-all', 2)
              const miss = yield* signedStatementOf({ ...contractParts('pairwise-sfm-miss'), topics: [topicA] })
              const hit = yield* signedStatementOf({ ...contractParts('pairwise-sfm-hit'), topics: [topicA, topicB] })
              return { topicA, topicB, miss, hit, expected: expectedProjection(hit) }
            }),
        ),
        pairwiseStores('matchAll observer forked then both submitted')(
          'result',
          ({ fixture }) => (store) =>
            Effect.gen(function*() {
              const fiber = yield* Effect.fork(
                observeOneFilteredFrom(store, fixture.expected.statementHash, {
                  matchAll: [fixture.topicA, fixture.topicB],
                }),
              )
              yield* store.submit(fixture.miss.raw)
              yield* store.submit(fixture.hit.raw)
              return projectComparable(yield* Fiber.join(fiber))
            }),
        ),
        Then('Fake and Live observed projections match')(({ result }) =>
          Effect.sync(() => expect(result.a).toEqual(result.b))
        ),
      ),
    )

    scenario(
      'Should_MatchBothSides_When_SubscribeFilterMatchAny',
      Gherkin.Do.pipe(
        contractPartsGiven,
        Given('a non-matching and a matching statement are prepared')(
          'fixture',
          ({ contractParts }) =>
            Effect.gen(function*() {
              const [topicA, topicB] = deterministicMultiTopics('pairwise-sfm-any', 2)
              const miss = yield* signedStatementOf({ ...contractParts('pairwise-sfa-miss'), topics: [topicA] })
              const hit = yield* signedStatementOf({ ...contractParts('pairwise-sfa-hit'), topics: [topicA, topicB] })
              return { topicA, topicB, miss, hit, expected: expectedProjection(hit) }
            }),
        ),
        pairwiseStores('matchAny observer forked then both submitted')(
          'result',
          ({ fixture }) => (store) =>
            Effect.gen(function*() {
              const fiber = yield* Effect.fork(
                observeOneFilteredFrom(store, fixture.expected.statementHash, { matchAny: [fixture.topicB] }),
              )
              yield* store.submit(fixture.miss.raw)
              yield* store.submit(fixture.hit.raw)
              return projectComparable(yield* Fiber.join(fiber))
            }),
        ),
        Then('Fake and Live observed projections match')(({ result }) =>
          Effect.sync(() => expect(result.a).toEqual(result.b))
        ),
      ),
    )

    scenario(
      'Should_MatchBothSides_When_ScopedThenFreshObserve',
      Gherkin.Do.pipe(
        contractPartsGiven,
        Given('deterministic statements for scoped-then-fresh observe')(
          'pair',
          ({ contractParts }) =>
            Effect.gen(function*() {
              const signed1 = yield* signedStatementOf(contractParts('pairwise-scoped-1'))
              const signed2 = yield* signedStatementOf(contractParts('pairwise-scoped-2'))
              return { signed1, signed2 }
            }),
        ),
        pairwiseStores('first submitted through scoped fiber then second submitted and observed')(
          'result',
          ({ pair }) => (store) =>
            Effect.gen(function*() {
              yield* Effect.scoped(
                Effect.gen(function*() {
                  const h1 = expectedProjection(pair.signed1).statementHash
                  const fiber = yield* Effect.fork(observeOneFrom(store, h1))
                  yield* Effect.sleep(subscribeBeforeSubmitLeadDuration)
                  yield* store.submit(pair.signed1.raw)
                  yield* Fiber.join(fiber)
                }),
              )
              const expected2 = expectedProjection(pair.signed2)
              yield* store.submit(pair.signed2.raw)
              const observed2 = yield* observeOneFrom(store, expected2.statementHash)
              return projectComparable(observed2)
            }),
        ),
        Then('Fake and Live second projections match')(({ result }) =>
          Effect.sync(() => expect(result.a).toEqual(result.b))
        ),
      ),
    )

    scenario(
      'Should_MatchBothSides_When_ConcurrentFibersObserveSameHash',
      Gherkin.Do.pipe(
        contractPartsGiven,
        Given('a deterministic statement and expected projection')(
          'fixture',
          ({ contractParts }) =>
            signedStatementOf(contractParts('pairwise-conc')).pipe(
              Effect.map((signed) => ({ signed, expected: expectedProjection(signed) })),
            ),
        ),
        pairwiseStores('two concurrent observers forked then statement submitted after lead')(
          'result',
          ({ fixture }) => (store) =>
            Effect.gen(function*() {
              const fiberOne = yield* Effect.fork(observeOneFrom(store, fixture.expected.statementHash))
              const fiberTwo = yield* Effect.fork(observeOneFrom(store, fixture.expected.statementHash))
              yield* Effect.sleep(subscribeBeforeSubmitLeadDuration)
              yield* store.submit(fixture.signed.raw)
              const one = yield* Fiber.join(fiberOne)
              const two = yield* Fiber.join(fiberTwo)
              return { one: projectComparable(one), two: projectComparable(two) }
            }),
        ),
        Then('Fake and Live concurrent observer results match')(({ result }) =>
          Effect.sync(() => expect(result.a).toEqual(result.b))
        ),
      ),
    )
  })
