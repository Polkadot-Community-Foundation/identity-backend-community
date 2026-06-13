import { randomItem } from 'https://jslib.k6.io/k6-utils/1.2.0/index.js'
import { observedGet, pocSolveIterations } from './observed-http'
import { obtainProofHeader } from './proof-of-compute'
import { checkPaginationContinuity, checkSearchResponse, checkSearchStatusOnly } from './search-checks'

export interface SearchOptions {
  baseUrl: string
  scenario: string
  prefixes: readonly string[]
  limit: number
  usePoc: boolean
  paginate: boolean
  validateBody: boolean
}

function searchUrl(baseUrl: string, prefix: string, limit: number, cursor?: string): string {
  const params = [`prefix=${encodeURIComponent(prefix)}`, `limit=${limit}`]
  if (cursor) params.push(`cursor=${encodeURIComponent(cursor)}`)
  return `${baseUrl}/api/v1/usernames/search?${params.join('&')}`
}

export function runSearchIteration(opts: SearchOptions): void {
  const prefix = randomItem([...opts.prefixes])
  const proof = opts.usePoc
    ? obtainProofHeader(opts.baseUrl, opts.scenario)
    : { header: null, enabled: false, iterations: 0 }

  if (proof.enabled) {
    pocSolveIterations.add(proof.iterations, { scenario: opts.scenario, endpoint: 'poc_issue' })
  }

  const proofHeader = proof.header ? { 'Proof-Of-Compute': proof.header } : undefined

  const res = observedGet(searchUrl(opts.baseUrl, prefix, opts.limit), {
    scenario: opts.scenario,
    endpoint: 'usernames_search',
    headers: proofHeader,
  })

  if (!opts.validateBody) {
    checkSearchStatusOnly(res, opts.scenario)
    return
  }

  const page = checkSearchResponse(res, { scenario: opts.scenario, prefix, limit: opts.limit })

  if (!opts.paginate || page === null || page.nextCursor === null) return

  const nextProof = opts.usePoc
    ? obtainProofHeader(opts.baseUrl, opts.scenario)
    : { header: null, enabled: false, iterations: 0 }
  const nextProofHeader = nextProof.header ? { 'Proof-Of-Compute': nextProof.header } : undefined

  const nextRes = observedGet(searchUrl(opts.baseUrl, prefix, opts.limit, page.nextCursor), {
    scenario: opts.scenario,
    endpoint: 'usernames_search',
    headers: nextProofHeader,
  })

  const nextPage = checkSearchResponse(nextRes, { scenario: opts.scenario, prefix, limit: opts.limit })
  if (nextPage !== null) {
    checkPaginationContinuity(page, nextPage, opts.scenario)
  }
}
