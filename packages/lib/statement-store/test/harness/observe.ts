import type { TopicFilter } from '@novasamatech/sdk-statement'
import { Chunk, Duration, Effect, HashSet, Stream } from 'effect'
import type { StatementStoreService } from '../../src/index.js'

export const observeOne = (
  store: StatementStoreService.Definition,
  expectedHash: string,
  waitForEmit: Duration.DurationInput,
) =>
  store.subscribeStatements().pipe(
    Stream.filter((vs) => vs.statementHash === expectedHash),
    Stream.take(1),
    Stream.runCollect,
    Effect.timeout(waitForEmit),
    Effect.map((c) => Chunk.toReadonlyArray(c)[0]!),
  )

export const observeOneFiltered = (
  store: StatementStoreService.Definition,
  expectedHash: string,
  filter: TopicFilter,
  waitForEmit: Duration.DurationInput,
) =>
  store.subscribeStatements(filter).pipe(
    Stream.filter((vs) => vs.statementHash === expectedHash),
    Stream.take(1),
    Stream.runCollect,
    Effect.timeout(waitForEmit),
    Effect.map((c) => Chunk.toReadonlyArray(c)[0]!),
  )

export const observeBothHashes = (
  store: StatementStoreService.Definition,
  h1: string,
  h2: string,
  waitForEmit: Duration.DurationInput,
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
    Effect.timeout(waitForEmit),
    Effect.map((c) => Chunk.toReadonlyArray(c)),
  )
