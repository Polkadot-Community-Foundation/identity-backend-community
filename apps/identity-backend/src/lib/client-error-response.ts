import { Effect } from 'effect'
import type { Context } from 'hono'
import type { ProblemDetail, ProblemStatus } from './problem-details.js'

interface ClientErrorInput<E extends { readonly _tag: string }, S extends ProblemStatus> {
  readonly context: Context
  readonly problem: ProblemDetail & { readonly status: S }
  readonly error: E
  readonly diagnostic?: Readonly<Record<string, unknown>>
}

export const respondWithClientError = <
  E extends { readonly _tag: string },
  S extends ProblemStatus,
>(input: ClientErrorInput<E, S>) => {
  const { context: c, problem, error, diagnostic = {} } = input
  return Effect.gen(function*() {
    yield* Effect.logDebug('client_error_response', {
      'error.tag': error._tag,
      'http.response.status_code': problem.status,
      'app.problem.type': problem.type,
      ...diagnostic,
    })
    return c.json(problem, problem.status, { 'Content-Type': 'application/problem+json' })
  })
}
