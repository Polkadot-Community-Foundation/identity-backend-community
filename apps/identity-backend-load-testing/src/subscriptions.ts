import { check, group } from 'k6'
import http from 'k6/http'
import { generateJwtPool } from './lib/jwt'

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
    http_req_duration: ['p(95)<500', 'p(99)<1500'],
    http_req_failed: ['rate<0.01'],
  },
}

export default function() {
  const jwt = JWT_POOL[Math.floor(Math.random() * JWT_POOL.length)]!

  group('create_subscription', () => {
    const payload = JSON.stringify({
      notificationType: 'fcm',
      token: `test-token-${Math.random().toString(36).substring(2, 10)}`,
    })

    const res = http.post(`${BASE_URL}/api/v1/subscriptions`, payload, {
      headers: {
        Authorization: `Bearer ${jwt.token}`,
        'Content-Type': 'application/json',
      },
      tags: { group: 'create_subscription', endpoint: 'subscriptions_create' },
    })

    check(res, {
      'create subscription 201 (created) or 200 (updated)': (r) => r.status === 201 || r.status === 200,
    })
  })

  group('list_subscriptions', () => {
    const res = http.get(`${BASE_URL}/api/v1/subscriptions`, {
      headers: {
        Authorization: `Bearer ${jwt.token}`,
      },
      tags: { group: 'list_subscriptions', endpoint: 'subscriptions_list' },
    })

    check(res, {
      'list subscriptions status 200': (r) => r.status === 200,
      'list subscriptions returns array': (r) => {
        try {
          const data = r.json() as unknown as Array<Record<string, unknown>>
          return Array.isArray(data)
        } catch {
          return false
        }
      },
    })
  })
}
