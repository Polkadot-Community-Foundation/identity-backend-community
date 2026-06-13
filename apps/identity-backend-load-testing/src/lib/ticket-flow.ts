import { check } from 'k6'
import { Counter } from 'k6/metrics'
import { correctnessFailures, observedPost } from './observed-http'

export const ticketsClaimed = new Counter('tickets_claimed')
export const ticketsUnavailable = new Counter('tickets_unavailable')

const CLAIMED = 200
const RACE_LOST = 409
const POOL_EXHAUSTED = 422

export interface TicketClaimOptions {
  baseUrl: string
  scenario: string
  authToken: string
  who: string
  dim: 'Game' | 'ProofOfInk'
}

export function runTicketClaim(opts: TicketClaimOptions): void {
  const tags = { scenario: opts.scenario, endpoint: 'invitation_ticket_claim' }
  const res = observedPost(`${opts.baseUrl}/api/v1/invitation-ticket/claim`, {
    scenario: opts.scenario,
    endpoint: 'invitation_ticket_claim',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.authToken}` },
    body: JSON.stringify({ who: opts.who, dim: opts.dim }),
  })

  const handled = res.status === CLAIMED || res.status === RACE_LOST || res.status === POOL_EXHAUSTED
  if (!check(res, { 'claim handled (200/409/422)': () => handled }, tags)) {
    correctnessFailures.add(1, tags)
    return
  }

  if (res.status === CLAIMED) ticketsClaimed.add(1, tags)
  else ticketsUnavailable.add(1, tags)
}
