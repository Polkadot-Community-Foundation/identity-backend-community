import { Tracer } from 'effect'
import { LINK_RELATIONSHIP_ATTRIBUTE, LinkRelationship } from './semantic-conventions.js'

export const spanLink = (
  span: Tracer.AnySpan,
  attributes: Record<string, string> = {},
): Tracer.SpanLink => ({
  _tag: 'SpanLink',
  span,
  attributes,
})

export const buildSpanLinks = <T extends { traceId: string | null; spanId: string | null }>(
  rows: readonly T[],
  getAttributes: (row: T & { traceId: string; spanId: string }) => Record<string, string>,
): readonly Tracer.SpanLink[] =>
  rows
    .filter((r): r is T & { traceId: string; spanId: string } => r.traceId !== null && r.spanId !== null)
    .map((r) =>
      spanLink(
        Tracer.externalSpan({ traceId: r.traceId, spanId: r.spanId, sampled: true }),
        { [LINK_RELATIONSHIP_ATTRIBUTE]: LinkRelationship.CREATED_BY, ...getAttributes(r) },
      )
    )
