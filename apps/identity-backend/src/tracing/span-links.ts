import { Tracer } from 'effect'

export const buildSpanLinks = <T extends { traceId: string | null; spanId: string | null }>(
  rows: readonly T[],
  getAttributes: (row: T & { traceId: string; spanId: string }) => Record<string, string>,
): readonly Tracer.SpanLink[] =>
  rows
    .filter((r): r is T & { traceId: string; spanId: string } => r.traceId !== null && r.spanId !== null)
    .map((r) => ({
      _tag: 'SpanLink' as const,
      span: Tracer.externalSpan({
        traceId: r.traceId,
        spanId: r.spanId,
        sampled: true,
      }),
      attributes: { 'link.relationship': 'created_by', ...getAttributes(r) },
    }))
