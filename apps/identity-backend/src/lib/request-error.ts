import { isProbePath } from '#root/lib/kube.js'
import { Schema as S } from 'effect'
import { HTTPException } from 'hono/http-exception'

class DropEvent extends S.TaggedClass<DropEvent>()('DropEvent', {}) {}

class RateLimitEvent extends S.TaggedClass<RateLimitEvent>()('RateLimitEvent', {
  fingerprint: S.Array(S.String),
}) {}

class ReportEvent extends S.TaggedClass<ReportEvent>()('ReportEvent', {}) {}

type ErrorReportDecision = DropEvent | RateLimitEvent | ReportEvent

export const decideErrorReport = (error: unknown, pathname: string): ErrorReportDecision => {
  if (pathname && isProbePath(pathname)) {
    return new DropEvent()
  }

  if (error instanceof HTTPException && error.status === 504) {
    return new RateLimitEvent({
      fingerprint: ['timeout-504', pathname],
    })
  }

  if (error instanceof HTTPException && error.status < 500) {
    return new DropEvent()
  }

  return new ReportEvent()
}

export { DropEvent, RateLimitEvent, ReportEvent }
export type { ErrorReportDecision }
