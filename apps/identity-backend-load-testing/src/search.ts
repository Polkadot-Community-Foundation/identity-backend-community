import { randomItem } from 'https://jslib.k6.io/k6-utils/1.2.0/index.js'
import { check, group, sleep } from 'k6'
import http from 'k6/http'
import { FULL_PREFIXES, MEDIUM_PREFIXES, SHORT_PREFIXES } from './lib/usernames'

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080'
const SMOKE_MODE = __ENV.SMOKE === '1'

export const options = {
  scenarios: SMOKE_MODE
    ? {
      smoke_all: { executor: 'constant-vus', vus: 5, duration: '30s', gracefulStop: '5s' },
    }
    : {
      short_prefix: {
        executor: 'ramping-arrival-rate',
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
        env: { BUCKET: 'short' },
      },
      medium_prefix: {
        executor: 'ramping-arrival-rate',
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
        env: { BUCKET: 'medium' },
      },
      full_prefix: {
        executor: 'ramping-arrival-rate',
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
        env: { BUCKET: 'full' },
      },
    },
  thresholds: {
    'http_req_duration{endpoint:usernames_search}': ['p(95)<300', 'p(99)<1000'],
    'http_req_failed{endpoint:usernames_search}': ['rate<0.01'],
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
    default:
      return [...SHORT_PREFIXES, ...MEDIUM_PREFIXES, ...FULL_PREFIXES]
  }
}

export default function() {
  const bucket = __ENV.BUCKET
  const pool = poolForBucket(bucket)
  const groupName = `search_${bucket || 'mixed'}`

  group(groupName, () => {
    const prefix = randomItem([...pool])
    const url = `${BASE_URL}/api/v1/usernames/search?prefix=${encodeURIComponent(prefix)}&limit=20`

    const res = http.get(url, {
      tags: { group: groupName, endpoint: 'usernames_search', bucket: bucket || 'mixed' },
    })

    check(res, {
      'search status 200': (r) => r.status === 200,
      'search has usernames array': (r) => {
        try {
          const data = r.json() as { usernames?: unknown[] }
          return Array.isArray(data.usernames)
        } catch {
          return false
        }
      },
      'search returned non-empty results': (r) => {
        try {
          const data = r.json() as { usernames?: unknown[] }
          return Array.isArray(data.usernames) && data.usernames.length > 0
        } catch {
          return false
        }
      },
    })
  })

  sleep(1)
}
