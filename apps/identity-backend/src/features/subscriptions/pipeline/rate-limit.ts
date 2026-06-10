// oxlint-disable require-yield
/// <reference types="vitest/importMeta" />

export const RATE_LIMIT_WINDOW_MS = 60_000
export const RATE_LIMIT_COOLDOWN_MS = 120_000
export const MAX_NOTIFICATIONS_PER_WINDOW = 30
export const DEFAULT_RETRY_BASE_MS = 1_000
export const DEFAULT_RETRY_MAX_MS = 60_000

export const DEFAULT_RATE_LIMIT_CONFIG = {
  windowSizeMs: RATE_LIMIT_WINDOW_MS,
  maxPerWindow: MAX_NOTIFICATIONS_PER_WINDOW,
  cooldownMs: RATE_LIMIT_COOLDOWN_MS,
} as const

export const ZERO_STATE = { windowStart: new Date(0), notificationCount: 0 } as const

export const calculateRateLimitOutput = (
  rateState: { readonly windowStart: Date; readonly notificationCount: number },
  now: Date,
  config: { readonly cooldownMs: number; readonly maxPerWindow: number },
): 'pass' | 'blocked' => {
  const cooldownEndMs = rateState.windowStart.getTime() + config.cooldownMs
  const overLimit = rateState.notificationCount >= config.maxPerWindow
  if (overLimit && now.getTime() <= cooldownEndMs) {
    return 'blocked'
  }
  return 'pass'
}

export const computeNewRateState = (
  rateState: { readonly windowStart: Date; readonly notificationCount: number },
  now: Date,
  config: { readonly windowSizeMs: number },
): { readonly windowStart: Date; readonly notificationCount: number } => {
  if (now.getTime() >= rateState.windowStart.getTime() + config.windowSizeMs) {
    return { windowStart: now, notificationCount: 1 }
  }
  return { windowStart: rateState.windowStart, notificationCount: rateState.notificationCount + 1 }
}

export const buildRateLimitMap = (
  records: readonly {
    readonly clientId: string
    readonly windowStart: Date
    readonly notificationCount: number
  }[],
): Map<string, { readonly windowStart: Date; readonly notificationCount: number }> =>
  new Map(
    records.map((record) =>
      [
        record.clientId,
        { windowStart: record.windowStart, notificationCount: record.notificationCount },
      ] as const
    ),
  )

