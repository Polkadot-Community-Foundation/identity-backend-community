import { check } from 'k6'
import { observedPost } from './lib/observed-http'
import { endRun, type RunContext, startRun } from './lib/run-lifecycle'

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080'

export const options = {
  scenarios: {
    auth_challenges: {
      executor: 'constant-arrival-rate',
      rate: 10,
      timeUnit: '1s',
      duration: '30s',
      preAllocatedVUs: 5,
      maxVUs: 10,
    },
  },
  thresholds: {
    checks: ['rate>0.99'],
    'http_req_failed{endpoint:auth_challenges}': ['rate<0.05'],
    'server_processing_time{endpoint:auth_challenges}': ['p(95)<500', 'p(99)<1500'],
  },
}

export function setup(): RunContext {
  return startRun(BASE_URL, false)
}

export default function(ctx: RunContext) {
  const res = observedPost(`${ctx.baseUrl}/api/v1/auth/challenges`, {
    scenario: 'auth_challenges',
    endpoint: 'auth_challenges',
  })

  check(res, {
    'auth challenge status 201': (r) => r.status === 201,
    'auth challenge returns a non-empty challenge': (r) => {
      try {
        const data = r.json() as Record<string, unknown>
        return typeof data.challenge === 'string' && data.challenge.length > 0
      } catch {
        return false
      }
    },
  }, { scenario: 'auth_challenges', endpoint: 'auth_challenges' })
}

export function teardown(ctx: RunContext) {
  endRun(ctx, 'auth_challenges')
}
