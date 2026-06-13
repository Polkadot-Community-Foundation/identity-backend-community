import { OpenAPIHono } from '@hono/zod-openapi'
import { z } from '@hono/zod-openapi'
import type { Env } from 'hono'
import type { ZodIssue } from 'zod'

// RFC 9457 Problem Details — https://www.rfc-editor.org/rfc/rfc9457
// SmartBear registry — https://problems-registry.smartbear.com/

export const SMARTBEAR = 'https://problems-registry.smartbear.com' as const

export type ProblemStatus = 400 | 401 | 402 | 403 | 404 | 409 | 422 | 429 | 500 | 503

export const PROBLEM_TYPES = [
  'about:blank',
  'forbidden',
  'unauthorized',
  'payment-required',
  'too-many-requests',
  'bad-request',
  'not-found',
  'already-exists',
  'business-rule-violation',
  'validation-error',
  'service-unavailable',
  'server-error',
  'invalid-body-property-format',
  'invalid-body-property-value',
  'invalid-request-header-format',
  'invalid-request-parameter-format',
  'invalid-request-parameter-value',
  'missing-body-property',
  'missing-request-header',
  'missing-request-parameter',
  'license-expired',
  'license-cancelled',
] as const

export type ProblemType = (typeof PROBLEM_TYPES)[number]

export type ProblemTypeUrl =
  | 'about:blank'
  | `${typeof SMARTBEAR}/${Exclude<ProblemType, 'about:blank'>}`

export const problemTypeUrl = (slug: ProblemType): ProblemTypeUrl =>
  slug === 'about:blank' ? 'about:blank' : `${SMARTBEAR}/${slug}`

export interface ProblemDetail {
  readonly type: ProblemTypeUrl
  readonly title: string
  readonly detail: string
  readonly status: ProblemStatus
}

export const buildProblemDetail = <S extends ProblemStatus>(input: {
  readonly slug: ProblemType
  readonly title: string
  readonly detail: string
  readonly status: S
}): ProblemDetail & { readonly status: S } => ({
  type: problemTypeUrl(input.slug),
  title: input.title,
  detail: input.detail,
  status: input.status,
})

export interface ProblemDetailWithErrors extends ProblemDetail {
  readonly errors: ReadonlyArray<{ readonly detail: string; readonly pointer: string }>
}

export const ProblemDetailZod = z.object({
  type: z.string().url(),
  title: z.string(),
  detail: z.string(),
  status: z.number().int(),
}).openapi({ title: 'ProblemDetail' })

export const ProblemDetailWithErrorsZod = ProblemDetailZod.extend({
  errors: z.array(z.object({
    detail: z.string(),
    pointer: z.string(),
  })),
}).openapi({ title: 'ProblemDetailWithErrors' })

export const problemResponse = (
  schema: typeof ProblemDetailZod | typeof ProblemDetailWithErrorsZod = ProblemDetailZod,
) => ({ content: { 'application/problem+json': { schema } } }) as const

const TYPE_URLS = {
  body: `${SMARTBEAR}/invalid-body-property-value`,
  json: `${SMARTBEAR}/invalid-body-property-value`,
  query: `${SMARTBEAR}/invalid-request-parameter-value`,
  param: `${SMARTBEAR}/invalid-request-parameter-value`,
  cookie: `${SMARTBEAR}/bad-request`,
  header: `${SMARTBEAR}/invalid-request-header-format`,
} as const

const TITLES = {
  body: 'Invalid Body Property Value',
  json: 'Invalid Body Property Value',
  query: 'Invalid Query Parameter Value',
  param: 'Invalid Parameter Value',
  cookie: 'Invalid Cookie Value',
  header: 'Invalid Header Value',
} as const

const DETAIL_MESSAGES = {
  body: 'The request body contains an invalid body property value.',
  json: 'The request body contains an invalid body property value.',
  query: 'The request query contains an invalid parameter value.',
  param: 'The request path contains an invalid parameter value.',
  cookie: 'The request cookies contain an invalid value.',
  header: 'The request headers contain an invalid value.',
} as const

function toJsonPointer(path: ReadonlyArray<PropertyKey>, target: string): string {
  const shouldStrip = path.length > 0 && (
    (target === 'body' && path[0] === 'body') ||
    (target === 'json' && path[0] === 'json')
  )
  const segments = shouldStrip ? path.slice(1) : [...path]

  const pointer = segments
    .map(segment => `/${String(segment)}`)
    .join('')

  return pointer.startsWith('/') ? `#${pointer}` : `#/${pointer}`
}

export function zodIssuesToProblemDetail(
  issues: ReadonlyArray<ZodIssue>,
  target: string,
): ProblemDetailWithErrors {
  const typeUrl = TYPE_URLS[target as keyof typeof TYPE_URLS]
  const title = TITLES[target as keyof typeof TITLES]
  const detail = DETAIL_MESSAGES[target as keyof typeof DETAIL_MESSAGES]

  const errors = issues.map(issue => {
    const pointer = toJsonPointer(issue.path, target)
    const issueDetail = issue.message || 'Invalid value'
    return { detail: issueDetail, pointer } as const
  })

  return {
    type: typeUrl,
    title,
    detail,
    status: 400,
    errors,
  }
}

export function createOpenAPIHono<E extends Env = Env>(): OpenAPIHono<E> {
  return new OpenAPIHono<E>({
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json(
          zodIssuesToProblemDetail(result.error.issues, result.target),
          400,
          { 'Content-Type': 'application/problem+json' },
        )
      }
    },
  })
}
