import { randomItem } from 'https://jslib.k6.io/k6-utils/1.2.0/index.js'
import { check, group } from 'k6'
import http from 'k6/http'
import { FULL_PREFIXES } from './lib/usernames'

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080'

export const options = {
  scenarios: {
    smoke: {
      executor: 'constant-vus',
      vus: 5,
      duration: '30s',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1500'],
    http_req_failed: ['rate<0.01'],
  },
}

export default function() {
  group('smoke_search_prefixed', () => {
    const prefix = randomItem([...FULL_PREFIXES])
    const url = `${BASE_URL}/api/v1/usernames/search?prefix=${encodeURIComponent(prefix)}&limit=20`

    const res = http.get(url, {
      tags: { group: 'smoke_search_prefixed', endpoint: 'usernames_search' },
    })

    check(res, {
      'smoke status 200': (r) => r.status === 200,
      'smoke has results': (r) => {
        try {
          const data = r.json() as { usernames?: unknown[] }
          return Array.isArray(data.usernames) && data.usernames.length > 0
        } catch {
          return false
        }
      },
    })
  })
}
