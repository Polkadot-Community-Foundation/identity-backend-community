import { ParseResult, Schema as S } from 'effect'

import {
  BlockCount,
  ByteSize,
  ConnectionCount,
  DeadlockCount,
  PgStatsSnapshot,
  SessionCount,
} from './pg-stats.schema.js'

const NonNegativeFromString = S.NumberFromString.pipe(S.greaterThanOrEqualTo(0))

const SessionBreakdownForeign = S.Struct({
  total: NonNegativeFromString,
  active: NonNegativeFromString,
  idle: NonNegativeFromString,
  idle_in_transaction: NonNegativeFromString,
  waiting: NonNegativeFromString,
})

const DatabaseStatsForeign = S.Struct({
  blks_hit: NonNegativeFromString,
  blks_read: NonNegativeFromString,
  deadlocks: NonNegativeFromString,
})

const DatabaseSizeForeign = S.Struct({
  size_bytes: NonNegativeFromString,
})

const ServerConnectionsForeign = S.Struct({
  total_connections: NonNegativeFromString,
})

const RawPgStats = S.Struct({
  sessionBreakdown: S.NonEmptyArray(SessionBreakdownForeign),
  databaseStats: S.NonEmptyArray(DatabaseStatsForeign),
  databaseSize: S.NonEmptyArray(DatabaseSizeForeign),
  serverConnections: S.NonEmptyArray(ServerConnectionsForeign),
}).pipe(S.annotations({ identifier: 'RawPgStats' }))

const decodeSnapshot = ParseResult.decode(PgStatsSnapshot)

export const PgStatsSnapshotFromRaw = S.transformOrFail(RawPgStats, PgStatsSnapshot, {
  strict: true,
  decode: (raw) => {
    const [session] = raw.sessionBreakdown
    const [stats] = raw.databaseStats
    const [size] = raw.databaseSize
    const [server] = raw.serverConnections
    return decodeSnapshot({
      sessionsTotal: session.total,
      sessionsActive: session.active,
      sessionsIdle: session.idle,
      sessionsIdleInTransaction: session.idle_in_transaction,
      sessionsWaitingLock: session.waiting,
      blksHit: stats.blks_hit,
      blksRead: stats.blks_read,
      deadlocks: stats.deadlocks,
      databaseSizeBytes: size.size_bytes,
      serverConnections: server.total_connections,
    })
  },
  encode: (_toI, _options, ast, toA) =>
    ParseResult.fail(new ParseResult.Forbidden(ast, toA, 'PgStatsSnapshotFromRaw is decode-only')),
}).pipe(S.annotations({ identifier: 'PgStatsSnapshotFromRaw' }))

const MaxConnectionsForeign = S.Struct({
  max_connections: NonNegativeFromString,
})

const decodeConnectionCount = ParseResult.decode(ConnectionCount)

export const ServerMaxConnectionsFromRaw = S.transformOrFail(
  S.NonEmptyArray(MaxConnectionsForeign),
  ConnectionCount,
  {
    strict: true,
    decode: (rows) => decodeConnectionCount(rows[0].max_connections),
    encode: (_toI, _options, ast, toA) =>
      ParseResult.fail(new ParseResult.Forbidden(ast, toA, 'ServerMaxConnectionsFromRaw is decode-only')),
  },
).pipe(S.annotations({ identifier: 'ServerMaxConnectionsFromRaw' }))

const DatabaseIoDecoded = S.Struct({
  blksHit: BlockCount,
  blksRead: BlockCount,
  deadlocks: DeadlockCount,
})

const RawDatabaseIo = S.NonEmptyArray(DatabaseStatsForeign).pipe(
  S.annotations({ identifier: 'RawDatabaseIo' }),
)

export const DatabaseIoFromRaw = S.transformOrFail(
  RawDatabaseIo,
  DatabaseIoDecoded,
  {
    strict: true,
    decode: (rows) => {
      const [stats] = rows
      return ParseResult.decode(DatabaseIoDecoded)({
        blksHit: stats.blks_hit,
        blksRead: stats.blks_read,
        deadlocks: stats.deadlocks,
      })
    },
    encode: (_toI, _options, ast, toA) =>
      ParseResult.fail(new ParseResult.Forbidden(ast, toA, 'DatabaseIoFromRaw is decode-only')),
  },
).pipe(S.annotations({ identifier: 'DatabaseIoFromRaw' }))

const SessionsDecoded = S.Struct({
  sessionsTotal: SessionCount,
  sessionsActive: SessionCount,
  sessionsIdle: SessionCount,
  sessionsIdleInTransaction: SessionCount,
  sessionsWaitingLock: SessionCount,
})

const RawSessions = S.NonEmptyArray(SessionBreakdownForeign).pipe(
  S.annotations({ identifier: 'RawSessions' }),
)

export const SessionsFromRaw = S.transformOrFail(
  RawSessions,
  SessionsDecoded,
  {
    strict: true,
    decode: (rows) => {
      const [session] = rows
      return ParseResult.decode(SessionsDecoded)({
        sessionsTotal: session.total,
        sessionsActive: session.active,
        sessionsIdle: session.idle,
        sessionsIdleInTransaction: session.idle_in_transaction,
        sessionsWaitingLock: session.waiting,
      })
    },
    encode: (_toI, _options, ast, toA) =>
      ParseResult.fail(new ParseResult.Forbidden(ast, toA, 'SessionsFromRaw is decode-only')),
  },
).pipe(S.annotations({ identifier: 'SessionsFromRaw' }))

const ServerConnectionsDecoded = S.Struct({
  totalConnections: ConnectionCount,
})

const RawServerConnections = S.NonEmptyArray(ServerConnectionsForeign).pipe(
  S.annotations({ identifier: 'RawServerConnections' }),
)

export const ServerConnectionsFromRaw = S.transformOrFail(
  RawServerConnections,
  ServerConnectionsDecoded,
  {
    strict: true,
    decode: (rows) => {
      const [server] = rows
      return ParseResult.decode(ServerConnectionsDecoded)({
        totalConnections: server.total_connections,
      })
    },
    encode: (_toI, _options, ast, toA) =>
      ParseResult.fail(new ParseResult.Forbidden(ast, toA, 'ServerConnectionsFromRaw is decode-only')),
  },
).pipe(S.annotations({ identifier: 'ServerConnectionsFromRaw' }))

const DatabaseSizeDecoded = S.Struct({
  sizeBytes: ByteSize,
})

const RawDatabaseSize = S.NonEmptyArray(DatabaseSizeForeign).pipe(
  S.annotations({ identifier: 'RawDatabaseSize' }),
)

export const DatabaseSizeFromRaw = S.transformOrFail(
  RawDatabaseSize,
  DatabaseSizeDecoded,
  {
    strict: true,
    decode: (rows) => {
      const [size] = rows
      return ParseResult.decode(DatabaseSizeDecoded)({
        sizeBytes: size.size_bytes,
      })
    },
    encode: (_toI, _options, ast, toA) =>
      ParseResult.fail(new ParseResult.Forbidden(ast, toA, 'DatabaseSizeFromRaw is decode-only')),
  },
).pipe(S.annotations({ identifier: 'DatabaseSizeFromRaw' }))
