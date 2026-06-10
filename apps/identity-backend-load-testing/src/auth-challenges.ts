import { check, group } from 'k6'
import http from 'k6/http'

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
    http_req_duration: ['p(95)<500', 'p(99)<1500'],
    http_req_failed: ['rate<0.05'],
  },
}

export default function() {
  group('auth_challenges', () => {
    const res = http.post(`${BASE_URL}/api/v1/auth/challenges`, null, {
      tags: { group: 'auth_challenges', endpoint: 'auth_challenges' },
    })

    check(res, {
      'auth challenge status 201': (r) => r.status === 201,
      'auth challenge has challenge field': (r) => {
        try {
          const data = r.json() as Record<string, unknown>
          return typeof data.challenge === 'string'
        } catch {
          return false
        }
      },
    })
  })
}
