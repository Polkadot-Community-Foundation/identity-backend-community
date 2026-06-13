import { endRun, type RunContext, startRun } from './lib/run-lifecycle'
import { runSearchIteration } from './lib/search-flow'
import { FULL_PREFIXES, MEDIUM_PREFIXES, SHORT_PREFIXES } from './lib/usernames'

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080'
const SPIKE_RPS = parseInt(__ENV.SPIKE_RPS || '1500', 10)
const BASELINE_RPS = parseInt(__ENV.BASELINE_RPS || '50', 10)
const USE_POC = __ENV.POC === 'on'

const ALL_PREFIXES = [...SHORT_PREFIXES, ...MEDIUM_PREFIXES, ...FULL_PREFIXES]

export const options = {
  scenarios: {
    spike: {
      executor: 'ramping-arrival-rate',
      startRate: BASELINE_RPS,
      timeUnit: '1s',
      preAllocatedVUs: 100,
      maxVUs: 2000,
      stages: [
        { duration: '30s', target: BASELINE_RPS },
        { duration: '10s', target: SPIKE_RPS },
        { duration: '1m', target: SPIKE_RPS },
        { duration: '10s', target: BASELINE_RPS },
        { duration: '1m', target: BASELINE_RPS },
        { duration: '10s', target: 0 },
      ],
      gracefulStop: '15s',
    },
  },
  thresholds: {
    checks: ['rate>0.95'],
    correctness_failures: ['count<1'],
    'http_req_failed{endpoint:usernames_search}': ['rate<0.10'],
    'server_processing_time{endpoint:usernames_search}': ['p(95)<3000', 'p(99)<8000'],
  },
}

export function setup(): RunContext {
  return startRun(BASE_URL, USE_POC)
}

export default function(ctx: RunContext) {
  runSearchIteration({
    baseUrl: ctx.baseUrl,
    scenario: 'spike',
    prefixes: ALL_PREFIXES,
    limit: 20,
    usePoc: USE_POC,
    paginate: false,
    validateBody: false,
  })
}

export function teardown(ctx: RunContext) {
  endRun(ctx, 'spike')
}
