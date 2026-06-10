import { it } from '@effect/vitest'
import { Effect } from 'effect'
import { describe, expect } from 'vitest'

import type { IndividualityUsername } from '#root/db/schema.js'
import {
  categorizeFailures,
  computeNextRetryAt,
  MAX_AH_RETRIES,
  partitionByFreshness,
  partitionReady,
  processEventsPure,
  RETRY_BACKOFF_SECONDS,
  TERMINAL_DOTNS_ERRORS,
} from './dotns-reservation.worker.js'

function makeRow(overrides: Partial<IndividualityUsername> = {}): IndividualityUsername {
  return {
    username: 'u',
    fullUsername: 'u.0',
    reservedUsername: null,
    digits: '0',
    network: 'paseo',
    candidateAccountId: '0xaa',
    candidateSignature: '0xaa',
    ringVrfKey: '0xaa',
    proofOfOwnership: '0xaa',
    consumerRegistrationSignature: '0xaa',
    identifierKey: '0xaa',
    candidateSignatureDotns: '0xaa',
    signedAt: new Date(),
    status: 'RESERVED',
    ahStatus: 'RESERVED',
    source: 'INTERNAL',
    onchainData: null,
    ahOnchainData: null,
    retryAt: null,
    retryCount: 0,
    ahRetryAt: null,
    ahRetryCount: 0,
    traceId: null,
    spanId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

describe('partitionReady', () => {
  it.effect('Should_PutRowInReady_When_SignatureAndSignedAtPresent', () =>
    Effect.sync(() => {
      const { ready, missingFields } = partitionReady([makeRow()])
      expect(ready).toHaveLength(1)
      expect(missingFields).toHaveLength(0)
    }))

  it.effect('Should_PutRowInMissingFields_When_SignatureNull', () =>
    Effect.sync(() => {
      const { ready, missingFields } = partitionReady([makeRow({ candidateSignatureDotns: null })])
      expect(ready).toHaveLength(0)
      expect(missingFields).toHaveLength(1)
    }))

  it.effect('Should_PutRowInMissingFields_When_SignedAtNull', () =>
    Effect.sync(() => {
      const { ready, missingFields } = partitionReady([makeRow({ signedAt: null })])
      expect(ready).toHaveLength(0)
      expect(missingFields).toHaveLength(1)
    }))
})

describe('partitionByFreshness', () => {
  it.effect('Should_PutRowInExpired_When_AgeExceedsDeadline', () =>
    Effect.sync(() => {
      const now = 1_700_000_000
      const row = makeRow({ signedAt: new Date((now - 1000) * 1000) })
      const { fresh, expired, future } = partitionByFreshness([row as never], now, 80, 50)
      expect(expired).toHaveLength(1)
      expect(fresh).toHaveLength(0)
      expect(future).toHaveLength(0)
    }))

  it.effect('Should_PutRowInFuture_When_SignedAtInFuture', () =>
    Effect.sync(() => {
      const now = 1_700_000_000
      const row = makeRow({ signedAt: new Date((now + 1000) * 1000) })
      const { fresh, expired, future } = partitionByFreshness([row as never], now, 80, 50)
      expect(future).toHaveLength(1)
      expect(fresh).toHaveLength(0)
      expect(expired).toHaveLength(0)
    }))

  it.effect('Should_PutRowInFresh_When_WithinDeadline', () =>
    Effect.sync(() => {
      const now = 1_700_000_000
      const row = makeRow({ signedAt: new Date((now - 10) * 1000) })
      const { fresh, expired, future } = partitionByFreshness([row as never], now, 80, 50)
      expect(fresh).toHaveLength(1)
      expect(expired).toHaveLength(0)
      expect(future).toHaveLength(0)
    }))
})

describe('computeNextRetryAt', () => {
  it.effect('Should_ReturnNull_When_RetryCountAtMax', () =>
    Effect.sync(() => {
      expect(computeNextRetryAt(MAX_AH_RETRIES, new Date())).toBeNull()
    }))

  it.effect('Should_ReturnNull_When_RetryCountExceedsMax', () =>
    Effect.sync(() => {
      expect(computeNextRetryAt(MAX_AH_RETRIES + 5, new Date())).toBeNull()
    }))

  it.effect('Should_ReturnNowPlusBackoff_When_RetryCountBelowMax', () =>
    Effect.sync(() => {
      const now = new Date(1_700_000_000_000)
      const n = 2
      const result = computeNextRetryAt(n, now)
      expect(result).not.toBeNull()
      expect(result!.getTime()).toBe(now.getTime() + RETRY_BACKOFF_SECONDS[n]! * 1000)
    }))
})

interface FilteredUtilityItemFailedEvent {
  readonly payload: {
    readonly error: {
      readonly type: 'Module'
      readonly value: {
        readonly type: 'DotnsGateway'
        readonly value: { readonly type: string }
      }
    }
  }
}

function makeUtilityItemFailedEvent(errorType: string): FilteredUtilityItemFailedEvent {
  return {
    payload: {
      error: {
        type: 'Module',
        value: {
          type: 'DotnsGateway',
          value: { type: errorType },
        },
      },
    },
  }
}

describe('categorizeFailures', () => {
  it.effect('Should_GroupAlreadyRegistered_When_ErrorIsAlreadyRegistered', () =>
    Effect.sync(() => {
      const result = categorizeFailures([
        { event: makeUtilityItemFailedEvent('AlreadyRegistered') as never, itemIndex: 0, originalEventIndex: 0 },
      ])
      expect(result.alreadyRegistered).toHaveLength(1)
      expect(result.terminalErrors).toHaveLength(0)
      expect(result.retryableItems).toHaveLength(0)
    }))

  it.effect('Should_GroupTerminalError_When_ErrorIsInTerminalSet', () =>
    Effect.sync(() => {
      const result = categorizeFailures([
        { event: makeUtilityItemFailedEvent('InvalidName') as never, itemIndex: 0, originalEventIndex: 0 },
      ])
      expect(result.terminalErrors).toHaveLength(1)
      expect(result.terminalErrors[0]?.reason).toBe('InvalidName')
      expect(result.alreadyRegistered).toHaveLength(0)
      expect(result.retryableItems).toHaveLength(0)
    }))

  it.effect('Should_GroupUnknownError_When_ErrorNotInKnownSet', () =>
    Effect.sync(() => {
      const result = categorizeFailures([
        { event: makeUtilityItemFailedEvent('SomeUnknownRuntimeError') as never, itemIndex: 0, originalEventIndex: 0 },
      ])
      expect(result.retryableItems).toHaveLength(1)
      expect(result.terminalErrors).toHaveLength(0)
      expect(result.alreadyRegistered).toHaveLength(0)
    }))

  it.effect('Should_GroupNullEvent_When_EventIsUndefined', () =>
    Effect.sync(() => {
      const result = categorizeFailures([{ event: undefined, itemIndex: 0, originalEventIndex: 0 }])
      expect(result.retryableItems).toHaveLength(1)
      expect(result.terminalErrors).toHaveLength(0)
      expect(result.alreadyRegistered).toHaveLength(0)
    }))

  it.effect('Should_PartitionAllFailures_When_GivenMixedFailures', () =>
    Effect.sync(() => {
      const events = [
        { event: makeUtilityItemFailedEvent('AlreadyRegistered') as never, itemIndex: 0, originalEventIndex: 0 },
        { event: makeUtilityItemFailedEvent('InvalidName') as never, itemIndex: 1, originalEventIndex: 1 },
        { event: makeUtilityItemFailedEvent('UnknownError') as never, itemIndex: 2, originalEventIndex: 2 },
        { event: undefined, itemIndex: 3, originalEventIndex: 3 },
      ]
      const result = categorizeFailures(events)
      const total = result.alreadyRegistered.length + result.terminalErrors.length + result.retryableItems.length
      expect(total).toBe(events.length)
    }))
})

describe('TERMINAL_DOTNS_ERRORS', () => {
  it('Should_IncludeExpectedErrorNames_When_Enumerated', () => {
    expect(TERMINAL_DOTNS_ERRORS.has('InvalidName')).toBe(true)
    expect(TERMINAL_DOTNS_ERRORS.has('InvalidAttestationSignature')).toBe(true)
    expect(TERMINAL_DOTNS_ERRORS.has('ReservationSignatureExpired')).toBe(true)
    expect(TERMINAL_DOTNS_ERRORS.has('ReservationSignatureFromFuture')).toBe(true)
    expect(TERMINAL_DOTNS_ERRORS.has('NotLiteLabelOwner')).toBe(true)
    expect(TERMINAL_DOTNS_ERRORS.has('ContractRevert')).toBe(true)
  })

  it('Should_ExcludeAlreadyRegistered_When_NotTerminal', () => {
    expect(TERMINAL_DOTNS_ERRORS.has('AlreadyRegistered')).toBe(false)
  })
})

describe('processEventsPure', () => {
  const identityFilter = <T>(xs: readonly T[]) => xs

  it.effect('Should_ReturnEmpty_When_NoUtilityEvents', () =>
    Effect.sync(() => {
      const result = processEventsPure([] as never, identityFilter as never)
      expect(result.successes).toEqual([])
      expect(result.alreadyRegistered).toEqual([])
      expect(result.terminalErrors).toEqual([])
      expect(result.retryableItems).toEqual([])
    }))

  it.effect('Should_GroupItemCompleted_When_UtilityItemCompletedEvents', () =>
    Effect.sync(() => {
      const events = [
        { type: 'Utility', value: { type: 'ItemCompleted' } },
        { type: 'Utility', value: { type: 'ItemCompleted' } },
      ]
      const result = processEventsPure(events as never, identityFilter as never)
      expect(result.successes).toHaveLength(2)
      expect(result.successes[0]?.itemIndex).toBe(0)
      expect(result.successes[1]?.itemIndex).toBe(1)
    }))
})
