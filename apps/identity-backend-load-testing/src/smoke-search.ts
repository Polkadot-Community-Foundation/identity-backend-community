import { endRun, type RunContext, startRun } from './lib/run-lifecycle'
import { runSearchIteration } from './lib/search-flow'
import { FULL_PREFIXES } from './lib/usernames'

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080'
const USE_POC = __ENV.POC === 'on'

export const options = {
  scenarios: {
    smoke: { executor: 'constant-vus', vus: 5, duration: '30s' },
  },
  thresholds: {
    checks: ['rate>0.99'],
    'http_req_failed{endpoint:usernames_search}': ['rate<0.01'],
    'server_processing_time{endpoint:usernames_search}': ['p(95)<500', 'p(99)<1500'],
    correctness_failures: ['count<1'],
  },
}

export function setup(): RunContext {
  return startRun(BASE_URL, USE_POC)
}

export default function(ctx: RunContext) {
  runSearchIteration({
    baseUrl: ctx.baseUrl,
    scenario: 'smoke',
    prefixes: FULL_PREFIXES,
    limit: 20,
    usePoc: USE_POC,
    paginate: true,
    validateBody: true,
  })
}

export function teardown(ctx: RunContext) {
  endRun(ctx, 'smoke')
}
