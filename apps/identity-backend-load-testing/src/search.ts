import exec from 'k6/execution'
import { endRun, type RunContext, startRun } from './lib/run-lifecycle'
import { runSearchIteration } from './lib/search-flow'
import { FULL_PREFIXES, MEDIUM_PREFIXES, SHORT_PREFIXES, SPARSE_PREFIXES } from './lib/usernames'

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080'
const USE_POC = __ENV.POC === 'on'
const SMOKE_MODE = __ENV.SMOKE === '1'
const SEARCH_LIMIT = parseInt(__ENV.SEARCH_LIMIT || '20', 10)

const rampStages = (bucket: string) => ({
  executor: 'ramping-arrival-rate' as const,
  startRate: 5,
  timeUnit: '1s',
  preAllocatedVUs: 20,
  maxVUs: 50,
  stages: [
    { duration: '30s', target: 10 },
    { duration: '60s', target: 20 },
    { duration: '30s', target: 0 },
  ],
  gracefulStop: '10s',
  env: { BUCKET: bucket },
})

export const options = {
  scenarios: SMOKE_MODE
    ? { smoke_all: { executor: 'constant-vus', vus: 5, duration: '30s', gracefulStop: '5s' } }
    : {
      short_prefix: rampStages('short'),
      medium_prefix: rampStages('medium'),
      full_prefix: rampStages('full'),
      sparse_prefix: rampStages('sparse'),
    },
  thresholds: {
    checks: ['rate>0.99'],
    'http_req_failed{endpoint:usernames_search}': ['rate<0.01'],
    'server_processing_time{endpoint:usernames_search}': ['p(95)<300', 'p(99)<1000'],
    correctness_failures: ['count<1'],
  },
}

function poolForBucket(bucket: string | undefined): readonly string[] {
  switch (bucket) {
    case 'short':
      return SHORT_PREFIXES
    case 'medium':
      return MEDIUM_PREFIXES
    case 'full':
      return FULL_PREFIXES
    case 'sparse':
      return SPARSE_PREFIXES
    default:
      return [...SHORT_PREFIXES, ...MEDIUM_PREFIXES, ...FULL_PREFIXES]
  }
}

export function setup(): RunContext {
  return startRun(BASE_URL, USE_POC)
}

export default function(ctx: RunContext) {
  runSearchIteration({
    baseUrl: ctx.baseUrl,
    scenario: exec.scenario.name,
    prefixes: poolForBucket(__ENV.BUCKET),
    limit: SEARCH_LIMIT,
    usePoc: USE_POC,
    paginate: true,
    validateBody: true,
  })
}

export function teardown(ctx: RunContext) {
  endRun(ctx, 'search')
}
