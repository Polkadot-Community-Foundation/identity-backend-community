import { check, sleep } from 'k6'
import { Counter, Rate, Trend } from 'k6/metrics'
import { correctnessFailures, observedGet, observedPost } from './observed-http'

export const timeToAssigned = new Trend('time_to_assigned', true)
export const slaCompliance = new Rate('registration_sla_compliance')
export const registrationsAccepted = new Counter('registrations_accepted')
export const registrationsRejected = new Counter('registrations_rejected')

const ACCEPTED = 202
const USERNAME_TAKEN = 409
const NO_DIGITS = 422

export interface RegisterFlowOptions {
  baseUrl: string
  scenario: string
  payload: Record<string, unknown>
  slaMs: number
  pollIntervalSeconds: number
}

function registeredUsername(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null
  const username = (body as { username?: unknown }).username
  return typeof username === 'string' && username.length > 0 ? username : null
}

function statusOf(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const status = (body as { status?: unknown }).status
  return typeof status === 'string' ? status : undefined
}

function awaitAssignment(opts: RegisterFlowOptions, fullUsername: string): { assigned: boolean; elapsedMs: number } {
  const url = `${opts.baseUrl}/api/v1/usernames/${encodeURIComponent(fullUsername)}`
  const start = Date.now()
  let assigned = false
  while (Date.now() - start < opts.slaMs) {
    const res = observedGet(url, { scenario: opts.scenario, endpoint: 'usernames_get' })
    if (res.status === 200 && statusOf(res.json()) === 'ASSIGNED') {
      assigned = true
      break
    }
    sleep(opts.pollIntervalSeconds)
  }
  return { assigned, elapsedMs: Math.min(Date.now() - start, opts.slaMs) }
}

export function runRegisterAndAwaitAssignment(opts: RegisterFlowOptions): void {
  const tags = { scenario: opts.scenario, endpoint: 'usernames_register' }
  const res = observedPost(`${opts.baseUrl}/api/v1/usernames`, {
    scenario: opts.scenario,
    endpoint: 'usernames_register',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts.payload),
  })

  const handled = res.status === ACCEPTED || res.status === USERNAME_TAKEN || res.status === NO_DIGITS
  if (!check(res, { 'register handled (202/409/422)': () => handled }, tags)) {
    correctnessFailures.add(1, tags)
    return
  }

  if (res.status !== ACCEPTED) {
    registrationsRejected.add(1, tags)
    return
  }

  registrationsAccepted.add(1, tags)
  const fullUsername = registeredUsername(res.json())
  if (!check(res, { 'register returns full username': () => fullUsername !== null }, tags)) {
    correctnessFailures.add(1, tags)
    return
  }

  const { assigned, elapsedMs } = awaitAssignment(opts, fullUsername!)
  timeToAssigned.add(elapsedMs, tags)
  slaCompliance.add(assigned, tags)
  check(null, { 'assigned within SLA': () => assigned }, tags)
}
