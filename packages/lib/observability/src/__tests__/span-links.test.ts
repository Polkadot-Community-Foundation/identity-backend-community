import { describe, it } from '@effect/vitest'
import { Schema as S, type Tracer } from 'effect'
import { LINK_RELATIONSHIP_ATTRIBUTE, LinkRelationship } from '../semantic-conventions.js'
import { buildSpanLinks } from '../span-links.js'

const isExternalSpan = (span: Tracer.AnySpan): span is Tracer.ExternalSpan => span._tag === 'ExternalSpan'

const Row = S.Struct({
  traceId: S.NullOr(S.String),
  spanId: S.NullOr(S.String),
})

const eligibleRows = (rows: ReadonlyArray<S.Schema.Type<typeof Row>>) =>
  rows.filter((r): r is { traceId: string; spanId: string } => r.traceId !== null && r.spanId !== null)

describe('buildSpanLinks', () => {
  it.prop(
    '∀rows_Links_=NonNullIdCount',
    [S.Array(Row)],
    ([rows]) => buildSpanLinks(rows, () => ({})).length === eligibleRows(rows).length,
  )

  it.prop('∀rows_Links_≡EligibleRowsInOrder', [S.Array(Row)], ([rows]) => {
    const eligible = eligibleRows(rows)
    const links = buildSpanLinks(rows, (r) => ({ 'app.row': r.traceId }))
    return links.length === eligible.length &&
      links.every((link, index) =>
        isExternalSpan(link.span) &&
        link.span.traceId === eligible[index]!.traceId &&
        link.span.spanId === eligible[index]!.spanId &&
        link.span.sampled === true &&
        link.attributes[LINK_RELATIONSHIP_ATTRIBUTE] === LinkRelationship.CREATED_BY &&
        link.attributes['app.row'] === eligible[index]!.traceId
      )
  })
})
