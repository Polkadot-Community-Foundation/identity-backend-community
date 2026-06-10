import { check, group } from 'k6'
import http from 'k6/http'

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
    http_req_duration: ['p(95)<50', 'p(99)<200'],
    http_req_failed: ['rate<0.001'],
  },
}

export default function() {
  group('healthcheck', () => {
    const res = http.get(`${BASE_URL}/healthcheck`, {
      tags: { group: 'healthcheck', endpoint: 'health' },
    })

    check(res, {
      'healthcheck status 200': (r) => r.status === 200,
      'healthcheck body contains ok': (r) => {
        try {
          const body = typeof r.body === 'string' ? r.body : JSON.stringify(r.body)
          return body.includes('ok') || body.includes('OK')
        } catch {
          return false
        }
      },
    })
  })
}
