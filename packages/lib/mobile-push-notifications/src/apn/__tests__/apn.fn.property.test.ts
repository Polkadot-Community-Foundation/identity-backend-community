import { describe, expect, it } from '@effect/vitest'
import { FastCheck as fc } from 'effect'
import * as helpers from '../apn.fn.js'
import { APNTopic } from '../types.js'
import { TEST_SUFFIXES } from './fixtures.js'

const ValidTopicArbitrary = fc
  .stringMatching(/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/)
  .filter((t) => !Array.from(TEST_SUFFIXES).some((suffix) => t.endsWith(suffix)))
  .map((t) => APNTopic.make(t))

const DevelopTopicArbitrary = fc
  .stringMatching(/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/)
  .map((t) => APNTopic.make(`${t}.develop`))

const APNTopicWithVoipSuffix = fc
  .stringMatching(/^[a-zA-Z][a-zA-Z0-9]*(\.[a-zA-Z][a-zA-Z0-9]*)+$/)
  .map((topic) => APNTopic.make(`${topic}.voip`))

describe('APN Helpers', () => {
  describe('routeToEnvironments', () => {
    it.prop(
      '→Develop_Targets_=2',
      [DevelopTopicArbitrary],
      ([topic]) => {
        const result = helpers.routeToEnvironments(topic, 'production', TEST_SUFFIXES)
        expect(result, `develop topic should route to both environments: ${String(topic)}`).toHaveLength(2)
        return true
      },
      { fastCheck: { numRuns: 100 } },
    )

    it.prop(
      '→NonDevelop_Targets_=1',
      [ValidTopicArbitrary],
      ([topic]) => {
        const result = helpers.routeToEnvironments(topic, 'production', TEST_SUFFIXES)
        expect(result, `non-develop topic should route to default environment only: ${String(topic)}`).toHaveLength(1)
        return true
      },
      { fastCheck: { numRuns: 100 } },
    )
  })

  describe('formatTopic', () => {
    it.prop(
      '→VoipPush∧¬Voip_Format_⊇Voip',
      [ValidTopicArbitrary],
      ([topic]) => {
        const result = helpers.formatTopic(topic, true)
        expect(result, `voip suffix missing for topic: ${String(topic)}`).toMatch(/\.voip$/)
        return true
      },
      { fastCheck: { numRuns: 100 } },
    )

    it.prop(
      '→VoipPush∧Voip_Format_≠Duplicate',
      [APNTopicWithVoipSuffix],
      ([topic]) => {
        const result = helpers.formatTopic(topic, true)
        const voipCount = result.match(/\.voip/g)?.length ?? 0
        expect(voipCount, `duplicate .voip suffix detected for topic: ${String(topic)}`).toBe(1)
        return true
      },
      { fastCheck: { numRuns: 100 } },
    )

    it.prop(
      '→NonVoipPush_Format_=Original',
      [ValidTopicArbitrary],
      ([topic]) => {
        const result = helpers.formatTopic(topic, false)
        expect(result, `non-voip topic should be unchanged: ${String(topic)}`).toBe(String(topic))
        return true
      },
      { fastCheck: { numRuns: 100 } },
    )

    it.prop(
      '→NonVoipPush∧Voip_Format_=Voip',
      [APNTopicWithVoipSuffix],
      ([topic]) => {
        const result = helpers.formatTopic(topic, false)
        expect(result, `voip-suffixed topic should remain unchanged for non-voip flag: ${String(topic)}`).toBe(
          String(topic),
        )
        return true
      },
      { fastCheck: { numRuns: 100 } },
    )
  })
})
