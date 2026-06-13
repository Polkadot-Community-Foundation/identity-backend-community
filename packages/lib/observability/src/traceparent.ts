import { StrictHex } from '@identity-backend/schema-extensions'
import type { SpanContext } from '@opentelemetry/api'
import { Array, Either, Option, ParseResult, Schema as S } from 'effect'
import { SpanId, TraceContext, TraceFlags, TraceId } from './trace-context.schema.js'

const TraceFlagsFromHex = S.transformOrFail(StrictHex.pipe(S.length(2)), TraceFlags, {
  decode: (hex) => ParseResult.succeed(parseInt(hex, 16)),
  encode: (flags) => ParseResult.succeed(flags.toString(16).padStart(2, '0')),
})

const VERSION_END = 2
const TRACE_ID_START = 3
const TRACE_ID_END = 35
const PARENT_ID_START = 36
const PARENT_ID_END = 52
const FLAGS_START = 53
const FLAGS_END = 55
const MIN_LENGTH = 55

const VERSION_PATTERN = /^[0-9a-f]{2}$/
const FORBIDDEN_VERSION = 'ff' as const

export const Traceparent = S.transformOrFail(S.String, TraceContext, {
  decode: (header, options, ast) => {
    const fail = (message: string) => ParseResult.fail(new ParseResult.Type(ast, header, message))

    const version = header.slice(0, VERSION_END)
    if (!VERSION_PATTERN.test(version) || header[VERSION_END] !== '-') return fail('invalid version prefix')
    if (version === FORBIDDEN_VERSION) return fail('version ff is forbidden')
    if (version === '00' && header.length !== MIN_LENGTH) {
      return fail('version 00 traceparent must be exactly 55 characters')
    }
    if (header[TRACE_ID_END] !== '-' || header[PARENT_ID_END] !== '-') return fail('malformed field delimiters')
    if (header.length > FLAGS_END && header[FLAGS_END] !== '-') {
      return fail('trace-flags not terminated by dash or end of string')
    }

    const traceIdResult = ParseResult.decodeUnknownEither(TraceId)(header.slice(TRACE_ID_START, TRACE_ID_END), options)
    const parentIdResult = ParseResult.decodeUnknownEither(SpanId)(
      header.slice(PARENT_ID_START, PARENT_ID_END),
      options,
    )
    const flagsResult = ParseResult.decodeUnknownEither(TraceFlagsFromHex)(
      header.slice(FLAGS_START, FLAGS_END),
      options,
    )

    const errors = Array.getSomes([
      Either.getLeft(traceIdResult).pipe(Option.map((e) => new ParseResult.Pointer('traceId', header, e))),
      Either.getLeft(parentIdResult).pipe(Option.map((e) => new ParseResult.Pointer('parentId', header, e))),
      Either.getLeft(flagsResult).pipe(Option.map((e) => new ParseResult.Pointer('traceFlags', header, e))),
    ])

    if (Array.isNonEmptyArray(errors)) return ParseResult.fail(new ParseResult.Composite(ast, header, errors))

    return ParseResult.succeed({
      traceId: Either.getOrThrow(traceIdResult),
      parentId: Either.getOrThrow(parentIdResult),
      traceFlags: Either.getOrThrow(flagsResult),
    })
  },
  encode: ({ parentId, traceFlags, traceId }) =>
    ParseResult.succeed(`00-${traceId}-${parentId}-${traceFlags.toString(16).padStart(2, '0')}`),
})
export type Traceparent = S.Schema.Type<typeof Traceparent>

const decodeTraceparent = S.decodeOption(Traceparent)

export const parseTraceparent = (header: string): SpanContext | null =>
  Option.match(decodeTraceparent(header), {
    onNone: () => null,
    onSome: (context) => ({
      traceId: context.traceId,
      spanId: context.parentId,
      traceFlags: context.traceFlags,
      isRemote: true,
    }),
  })
