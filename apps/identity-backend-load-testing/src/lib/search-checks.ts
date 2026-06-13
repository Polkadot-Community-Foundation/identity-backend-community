import { check } from 'k6'
import type { RefinedResponse } from 'k6/http'
import { correctnessFailures, errorEnvelopeResponses, unknownStatusValues } from './observed-http'

export interface SearchUsername {
  accountId: string
  username: string
  status: string
  createdAt: string
  updatedAt: string | null
}

export interface SearchPage {
  usernames: SearchUsername[]
  nextCursor: string | null
}

export const KNOWN_STATUSES: readonly string[] = ['RESERVED', 'ASSIGNED', 'FAILED']

export function parseBody(res: RefinedResponse): unknown {
  try {
    return res.json()
  } catch {
    return null
  }
}

export function looksLikeErrorEnvelope(body: unknown): boolean {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return false
  const record = body as Record<string, unknown>
  return 'error' in record || 'errors' in record
}

export function toSearchPage(body: unknown): SearchPage | null {
  if (typeof body !== 'object' || body === null) return null
  const page = body as Partial<SearchPage>
  if (!Array.isArray(page.usernames)) return null
  if (page.nextCursor !== null && typeof page.nextCursor !== 'string') return null
  return { usernames: page.usernames, nextCursor: page.nextCursor ?? null }
}

export function everyUsernameMatchesPrefix(page: SearchPage, prefix: string): boolean {
  const needle = prefix.toLowerCase()
  return page.usernames.every((u) => typeof u.username === 'string' && u.username.toLowerCase().startsWith(needle))
}

export function everyResultWellShaped(page: SearchPage): boolean {
  return page.usernames.every((u) =>
    typeof u.accountId === 'string' &&
    typeof u.username === 'string' &&
    typeof u.status === 'string' &&
    u.status.length > 0
  )
}

export function unknownStatusCount(page: SearchPage): number {
  return page.usernames.filter((u) => !KNOWN_STATUSES.includes(u.status)).length
}

export function pageWithinLimit(page: SearchPage, limit: number): boolean {
  return page.usernames.length <= limit
}

export function pagesDoNotOverlap(firstPage: SearchPage, secondPage: SearchPage): boolean {
  const firstNames = new Set(firstPage.usernames.map((u) => u.username))
  return secondPage.usernames.every((u) => !firstNames.has(u.username))
}

export interface SearchCheckInput {
  scenario: string
  prefix: string
  limit: number
}

export function checkSearchStatusOnly(res: RefinedResponse, scenario: string): void {
  const tags = { scenario, endpoint: 'usernames_search' }
  check(res, { 'search status 200': (r) => r.status === 200 }, tags)
}

export function checkSearchResponse(res: RefinedResponse, input: SearchCheckInput): SearchPage | null {
  const body = parseBody(res)
  const page = toSearchPage(body)
  const tags = { scenario: input.scenario, endpoint: 'usernames_search' }

  if (res.status === 200 && (page === null || looksLikeErrorEnvelope(body))) {
    errorEnvelopeResponses.add(1, tags)
  }
  if (page !== null) {
    unknownStatusValues.add(unknownStatusCount(page), tags)
  }

  const passed = check(res, {
    'search status 200': (r) => r.status === 200,
    'search body is a page': () => page !== null,
    'every result matches prefix': () => page !== null && everyUsernameMatchesPrefix(page, input.prefix),
    'limit honored': () => page !== null && pageWithinLimit(page, input.limit),
    'every result well-shaped': () => page !== null && everyResultWellShaped(page),
  }, tags)

  if (!passed) {
    correctnessFailures.add(1, tags)
  }

  return page
}

export function checkPaginationContinuity(
  firstPage: SearchPage,
  secondPage: SearchPage,
  scenario: string,
): void {
  const tags = { scenario, endpoint: 'usernames_search' }

  const passed = check(null, {
    'second page has results': () => secondPage.usernames.length > 0,
    'pages do not overlap': () => pagesDoNotOverlap(firstPage, secondPage),
  }, tags)

  if (!passed) {
    correctnessFailures.add(1, tags)
  }
}
