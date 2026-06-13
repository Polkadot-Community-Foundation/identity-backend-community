import { check } from 'k6'
import { generateJwtPool } from './lib/jwt'
import { observedGet, observedPost } from './lib/observed-http'
import { endRun, type RunContext, startRun } from './lib/run-lifecycle'

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080'
const JWT_SECRET = __ENV.JWT_SECRET || 'test-secret'
const SMOKE_MODE = __ENV.SMOKE === '1'

const JWT_POOL = generateJwtPool(JWT_SECRET, 10, 'load-test')

export const options = {
  scenarios: {
    subscriptions: {
      executor: SMOKE_MODE ? 'constant-vus' : 'ramping-arrival-rate',
      ...(SMOKE_MODE
        ? { vus: 3, duration: '30s' }
        : {
          startRate: 2,
          timeUnit: '1s',
          preAllocatedVUs: 5,
          maxVUs: 20,
          stages: [
            { duration: '30s', target: 10 },
            { duration: '30s', target: 10 },
          ],
        }),
      gracefulStop: '10s',
    },
  },
  thresholds: {
    checks: ['rate>0.99'],
    'http_req_failed{endpoint:subscriptions_create}': ['rate<0.01'],
    'http_req_failed{endpoint:subscriptions_list}': ['rate<0.01'],
    'server_processing_time{endpoint:subscriptions_create}': ['p(95)<500', 'p(99)<1500'],
    'server_processing_time{endpoint:subscriptions_list}': ['p(95)<500', 'p(99)<1500'],
  },
}

export function setup(): RunContext {
  return startRun(BASE_URL, false)
}

export default function(ctx: RunContext) {
  const jwt = JWT_POOL[Math.floor(Math.random() * JWT_POOL.length)]!
  const auth = { Authorization: `Bearer ${jwt.token}` }

  const createRes = observedPost(`${ctx.baseUrl}/api/v1/subscriptions`, {
    scenario: 'subscriptions',
    endpoint: 'subscriptions_create',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      notificationType: 'fcm',
      token: `test-token-${Math.random().toString(36).substring(2, 10)}`,
    }),
  })

  check(createRes, {
    'create subscription 201 (created) or 200 (updated)': (r) => r.status === 201 || r.status === 200,
  }, { scenario: 'subscriptions', endpoint: 'subscriptions_create' })

  const listRes = observedGet(`${ctx.baseUrl}/api/v1/subscriptions`, {
    scenario: 'subscriptions',
    endpoint: 'subscriptions_list',
    headers: auth,
  })

  check(listRes, {
    'list subscriptions status 200': (r) => r.status === 200,
    'list subscriptions returns array': (r) => {
      try {
        return Array.isArray(r.json() as unknown as Array<Record<string, unknown>>)
      } catch {
        return false
      }
    },
  }, { scenario: 'subscriptions', endpoint: 'subscriptions_list' })
}

export function teardown(ctx: RunContext) {
  endRun(ctx, 'subscriptions')
}
