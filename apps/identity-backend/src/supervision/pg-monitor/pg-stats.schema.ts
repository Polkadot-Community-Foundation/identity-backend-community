import { Schema as S } from 'effect'

export const SessionCount = S.NonNegativeInt.pipe(S.brand('SessionCount'))
export type SessionCount = S.Schema.Type<typeof SessionCount>

export const ConnectionCount = S.NonNegativeInt.pipe(S.brand('ConnectionCount'))
export type ConnectionCount = S.Schema.Type<typeof ConnectionCount>

export const BlockCount = S.NonNegativeInt.pipe(S.brand('BlockCount'))
export type BlockCount = S.Schema.Type<typeof BlockCount>

export const DeadlockCount = S.NonNegativeInt.pipe(S.brand('DeadlockCount'))
export type DeadlockCount = S.Schema.Type<typeof DeadlockCount>

export const ByteSize = S.NonNegativeInt.pipe(S.brand('ByteSize'))
export type ByteSize = S.Schema.Type<typeof ByteSize>

export class PgStatsSnapshot extends S.Class<PgStatsSnapshot>('PgStatsSnapshot')({
  sessionsTotal: SessionCount,
  sessionsActive: SessionCount,
  sessionsIdle: SessionCount,
  sessionsIdleInTransaction: SessionCount,
  sessionsWaitingLock: SessionCount,
  blksHit: BlockCount,
  blksRead: BlockCount,
  deadlocks: DeadlockCount,
  databaseSizeBytes: ByteSize,
  serverConnections: ConnectionCount,
}) {}
