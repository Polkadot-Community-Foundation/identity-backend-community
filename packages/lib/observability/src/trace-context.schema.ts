import { StrictHex } from '@identity-backend/schema-extensions'
import { FastCheck, Schema as S } from 'effect'

const TRACE_ID_LENGTH = 32
const SPAN_ID_LENGTH = 16

const ALL_ZERO_TRACE_ID = '0'.repeat(TRACE_ID_LENGTH)
const ALL_ZERO_SPAN_ID = '0'.repeat(SPAN_ID_LENGTH)

const nonZeroHexOfLength = (length: number) => (fc: typeof FastCheck) =>
  fc.hexaString({ minLength: length, maxLength: length }).map((hex) =>
    hex === '0'.repeat(length) ? `1${hex.slice(1)}` : hex
  )

export const TraceId = StrictHex.pipe(
  S.length(TRACE_ID_LENGTH),
  S.filter((value) => value !== ALL_ZERO_TRACE_ID || 'W3C trace-id of all zeroes is forbidden'),
  S.annotations({ identifier: 'TraceId', arbitrary: () => nonZeroHexOfLength(TRACE_ID_LENGTH) }),
  S.brand('TraceId'),
)
export type TraceId = S.Schema.Type<typeof TraceId>

export const SpanId = StrictHex.pipe(
  S.length(SPAN_ID_LENGTH),
  S.filter((value) => value !== ALL_ZERO_SPAN_ID || 'W3C parent-id of all zeroes is forbidden'),
  S.annotations({ identifier: 'SpanId', arbitrary: () => nonZeroHexOfLength(SPAN_ID_LENGTH) }),
  S.brand('SpanId'),
)
export type SpanId = S.Schema.Type<typeof SpanId>

export const TraceFlags = S.Int.pipe(S.between(0x00, 0xff), S.brand('TraceFlags'))
export type TraceFlags = S.Schema.Type<typeof TraceFlags>

export const TraceContext = S.Struct({
  traceId: TraceId,
  parentId: SpanId,
  traceFlags: TraceFlags,
})
export type TraceContext = S.Schema.Type<typeof TraceContext>

export const SAMPLED_FLAG = 0x01
