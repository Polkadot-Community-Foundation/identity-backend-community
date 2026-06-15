import { describe, it } from '@effect/vitest'
import { ruleOfSchemas } from '@identity-backend/testing/schema'
import { FastCheck as fc } from 'effect'
import { expect } from 'vitest'
import {
  CIDR_OR_IP,
  deriveDefaultLimits,
  EndpointDemand,
  maxConnectionsFromMemoryGiB,
  sharedNatClause,
  SizingInputs,
} from './mod.js'

ruleOfSchemas('EndpointDemand', EndpointDemand)
ruleOfSchemas('SizingInputs', SizingInputs)

describe('deriveDefaultLimits at the documented scenario (pop=1000, pods=2, 1 GiB DB)', () => {
  it('Should_MatchHandComputedDerivation_When_Population1000Pods2', () => {
    const d = deriveDefaultLimits(1000, 2)
    expect(d.effectiveDbConnections).toBe(100)
    expect(d.tightestCapacityRpm).toBe(56_250)
    expect(d.bindingClassKey).toBe('handshake')
    expect(d.aggregatePeakDemandRpm).toBe(165_000)
    expect(d.sharedNatCeilingRpm).toBe(56_250)
    expect(d.offNatPerIpRpm).toBe(165)
    expect(d.recommendedWebPoolPerInstance).toBe(3)
    expect(d.powDifficultyBits).toBe(16)
    expect(d.originPerJwtOverallRpm).toEqual({
      public_reads: 90,
      authenticated_actions: 45,
      registration: 6,
      handshake: 18,
      token_refresh: 6,
    })
    expect(d.warnings.some((w) => w.includes('exceeds the tightest class capacity'))).toBe(true)
  })

  it('Should_ScaleOnlyCpuExternalCapacityWithPods_When_Population1000Pods4', () => {
    const d = deriveDefaultLimits(1000, 4)
    expect(d.bindingClassKey).toBe('handshake')
    expect(d.tightestCapacityRpm).toBe(112_500)
    expect(d.sharedNatCeilingRpm).toBe(112_500)
  })

  it('Should_NotLowerSharedNatCeiling_When_PodsIncrease', () => {
    fc.assert(fc.property(
      fc.integer({ min: 1, max: 50_000 }),
      fc.integer({ min: 1, max: 32 }),
      fc.integer({ min: 1, max: 32 }),
      (population, a, b) => {
        const [lo, hi] = a <= b ? [a, b] : [b, a]
        return deriveDefaultLimits(population, hi).sharedNatCeilingRpm >=
          deriveDefaultLimits(population, lo).sharedNatCeilingRpm
      },
    ))
  })
})

describe('maxConnectionsFromMemoryGiB (RDS LEAST(mem/9531392, 5000))', () => {
  it('Should_MatchRdsFormula_When_GivenKnownInstanceSizes', () => {
    expect(maxConnectionsFromMemoryGiB(1)).toBe(112)
    expect(maxConnectionsFromMemoryGiB(8)).toBe(901)
    expect(maxConnectionsFromMemoryGiB(0.5)).toBe(56)
  })

  it('Should_CapAtFiveThousand_When_InstanceIsVeryLarge', () => {
    expect(maxConnectionsFromMemoryGiB(4096)).toBe(5000)
  })
})

describe('sharedNatClause CIDR validation', () => {
  it('Should_Accept_When_GivenValidIpsAndCidrs', () => {
    for (const v of ['203.0.113.7', '203.0.113.0/24', '10.0.0.0/8', '2001:db8::/48', '::1']) {
      expect(CIDR_OR_IP.test(v), v).toBe(true)
    }
    expect(sharedNatClause(['203.0.113.0/24', '198.51.100.7'])).toBe('(ip.src in {203.0.113.0/24 198.51.100.7})')
  })

  it('Should_Reject_When_GivenInvalidIpsOrPrefixes', () => {
    for (const v of ['256.0.0.1', '203.0.113.0/33', '1.2.3', 'not-an-ip', '10.0.0.0/99', '']) {
      expect(CIDR_OR_IP.test(v), v).toBe(false)
    }
    expect(() => sharedNatClause(['256.0.0.1'])).toThrow()
  })
})
