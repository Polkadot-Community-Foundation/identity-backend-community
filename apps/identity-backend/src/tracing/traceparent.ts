import type { SpanContext } from '@opentelemetry/api'

/**
 * Parse W3C traceparent header into SpanContext.
 * @see https://www.w3.org/TR/trace-context/#trace-id
 * @see https://www.w3.org/TR/trace-context/#parent-id
 * @see https://www.w3.org/TR/trace-context/#trace-flags
 */
export const parseTraceparent = (header: string): SpanContext | null => {
  const parts = header.split('-')
  if (parts.length !== 4) return null

  const version = parts[0]!
  const traceId = parts[1]!
  const spanId = parts[2]!
  const flags = parts[3]!

  // version should be 00 (W3C Level 2)
  if (version !== '00') return null

  // traceId must be 32 hex chars, spanId must be 16 hex chars
  const traceIdRegex = /^[0-9a-f]{32}$/i
  if (!traceIdRegex.test(traceId)) return null

  const spanIdRegex = /^[0-9a-f]{16}$/i
  if (!spanIdRegex.test(spanId)) return null

  const traceFlags = parseInt(flags, 16)
  if (isNaN(traceFlags)) return null

  return {
    traceId,
    spanId,
    traceFlags,
    isRemote: true,
  }
}
