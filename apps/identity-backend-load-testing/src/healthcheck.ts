import { check } from 'k6'
import { observedGet } from './lib/observed-http'
import { endRun, type RunContext, startRun } from './lib/run-lifecycle'

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080'

export const options = {
  scenarios: {
    health: {
      executor: 'constant-arrival-rate',
      rate: 50,
      timeUnit: '1s',
      duration: '60s',
      preAllocatedVUs: 5,
      maxVUs: 20,
    },
  },
  thresholds: {
    checks: ['rate>0.99'],
    'http_req_failed{endpoint:health}': ['rate<0.001'],
    'server_processing_time{endpoint:health}': ['p(95)<50', 'p(99)<200'],
  },
}

interface HealthBody {
  message: string
  timestamp: number
  uptime: number
}

export function setup(): RunContext {
  return startRun(BASE_URL, false)
}

export default function(ctx: RunContext) {
  const res = observedGet(`${ctx.baseUrl}/healthcheck`, { scenario: 'health', endpoint: 'health' })

  check(res, {
    'healthcheck status 200': (r) => r.status === 200,
    'healthcheck reports OK with db reachable': (r) => {
      try {
        const body = r.json() as unknown as HealthBody
        return body.message === 'OK' && typeof body.timestamp === 'number' && typeof body.uptime === 'number'
      } catch {
        return false
      }
    },
  }, { scenario: 'health', endpoint: 'health' })
}

export function teardown(ctx: RunContext) {
  endRun(ctx, 'health')
}