// Stryker disable all
if (import.meta.vitest) {
  const { describe, it } = await import('@effect/vitest')
  const { Arbitrary, FastCheck: fc } = await import('effect')
  const { PipelineRateState, PipelineRateLimitConfig } = await import('../types.js')

  const rateStateArb = Arbitrary.make(PipelineRateState)
  const rateLimitConfigArb = Arbitrary.make(PipelineRateLimitConfig)

  // Zero-state for "no DB row" case
  const zeroStateArb = fc.constant(ZERO_STATE)

  // Rate state at max — notificationCount = config.maxPerWindow
  const _rateStateAtMaxArb = rateStateArb.chain((state) =>
    rateLimitConfigArb.chain((config) => fc.constant({ ...state, notificationCount: config.maxPerWindow }))
  )

  // now within window: windowStart + [0, windowSizeMs)
  const _nowWithinWindowArb = rateStateArb.chain((state) =>
    rateLimitConfigArb.chain((config) => {
      if (config.windowSizeMs <= 0) {
        return fc.constant(new Date(state.windowStart.getTime()))
      }
      return fc.integer({ min: 0, max: Math.max(0, config.windowSizeMs - 1) }).map((offset) =>
        new Date(state.windowStart.getTime() + offset)
      )
    })
  )

  const MAX_SAFE_DATE_MS = 8640000000000000

  // now past cooldown: windowStart + cooldownMs + 1+
  const _nowPastCooldownArb = rateStateArb.chain((state) =>
    rateLimitConfigArb.chain((config) => {
      const maxExtra = Math.max(0, MAX_SAFE_DATE_MS - state.windowStart.getTime() - config.cooldownMs - 1)
      return fc.nat({ max: maxExtra }).map((extra) =>
        new Date(state.windowStart.getTime() + config.cooldownMs + 1 + extra)
      )
    })
  )

  // now within cooldown: windowStart + windowSizeMs + [1, cooldownMs - windowSizeMs - 1]
  const _nowWithinCooldownArb = rateStateArb.chain((state) =>
    rateLimitConfigArb.chain((config) => {
      const gap = config.cooldownMs - config.windowSizeMs
      if (gap <= 1) {
        return fc.constant(new Date(state.windowStart.getTime() + config.cooldownMs))
      }
      return fc.integer({ min: 1, max: gap - 1 }).map((offset) =>
        new Date(state.windowStart.getTime() + config.windowSizeMs + offset)
      )
    })
  )

  // now at or past window end: windowStart + windowSizeMs+
  const _nowPastWindowArb = rateStateArb.chain((state) =>
    rateLimitConfigArb.chain((config) => {
      const maxExtra = Math.max(0, MAX_SAFE_DATE_MS - state.windowStart.getTime() - config.windowSizeMs)
      return fc.nat({ max: maxExtra }).map((extra) =>
        new Date(state.windowStart.getTime() + config.windowSizeMs + extra)
      )
    })
  )

  // Correlated composites for rate-limit check (state + config + now share same base)
  const atMaxWithinCooldownArb = rateStateArb.chain((state) =>
    rateLimitConfigArb.chain((config) => {
      const atMaxState = { ...state, notificationCount: config.maxPerWindow }
      const gap = config.cooldownMs - config.windowSizeMs
      if (gap <= 1) {
        return fc.constant({
          rateState: atMaxState,
          config,
          now: new Date(state.windowStart.getTime() + config.cooldownMs),
        })
      }
      return fc.integer({ min: 1, max: gap - 1 }).map((offset) => ({
        rateState: atMaxState,
        config,
        now: new Date(state.windowStart.getTime() + config.windowSizeMs + offset),
      }))
    })
  )

  const atMaxPastCooldownArb = rateStateArb.chain((state) =>
    rateLimitConfigArb.chain((config) => {
      const maxExtra = Math.max(0, MAX_SAFE_DATE_MS - state.windowStart.getTime() - config.cooldownMs - 1)
      return fc.nat({ max: maxExtra }).map((extra) => ({
        rateState: { ...state, notificationCount: config.maxPerWindow },
        config,
        now: new Date(state.windowStart.getTime() + config.cooldownMs + 1 + extra),
      }))
    })
  )

  const stateWithPastWindowArb = rateStateArb.chain((rateState) =>
    rateLimitConfigArb.chain((config) => {
      const maxExtra = Math.max(0, MAX_SAFE_DATE_MS - rateState.windowStart.getTime() - config.windowSizeMs)
      return fc.nat({ max: maxExtra }).map((extra) => ({
        rateState,
        config,
        now: new Date(rateState.windowStart.getTime() + config.windowSizeMs + extra),
      }))
    })
  )

  const stateWithWithinWindowArb = rateStateArb.chain((rateState) =>
    rateLimitConfigArb.chain((config) => {
      if (config.windowSizeMs <= 0) {
        return fc.constant({
          rateState,
          config,
          now: new Date(rateState.windowStart.getTime()),
        })
      }
      return fc.integer({ min: 0, max: Math.max(0, config.windowSizeMs - 1) }).map((offset) => ({
        rateState,
        config,
        now: new Date(rateState.windowStart.getTime() + offset),
      }))
    })
  )

  describe('rate-limit pure functions', () => {
    it.prop(
      '∀x_ReturnPassCountBelowMax_=x',
      [rateStateArb, rateLimitConfigArb, fc.date()],
      ([rateState, config, now]) =>
        calculateRateLimitOutput(
          { ...rateState, notificationCount: config.maxPerWindow - 1 },
          now,
          config,
        ) === 'pass',
    )

    it.prop(
      '→x_ReturnBlockedCountAtMaxWithinCooldown_=x',
      [atMaxWithinCooldownArb],
      ([{ rateState, config, now }]) => calculateRateLimitOutput(rateState, now, config) === 'blocked',
    )

    it.prop(
      '∀x_ReturnPassCountAtMaxPastCooldown_=x',
      [atMaxPastCooldownArb],
      ([{ rateState, config, now }]) => calculateRateLimitOutput(rateState, now, config) === 'pass',
    )

    it.prop(
      '→x_ResetWindowNowPastWindowSize_=x',
      [stateWithPastWindowArb],
      ([{ rateState, config, now }]) => {
        const result = computeNewRateState(rateState, now, config)
        return result.windowStart.getTime() === now.getTime() && result.notificationCount === 1
      },
    )

    it.prop(
      '∀x_IncrementCountNowWithinWindow_=x',
      [stateWithWithinWindowArb],
      ([{ rateState, config, now }]) => {
        const result = computeNewRateState(rateState, now, config)
        return (
          result.windowStart.getTime() === rateState.windowStart.getTime() &&
          result.notificationCount === rateState.notificationCount + 1
        )
      },
    )

    it.prop(
      '∀x_ReturnPassZeroState_=x',
      [zeroStateArb, rateLimitConfigArb, fc.date()],
      ([zeroState, config, now]) => calculateRateLimitOutput(zeroState, now, config) === 'pass',
    )
  })
}
