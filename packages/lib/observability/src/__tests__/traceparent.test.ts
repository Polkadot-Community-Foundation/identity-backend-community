import { describe, expect, it } from '@effect/vitest'
import { Schema as S } from 'effect'
import { TraceContext } from '../trace-context.schema.js'
import { parseTraceparent, Traceparent } from '../traceparent.js'

const encode = S.encodeSync(Traceparent)

const CANONICAL = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'

describe('Traceparent', () => {
  it.prop('∀ctx_Roundtrip_≡Identity', [TraceContext], ([context]) => {
    const parsed = parseTraceparent(encode(context))
    return parsed !== null &&
      parsed.traceId === context.traceId &&
      parsed.spanId === context.parentId &&
      parsed.traceFlags === context.traceFlags &&
      parsed.isRemote === true
  })

  it.prop('∀ctx_EncodedHeader_=55LowercaseChars', [TraceContext], ([context]) => {
    const header = encode(context)
    return header.length === 55 && header === header.toLowerCase() && header.startsWith('00-')
  })

  it.prop('∀ctx_UppercasedHeader_=Null', [TraceContext], ([context]) => {
    const header = encode(context)
    return header === header.toUpperCase() || parseTraceparent(header.toUpperCase()) === null
  })

  it.prop(
    '∀ctx_Version00WithTrailingData_=Null',
    [TraceContext],
    ([context]) => parseTraceparent(`${encode(context)}-extra`) === null,
  )

  it('Should_ParseCanonicalExample_When_GivenSpecSample', () => {
    expect(parseTraceparent(CANONICAL)).toEqual({
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      spanId: '00f067aa0ba902b7',
      traceFlags: 1,
      isRemote: true,
    })
  })

  it('Should_RejectAsNull_When_TraceIdIsAllZeroes', () => {
    expect(parseTraceparent('00-00000000000000000000000000000000-00f067aa0ba902b7-01')).toBeNull()
  })

  it('Should_RejectAsNull_When_ParentIdIsAllZeroes', () => {
    expect(parseTraceparent('00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01')).toBeNull()
  })

  it('Should_RejectAsNull_When_VersionIsForbiddenFf', () => {
    expect(parseTraceparent('ff-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01')).toBeNull()
  })

  it('Should_ParseTraceIdAndParentId_When_HigherVersionCarriesTrailingFields', () => {
    expect(parseTraceparent('01-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01-cb_eh:9')).toEqual({
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      spanId: '00f067aa0ba902b7',
      traceFlags: 1,
      isRemote: true,
    })
  })

  it('Should_RejectAsNull_When_HeaderShorterThanFiftyFiveChars', () => {
    expect(parseTraceparent('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-0')).toBeNull()
  })

  it('Should_RejectAsNull_When_VersionIsNotHex', () => {
    expect(parseTraceparent('0z-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01')).toBeNull()
  })

  it('Should_RejectAsNull_When_VersionNotFollowedByDash', () => {
    expect(parseTraceparent('00x4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01')).toBeNull()
  })

  it('Should_RejectAsNull_When_TraceIdNotFollowedByDash', () => {
    expect(parseTraceparent('00-4bf92f3577b34da6a3ce929d0e0e4736x00f067aa0ba902b7-01')).toBeNull()
  })

  it('Should_RejectAsNull_When_ParentIdNotFollowedByDash', () => {
    expect(parseTraceparent('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7x01')).toBeNull()
  })

  it('Should_RejectAsNull_When_HigherVersionFlagsNotTerminatedByDash', () => {
    expect(parseTraceparent('01-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01x9')).toBeNull()
  })
})
