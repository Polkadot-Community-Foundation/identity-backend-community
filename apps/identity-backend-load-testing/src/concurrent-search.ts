import { sleep } from 'k6'
import { endRun, type RunContext, startRun } from './lib/run-lifecycle'
import { runSearchIteration } from './lib/search-flow'
import { FULL_PREFIXES, MEDIUM_PREFIXES, SHORT_PREFIXES } from './lib/usernames'

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080'
const TARGET_VUS = parseInt(__ENV.VUS || '2000', 10)
const SOAK_DURATION = __ENV.SOAK_DURATION || '2m'
const THINK_TIME = parseFloat(__ENV.THINK_TIME || '1')
const USE_POC = __ENV.POC === 'on'

const ALL_PREFIXES = [...SHORT_PREFIXES, ...MEDIUM_PREFIXES, ...FULL_PREFIXES]

export const options = {
  scenarios: {
    concurrent_users: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: Math.floor(TARGET_VUS / 4) },
        { duration: '30s', target: Math.floor(TARGET_VUS / 2) },
        { duration: '30s', target: TARGET_VUS },
        { duration: SOAK_DURATION, target: TARGET_VUS },
        { duration: '30s', target: 0 },
      ],
      gracefulRampDown: '15s',
      gracefulStop: '15s',
    },
  },
  thresholds: {
    checks: ['rate>0.95'],
    correctness_failures: ['count<1'],
    'http_req_failed{endpoint:usernames_search}': ['rate<0.10'],
    'server_processing_time{endpoint:usernames_search}': ['p(95)<2000', 'p(99)<5000'],
  },
}

export function setup(): RunContext {
  return startRun(BASE_URL, USE_POC)
}

export default function(ctx: RunContext) {
  runSearchIteration({
    baseUrl: ctx.baseUrl,
    scenario: 'concurrent',
    prefixes: ALL_PREFIXES,
    limit: 20,
    usePoc: USE_POC,
    paginate: false,
    validateBody: false,
  })
  sleep(THINK_TIME)
}

export function teardown(ctx: RunContext) {
  endRun(ctx, 'concurrent')
}
