import { SharedArray } from 'k6/data'
import exec from 'k6/execution'
import { runRegisterAndAwaitAssignment } from './lib/register-flow'
import { endRun, type RunContext, startRun } from './lib/run-lifecycle'

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080'
const SLA_MS = parseInt(__ENV.SLA_MS || '100000', 10)
const POLL_INTERVAL = parseFloat(__ENV.POLL_INTERVAL || '2')
const VUS = parseInt(__ENV.VUS || '50', 10)
const MAX_DURATION = __ENV.MAX_DURATION || '15m'

const payloads = new SharedArray<Record<string, unknown>>('register-payloads', () => {
  const path = __ENV.REGISTER_PAYLOADS || 'apps/identity-backend-load-testing/register-payloads.jsonl'
  return open(path)
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => (JSON.parse(line) as { body: Record<string, unknown> }).body)
})

export const options = {
  scenarios: {
    register_flood: {
      executor: 'shared-iterations',
      vus: VUS,
      iterations: payloads.length,
      maxDuration: MAX_DURATION,
    },
  },
  thresholds: {
    checks: ['rate>0.95'],
    correctness_failures: ['count<1'],
    'http_req_failed{endpoint:usernames_register}': ['rate<0.20'],
    time_to_assigned: [`p(95)<${SLA_MS}`],
    registration_sla_compliance: ['rate>0.95'],
  },
}

export function setup(): RunContext {
  return startRun(BASE_URL, false)
}

export default function(ctx: RunContext) {
  const payload = payloads[exec.scenario.iterationInTest % payloads.length]!
  runRegisterAndAwaitAssignment({
    baseUrl: ctx.baseUrl,
    scenario: 'register',
    payload,
    slaMs: SLA_MS,
    pollIntervalSeconds: POLL_INTERVAL,
  })
}

export function teardown(ctx: RunContext) {
  endRun(ctx, 'register')
}
