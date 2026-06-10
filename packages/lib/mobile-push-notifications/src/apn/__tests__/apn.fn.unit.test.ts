import { describe, expect, it } from '@effect/vitest'
import { HashSet, Redacted } from 'effect'
import { Either, Option } from 'effect'
import * as helpers from '../apn.fn.js'
import { APNTopic } from '../types.js'
import type { APNTargetResult } from '../types.js'

const TOPIC = APNTopic.make('com.example.app')
const SUFFIXES = HashSet.fromIterable(['.develop', '.staging'])

function makeTargetResult(overrides: Partial<APNTargetResult> & Pick<APNTargetResult, 'result'>): APNTargetResult {
  return { environment: 'production', topic: TOPIC, ...overrides }
}

describe('APN Helpers', () => {
  describe('validateToken', () => {
    it('Should_SucceedWithValidDeviceToken_When_TokenIsValid', () => {
      const token = Redacted.make('a'.repeat(64))
      const result = helpers.validateToken(token)
      expect.soft(Either.isRight(result), 'valid token should have length 64').toBeTruthy()
      if (Either.isRight(result)) {
        expect(Redacted.value(result.right), 'valid token should have length 64').toHaveLength(64)
      }
    })

    it('Should_ReturnErrorWithMessage_When_TokenLengthInvalid', () => {
      const result = helpers.validateToken(Redacted.make('short'))
      expect.soft(Either.isLeft(result), 'should reject invalid token length').toBeTruthy()
      if (Either.isLeft(result)) {
        expect(result.left.message, 'error should include descriptive message').toBe('Invalid device token')
      }
    })
  })

  describe('aggregateResults', () => {
    it('Should_ReturnSuccessWithNoCounts_When_NoFailures', () => {
      const aggregated = helpers.aggregateResults([
        makeTargetResult({ result: { sent: [{ device: 't1' }], failed: [] } }),
      ])
      expect(aggregated.success, 'success should be true when no failures').toBe(true)
      expect.soft(aggregated.sent, 'sent count should be 1').toBe(1)
      expect.soft(aggregated.failed, 'failed count should be 0').toBe(0)
      expect.soft(aggregated.errors, 'errors should be undefined when no failures').toBeUndefined()
    })

    it('Should_AggregateAcrossTargets_When_MultipleTargetsProvided', () => {
      const aggregated = helpers.aggregateResults([
        makeTargetResult({ result: { sent: [{ device: 't1' }, { device: 't2' }], failed: [] } }),
        makeTargetResult({
          environment: 'development',
          result: { sent: [{ device: 't3' }], failed: [{ device: 't4', status: 410 }] },
        }),
      ])
      expect(aggregated.success, 'success should be true when at least one sent').toBe(true)
      expect.soft(aggregated.sent, 'sent count should aggregate across targets').toBe(3)
      expect.soft(aggregated.failed, 'failed count should aggregate across targets').toBe(1)
      expect.soft(aggregated.errors, 'errors should have 1 entry').toHaveLength(1)
    })

    it('Should_IncludeErrorDetails_When_FailuresHaveStatusAndResponse', () => {
      const aggregated = helpers.aggregateResults([
        makeTargetResult({
          result: {
            sent: [],
            failed: [
              { device: 'token1', status: 410, response: { reason: 'Unregistered' } },
              { device: 'token2', status: 400 },
            ],
          },
        }),
      ])
      expect(aggregated.errors, 'should have 2 errors').toHaveLength(2)
      expect.soft(aggregated.errors?.[0], 'first error should have status and response').toMatchObject({
        device: 'token1',
        environment: 'production',
        status: 410,
        response: { reason: 'Unregistered' },
      })
      expect.soft(aggregated.errors?.[1], 'second error should have status').toMatchObject({
        device: 'token2',
        environment: 'production',
        status: 400,
      })
    })

    it('Should_OmitStatusAndResponse_When_FailureHasNoStatusOrResponse', () => {
      const aggregated = helpers.aggregateResults([
        makeTargetResult({ result: { sent: [], failed: [{ device: 'token1' }] } }),
      ])
      expect(aggregated.errors, 'should have 1 error').toHaveLength(1)
      expect.soft(aggregated.errors?.[0], 'status key should be absent when undefined').not.toHaveProperty('status')
      expect.soft(aggregated.errors?.[0], 'response key should be absent when undefined').not.toHaveProperty('response')
    })

    it('Should_ReturnFalse_When_AllTargetsFailed', () => {
      const aggregated = helpers.aggregateResults([
        makeTargetResult({ result: { sent: [], failed: [{ device: 't1', status: 410 }] } }),
      ])
      expect(aggregated.success, 'success should be false when nothing sent').toBe(false)
      expect(aggregated.sent, 'sent count should be 0').toBe(0)
      expect(aggregated.failed, 'failed count should be 1').toBe(1)
    })

    it('Should_ReturnTrue_When_MixedResultsAcrossEnvironments', () => {
      const aggregated = helpers.aggregateResults([
        makeTargetResult({ result: { sent: [{ device: 't1' }], failed: [{ device: 't2', status: 410 }] } }),
        makeTargetResult({
          environment: 'development',
          result: { sent: [], failed: [{ device: 't3', status: 400 }] },
        }),
      ])
      expect(aggregated.success, 'success should be true when at least one sent').toBe(true)
      expect(aggregated.sent).toBe(1)
      expect(aggregated.failed).toBe(2)
    })
  })

  describe('routeToEnvironments', () => {
    // Core routing (develop → both, non-develop → default) is covered by property tests.
    // Unit tests cover edge cases not reachable by the arbitraries.

    it('Should_BeCaseInsensitive_When_MatchingSuffixes', () => {
      const result = helpers.routeToEnvironments(APNTopic.make('com.example.app.Develop'), 'production', SUFFIXES)
      expect(result, 'uppercase suffix should still match').toHaveLength(2)
    })

    it('Should_NotMatch_When_SuffixAppearsInMiddle', () => {
      const result = helpers.routeToEnvironments(APNTopic.make('com.develop.app'), 'production', SUFFIXES)
      expect(result, 'mid-string suffix should not match').toHaveLength(1)
    })

    it('Should_RouteToDefaultOnly_When_SuffixSetIsEmpty', () => {
      const result = helpers.routeToEnvironments(
        APNTopic.make('com.example.app.develop'),
        'production',
        HashSet.empty(),
      )
      expect(result, 'empty suffix set should never dual-route').toHaveLength(1)
    })

    it('Should_RouteToBothEnvironments_When_DualFlowEnabledAndSuffixMatches', () => {
      const result = helpers.routeToEnvironments(APNTopic.make('com.example.app.develop'), 'production', SUFFIXES)
      expect(result, 'matching suffix should route to both environments').toHaveLength(2)
      expect(result[0]!.environment, 'first target should be development').toBe('development')
      expect(result[1]!.environment, 'second target should be production').toBe('production')
    })
  })

  describe('resolveTopics', () => {
    const configTopics = [APNTopic.make('com.example.default')] as const

    it('Should_ReturnRequestTopics_When_Provided', () => {
      const result = helpers.resolveTopics(['com.example.app'], configTopics)
      expect(result, 'should be Right').toEqual(Either.right([APNTopic.make('com.example.app')]))
    })

    it('Should_FallBackToConfigTopics_When_RequestTopicsAbsent', () => {
      const fromEmpty = helpers.resolveTopics([], configTopics)
      const fromUndefined = helpers.resolveTopics(undefined, configTopics)
      expect(fromEmpty, 'empty array should be Right').toEqual(Either.right([APNTopic.make('com.example.default')]))
      expect(fromUndefined, 'undefined should be Right').toEqual(Either.right([APNTopic.make('com.example.default')]))
    })

    it('Should_FailWithMessage_When_NoTopicsAvailable', () => {
      const result = helpers.resolveTopics(undefined, [])
      expect.soft(Either.isLeft(result), 'should fail when no topics available').toBeTruthy()
      if (Either.isLeft(result)) {
        expect(result.left.message, 'error should describe the problem').toBe('No APN topics configured or provided')
      }
    })

    it('Should_ReportAllInvalidTopics_When_RequestTopicsAreInvalid', () => {
      const result = helpers.resolveTopics(['bad!', 'com.example.valid', '??'], [])
      expect.soft(Either.isLeft(result), 'should fail when any topic is invalid').toBeTruthy()
      if (Either.isLeft(result)) {
        expect(result.left.message, 'error should list all invalid topics').toContain('bad!')
        expect(result.left.message, 'error should list all invalid topics').toContain('??')
      }
    })
  })

  describe('decideLogging', () => {
    it('Should_ReturnWarningWithReasons_When_ThereAreFailures', () => {
      const result = helpers.decideLogging(2, ['Unregistered', undefined, 'BadDeviceToken'])
      expect(result.level, 'should be warning level when failures exist').toBe('warning')
      expect(result.reasons, 'should filter out undefined reasons').toEqual(['Unregistered', 'BadDeviceToken'])
    })

    it('Should_ReturnDebugWithNoReasons_When_NoFailures', () => {
      const result = helpers.decideLogging(0, [])
      expect(result.level, 'should be debug level when no failures').toBe('debug')
      expect(result.reasons, 'reasons should be absent when no failures').toBeUndefined()
    })
  })

  describe('classifyApnsResult', () => {
    it.each(
      [
        ['Unregistered', 'token_unregistered'],
        ['ExpiredToken', 'token_unregistered'],
        ['BadDeviceToken', 'token_invalid'],
        ['DeviceTokenNotForTopic', 'token_invalid'],
      ] as const,
    )(
      'Should_ClassifyAsTerminal_When_AllTargetsFailedWithReason_%s',
      (reason, expectedTokenReason) => {
        const result = helpers.classifyApnsResult('t1', [
          makeTargetResult({
            result: { sent: [], failed: [{ device: 't1', status: 410, response: { reason } }] },
          }),
        ])
        expect(Option.isSome(result), 'terminal failure should be classified').toBe(true)
        if (Option.isSome(result)) {
          expect.soft(result.value.reason).toBe(expectedTokenReason)
          expect.soft(result.value.providerCode).toBe(reason)
        }
      },
    )

    it('Should_ReturnNone_When_TargetTokenSentInAnyEnvironment', () => {
      const result = helpers.classifyApnsResult('t1', [
        makeTargetResult({ result: { sent: [{ device: 't1' }], failed: [] } }),
        makeTargetResult({
          environment: 'development',
          result: { sent: [], failed: [{ device: 't1', response: { reason: 'BadDeviceToken' } }] },
        }),
      ])
      expect(Option.isNone(result), 'dev/prod fanout success should not classify as terminal').toBe(true)
    })

    it('Should_ClassifyAsTerminal_When_OtherDeviceSentButTargetFailedTerminally', () => {
      const result = helpers.classifyApnsResult('t2', [
        makeTargetResult({ result: { sent: [{ device: 't1' }], failed: [] } }),
        makeTargetResult({
          environment: 'development',
          result: { sent: [], failed: [{ device: 't2', response: { reason: 'Unregistered' } }] },
        }),
      ])
      expect(Option.isSome(result), 'unrelated device success should not mask terminal failure').toBe(true)
      if (Option.isSome(result)) {
        expect.soft(result.value.reason).toBe('token_unregistered')
        expect.soft(result.value.providerCode).toBe('Unregistered')
      }
    })

    it('Should_IgnoreFailures_When_DeviceIsNotTarget', () => {
      const result = helpers.classifyApnsResult('t1', [
        makeTargetResult({
          result: {
            sent: [],
            failed: [
              { device: 't1', response: { reason: 'Unregistered' } },
              { device: 't2', response: { reason: 'TooManyRequests' } },
            ],
          },
        }),
      ])
      expect(Option.isSome(result), 'other device transient failure should not affect target').toBe(true)
      if (Option.isSome(result)) {
        expect.soft(result.value.reason).toBe('token_unregistered')
      }
    })

    it('Should_ReturnNone_When_FailureReasonIsNotTerminal', () => {
      const result = helpers.classifyApnsResult('t1', [
        makeTargetResult({
          result: { sent: [], failed: [{ device: 't1', status: 503, response: { reason: 'ServiceUnavailable' } }] },
        }),
      ])
      expect(Option.isNone(result), 'transient APNS reason should not classify as terminal').toBe(true)
    })

    it('Should_ReturnNone_When_FailureReasonIsMissing', () => {
      const result = helpers.classifyApnsResult('t1', [
        makeTargetResult({ result: { sent: [], failed: [{ device: 't1' }] } }),
      ])
      expect(Option.isNone(result), 'missing reason should not classify as terminal').toBe(true)
    })

    it('Should_ReturnNone_When_TargetTokenHasMixedTerminalAndTransient', () => {
      const result = helpers.classifyApnsResult('t1', [
        makeTargetResult({
          result: {
            sent: [],
            failed: [
              { device: 't1', response: { reason: 'Unregistered' } },
              { device: 't1', response: { reason: 'TooManyRequests' } },
            ],
          },
        }),
      ])
      expect(Option.isNone(result), 'same-token mixed reasons should not classify as terminal').toBe(true)
    })

    it('Should_ReturnNone_When_NoFailuresPresent', () => {
      const result = helpers.classifyApnsResult('t1', [
        makeTargetResult({ result: { sent: [], failed: [] } }),
      ])
      expect(Option.isNone(result)).toBe(true)
    })

    it('Should_ReturnNone_When_ResultsArrayIsEmpty', () => {
      expect(Option.isNone(helpers.classifyApnsResult('t1', []))).toBe(true)
    })

    it('Should_ClassifyAsTerminal_When_AllEnvironmentsAgreeOnTerminalReason', () => {
      const result = helpers.classifyApnsResult('t1', [
        makeTargetResult({
          environment: 'development',
          result: { sent: [], failed: [{ device: 't1', response: { reason: 'Unregistered' } }] },
        }),
        makeTargetResult({
          environment: 'production',
          result: { sent: [], failed: [{ device: 't1', response: { reason: 'BadDeviceToken' } }] },
        }),
      ])
      expect(Option.isSome(result), 'all-terminal across environments should classify as terminal').toBe(true)
      if (Option.isSome(result)) {
        expect.soft(result.value.reason).toBe('token_unregistered')
      }
    })
  })
})
