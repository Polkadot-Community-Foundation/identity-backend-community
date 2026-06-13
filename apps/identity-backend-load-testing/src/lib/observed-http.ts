import { sleep } from 'k6'
import http, { type RefinedResponse, type RequestParams } from 'k6/http'
import { Counter, Trend } from 'k6/metrics'
import { tracedHeaders } from './trace-context'

export const serverProcessingTime = new Trend('server_processing_time', true)
export const networkOverheadTime = new Trend('network_overhead_time', true)
export const tracedRequests = new Counter('traced_requests')
export const correctnessFailures = new Counter('correctness_failures')
export const errorEnvelopeResponses = new Counter('error_envelope_responses')
export const unknownStatusValues = new Counter('unknown_status_values')
export const rateLimitHits = new Counter('rate_limit_hits')
export const pocSolveIterations = new Trend('poc_solve_iterations')

const TOO_MANY_REQUESTS = 429
const MAX_RETRY_ATTEMPTS = 5
const DEFAULT_BACKOFF_SECONDS = 1
const MAX_BACKOFF_SECONDS = 60

export interface ObservedRequest {
  scenario: string
  endpoint: string
  headers?: Record<string, string>
  body?: string | null
}

function recordTimings(res: RefinedResponse, scenario: string, endpoint: string): void {
  const tags = { scenario, endpoint }
  serverProcessingTime.add(res.timings.waiting, tags)
  networkOverheadTime.add(res.timings.duration - res.timings.waiting, tags)
  tracedRequests.add(1, tags)
}

function paramsFor(req: ObservedRequest): RequestParams {
  return {
    headers: tracedHeaders(req.scenario, req.headers),
    tags: { scenario: req.scenario, endpoint: req.endpoint },
  }
}

export function retryAfterSeconds(headerValue: string | undefined): number {
  if (headerValue === undefined || headerValue.length === 0) return DEFAULT_BACKOFF_SECONDS
  const asNumber = Number(headerValue)
  if (Number.isFinite(asNumber) && asNumber >= 0) {
    return Math.min(asNumber, MAX_BACKOFF_SECONDS)
  }
  const asDate = Date.parse(headerValue)
  if (Number.isFinite(asDate)) {
    return Math.min(Math.max(0, Math.ceil((asDate - Date.now()) / 1000)), MAX_BACKOFF_SECONDS)
  }
  return DEFAULT_BACKOFF_SECONDS
}

function withJitter(seconds: number): number {
  return seconds * (0.9 + Math.random() * 0.2)
}

function respectingRateLimit(
  res: RefinedResponse,
  req: ObservedRequest,
  send: () => RefinedResponse,
  attemptsLeft: number,
): RefinedResponse {
  if (res.status !== TOO_MANY_REQUESTS) return res
  if (attemptsLeft <= 0) return res
  rateLimitHits.add(1, { scenario: req.scenario, endpoint: req.endpoint })
  sleep(withJitter(retryAfterSeconds(res.headers['Retry-After'])))
  return respectingRateLimit(send(), req, send, attemptsLeft - 1)
}

export function observedGet(url: string, req: ObservedRequest): RefinedResponse {
  const send = () => http.get(url, paramsFor(req))
  const res = respectingRateLimit(send(), req, send, MAX_RETRY_ATTEMPTS)
  recordTimings(res, req.scenario, req.endpoint)
  return res
}

export function observedPost(url: string, req: ObservedRequest): RefinedResponse {
  const send = () => http.post(url, req.body ?? null, paramsFor(req))
  const res = respectingRateLimit(send(), req, send, MAX_RETRY_ATTEMPTS)
  recordTimings(res, req.scenario, req.endpoint)
  return res
}
