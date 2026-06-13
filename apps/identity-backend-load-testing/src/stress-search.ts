import { endRun, type RunContext, startRun } from './lib/run-lifecycle'
import { runSearchIteration } from './lib/search-flow'
import { FULL_PREFIXES, MEDIUM_PREFIXES, SHORT_PREFIXES } from './lib/usernames'

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080'
const PEAK_RPS = parseInt(__ENV.PEAK_RPS || '2000', 10)
const SOAK_DURATION = __ENV.SOAK_DURATION || '2m'
const USE_POC = __ENV.POC === 'on'

const ALL_PREFIXES = [...SHORT_PREFIXES, ...MEDIUM_PREFIXES, ...FULL_PREFIXES]

export const options = {
  scenarios: {
    ramp_to_failure: {
      executor: 'ramping-arrival-rate',
      startRate: 10,
      timeUnit: '1s',
      preAllocatedVUs: 200,
      maxVUs: 3000,
      stages: [
        { duration: '30s', target: Math.floor(PEAK_RPS / 4) },
        { duration: '30s', target: Math.floor(PEAK_RPS / 2) },
        { duration: '30s', target: PEAK_RPS },
        { duration: SOAK_DURATION, target: PEAK_RPS },
        { duration: '30s', target: 0 },
      ],
      gracefulStop: '15s',
    },
  },
  thresholds: {
    checks: ['rate>0.95'],
    correctness_failures: ['count<1'],
    'http_req_failed{endpoint:usernames_search}': [
      { threshold: 'rate<0.10', abortOnFail: true, delayAbortEval: '30s' },
    ],
    'server_processing_time{endpoint:usernames_search}': ['p(95)<2000', 'p(99)<5000'],
  },
}

export function setup(): RunContext {
  return startRun(BASE_URL, USE_POC)
}

export default function(ctx: RunContext) {
  runSearchIteration({
    baseUrl: ctx.baseUrl,
    scenario: 'stress',
    prefixes: ALL_PREFIXES,
    limit: 20,
    usePoc: USE_POC,
    paginate: false,
    validateBody: false,
  })
}

export function teardown(ctx: RunContext) {
  endRun(ctx, 'stress')
}
