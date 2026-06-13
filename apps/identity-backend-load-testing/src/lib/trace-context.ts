import crypto from 'k6/crypto'
import { bytesToHex } from './bytes'

const TRACE_ID_BYTES = 16
const SPAN_ID_BYTES = 8
const SAMPLED_FLAGS = '01'
const TRACEPARENT_VERSION = '00'

export const RUN_ID = __ENV.LOADTEST_RUN_ID || 'local-dev'

export function newTraceId(): string {
  return bytesToHex(crypto.randomBytes(TRACE_ID_BYTES))
}

export function newSpanId(): string {
  return bytesToHex(crypto.randomBytes(SPAN_ID_BYTES))
}

export function newTraceparent(): string {
  return `${TRACEPARENT_VERSION}-${newTraceId()}-${newSpanId()}-${SAMPLED_FLAGS}`
}

export function loadTestUserAgent(scenario: string): string {
  return `k6-loadtest/${RUN_ID} (scenario:${scenario})`
}

export function tracedHeaders(scenario: string, extra?: Record<string, string>): Record<string, string> {
  return {
    traceparent: newTraceparent(),
    'User-Agent': loadTestUserAgent(scenario),
    baggage: `loadtest=true,loadtest.run=${RUN_ID},loadtest.scenario=${scenario}`,
    ...extra,
  }
}
