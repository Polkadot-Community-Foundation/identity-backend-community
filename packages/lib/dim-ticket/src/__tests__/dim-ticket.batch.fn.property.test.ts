import { describe, it } from '@effect/vitest'
import { FastCheck as fc } from 'effect'
import { computeRetryDelay } from '../dim-ticket.batch.fn.js'

describe('computeRetryDelay', () => {
  const positiveInt = fc.integer({ min: 1, max: 100_000 })
  const attempt = fc.integer({ min: 0, max: 20 })

  it.prop(
    '∀a_Backoff_≤MaxMs',
    [positiveInt, positiveInt, positiveInt, attempt],
    ([baseMs, rawMaxMs, maxExponent, a]) => {
      const maxMs = baseMs + rawMaxMs
      return computeRetryDelay(baseMs, maxMs, maxExponent)(a) <= maxMs
    },
  )

  it.prop(
    '≤ab_Backoff_≤fg',
    [positiveInt, positiveInt, fc.integer({ min: 1, max: 20 }), fc.integer({ min: 0, max: 19 })],
    ([baseMs, rawMaxMs, maxExponent, a]) => {
      const maxMs = baseMs + rawMaxMs
      return computeRetryDelay(baseMs, maxMs, maxExponent)(a + 1) >= computeRetryDelay(baseMs, maxMs, maxExponent)(a)
    },
  )

  it.prop(
    '∀c_BackoffAtZero_=BaseMs',
    [positiveInt, positiveInt, positiveInt],
    ([baseMs, rawMaxMs, maxExponent]) => {
      const maxMs = baseMs + rawMaxMs
      return computeRetryDelay(baseMs, maxMs, maxExponent)(0) === baseMs
    },
  )

  it.prop(
    '∀c_BackoffCapped_=MaxMs',
    [positiveInt, fc.integer({ min: 1, max: 10 }), attempt],
    ([baseMs, maxExponent, extra]) => computeRetryDelay(baseMs, baseMs, maxExponent)(maxExponent + extra) === baseMs,
  )

  it.prop(
    '∀c_BackoffScale_≡Exp',
    [positiveInt, fc.integer({ min: 3, max: 10 })],
    ([baseMs, maxExponent]) => {
      const maxMs = baseMs * Math.pow(2, maxExponent + 2)
      const fn = computeRetryDelay(baseMs, maxMs, maxExponent)
      return fn(1) === baseMs * 2 &&
        fn(2) === baseMs * 4 &&
        fn(3) === baseMs * 8
    },
  )
})
