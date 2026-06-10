import { randomItem } from 'https://jslib.k6.io/k6-utils/1.2.0/index.js'
import { check, group, sleep } from 'k6'
import http from 'k6/http'
import { FULL_PREFIXES, MEDIUM_PREFIXES, SHORT_PREFIXES } from './lib/usernames'

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080'
const TARGET_VUS = parseInt(__ENV.VUS || '2000', 10)
const SOAK_DURATION = __ENV.SOAK_DURATION || '2m'
const THINK_TIME = parseFloat(__ENV.THINK_TIME || '1')

const ALL_PREFIXES = [...SHORT_PREFIXES, ...MEDIUM_PREFIXES, ...FULL_PREFIXES]

export const options = {
  scenarios: {
    concurrent_users: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: Math.floor(TARGET_VUS / 4) },
        { duration: '30s', target: Math.floor(TARGET_VUS / 2) },
        { duration: '30s', target: TARGET_VUS },
        { duration: SOAK_DURATION, target: TARGET_VUS },
        { duration: '30s', target: 0 },
      ],
      gracefulRampDown: '15s',
      gracefulStop: '15s',
    },
  },
  thresholds: {
    'http_req_duration{endpoint:usernames_search}': ['p(95)<2000', 'p(99)<5000'],
    'http_req_failed{endpoint:usernames_search}': ['rate<0.10'],
  },
}

export default function() {
  group('concurrent_search', () => {
    const prefix = randomItem(ALL_PREFIXES)
    const url = `${BASE_URL}/api/v1/usernames/search?prefix=${encodeURIComponent(prefix)}&limit=20`

    const res = http.get(url, {
      tags: { group: 'concurrent_search', endpoint: 'usernames_search' },
    })

    check(res, {
      'status 200': (r) => r.status === 200,
    })
  })

  sleep(THINK_TIME)
}
