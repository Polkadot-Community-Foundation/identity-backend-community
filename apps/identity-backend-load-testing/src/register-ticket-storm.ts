import { SharedArray } from 'k6/data'
import exec from 'k6/execution'
import { runRegisterAndAwaitAssignment } from './lib/register-flow'
import { endRun, type RunContext, startRun } from './lib/run-lifecycle'
import { runTicketClaim } from './lib/ticket-flow'

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080'
const SLA_MS = parseInt(__ENV.SLA_MS || '100000', 10)
const POLL_INTERVAL = parseFloat(__ENV.POLL_INTERVAL || '2')
const REGISTER_VUS = parseInt(__ENV.VUS || '50', 10)
const TICKET_RPS = parseInt(__ENV.TICKET_RPS || '100', 10)
const TICKET_DURATION = __ENV.TICKET_DURATION || '5m'
const MAX_DURATION = __ENV.MAX_DURATION || '15m'
const DIM = __ENV.DIM === 'ProofOfInk' ? 'ProofOfInk' : 'Game'

const registerBodies = new SharedArray<Record<string, unknown>>('register-bodies', () => {
  const path = __ENV.REGISTER_PAYLOADS || 'apps/identity-backend-load-testing/register-payloads.jsonl'
  return open(path)
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => (JSON.parse(line) as { body: Record<string, unknown> }).body)
})

const jwtTokens = new SharedArray<{ who: string; token: string }>('jwt-tokens', () => {
  const path = __ENV.JWT_TOKENS || 'apps/identity-backend-load-testing/jwt-tokens.json'
  const parsed = JSON.parse(open(path)) as { tokens: { who: string; token: string }[] }
  return parsed.tokens
})

export const options = {
  scenarios: {
    register_flood: {
      executor: 'shared-iterations',
      exec: 'registerScenario',
      vus: REGISTER_VUS,
      iterations: registerBodies.length,
      maxDuration: MAX_DURATION,
    },
    invite_storm: {
      executor: 'constant-arrival-rate',
      exec: 'ticketScenario',
      rate: TICKET_RPS,
      timeUnit: '1s',
      duration: TICKET_DURATION,
      preAllocatedVUs: Math.max(20, Math.floor(TICKET_RPS / 2)),
      maxVUs: TICKET_RPS * 2,
    },
  },
  thresholds: {
    checks: ['rate>0.95'],
    correctness_failures: ['count<1'],
    time_to_assigned: [`p(95)<${SLA_MS}`],
    registration_sla_compliance: ['rate>0.95'],
    'http_req_failed{endpoint:usernames_register}': ['rate<0.20'],
  },
}

export function setup(): RunContext {
  return startRun(BASE_URL, false)
}

export function registerScenario(ctx: RunContext) {
  runRegisterAndAwaitAssignment({
    baseUrl: ctx.baseUrl,
    scenario: 'register',
    payload: registerBodies[exec.scenario.iterationInTest % registerBodies.length]!,
    slaMs: SLA_MS,
    pollIntervalSeconds: POLL_INTERVAL,
  })
}

export function ticketScenario(ctx: RunContext) {
  const token = jwtTokens[exec.scenario.iterationInTest % jwtTokens.length]!
  runTicketClaim({ baseUrl: ctx.baseUrl, scenario: 'invite', authToken: token.token, who: token.who, dim: DIM })
}

export function teardown(ctx: RunContext) {
  endRun(ctx, 'register-ticket-storm')
}
