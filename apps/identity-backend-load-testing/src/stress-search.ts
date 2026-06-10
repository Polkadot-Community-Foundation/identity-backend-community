import { randomItem } from 'https://jslib.k6.io/k6-utils/1.2.0/index.js'
import { check, group } from 'k6'
import http from 'k6/http'
import { FULL_PREFIXES, MEDIUM_PREFIXES, SHORT_PREFIXES } from './lib/usernames'

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080'
const PEAK_RPS = parseInt(__ENV.PEAK_RPS || '2000', 10)
const SOAK_DURATION = __ENV.SOAK_DURATION || '2m'

const ALL_PREFIXES = [...SHORT_PREFIXES, ...MEDIUM_PREFIXES, ...FULL_PREFIXES]

// Open-model stress profile: arrival rate ramps to PEAK_RPS regardless of
// system response. The intent is to find the inflection where p95 / error
// rate climbs — thresholds are deliberately loose so the run completes and
// you can read the curve, not just the pass/fail bit.
//
// VU sizing — by Little's Law, sustaining PEAK_RPS with maxVUs only works
// while average response time stays ≤ maxVUs / PEAK_RPS seconds. With the
// defaults (2000 / 3000 = 1.5s) k6 will emit "Insufficient VUs" warnings
// once the backend gets slower than that. That warning IS the signal, not
// a misconfiguration. Bump maxVUs to push the cap; reduce PEAK_RPS for a
// gentler test.
export const options = {
  scenarios: {
    ramp_to_failure: {
      executor: 'ramping-arrival-rate',
      startRate: 10,
      timeUnit: '1s',
      preAllocatedVUs: 200,
      maxVUs: 3000,
      stages: [
        { duration: '30s', target: Math.floor(PEAK_RPS / 4) },
        { duration: '30s', target: Math.floor(PEAK_RPS / 2) },
        { duration: '30s', target: PEAK_RPS },
        { duration: SOAK_DURATION, target: PEAK_RPS },
        { duration: '30s', target: 0 },
      ],
      gracefulStop: '15s',
    },
  },
  thresholds: {
    'http_req_duration{endpoint:usernames_search}': ['p(95)<2000', 'p(99)<5000'],
    'http_req_failed{endpoint:usernames_search}': ['rate<0.10'],
  },
}

export default function() {
  group('stress_search', () => {
    const prefix = randomItem(ALL_PREFIXES)
    const url = `${BASE_URL}/api/v1/usernames/search?prefix=${encodeURIComponent(prefix)}&limit=20`

    const res = http.get(url, {
      tags: { group: 'stress_search', endpoint: 'usernames_search' },
    })

    check(res, {
      'stress status 200': (r) => r.status === 200,
    })
  })
}
