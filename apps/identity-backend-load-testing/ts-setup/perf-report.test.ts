import { describe, it } from '@effect/vitest'
import { Effect, FastCheck as fc } from 'effect'
import { expect } from 'vitest'
import { stepSummary } from './perf-issue.js'
import { type AnalyzeInput, analyzeRun, captureBaseline, type RunMeta } from './perf-report.js'

interface SummaryShape {
  metrics: Record<string, { values: Record<string, number> }>
}

interface Metrics {
  readonly errorRate: number
  readonly serverP95: number
  readonly checksRate?: number
  readonly correctnessCount?: number
  readonly endpointErrorRate?: number
  readonly endpointServerP95?: number
}

function summary(m: Metrics): SummaryShape {
  const metrics: Record<string, { values: Record<string, number> }> = {
    'http_req_failed': { values: { rate: m.errorRate } },
    'server_processing_time': { values: { 'p(95)': m.serverP95 } },
    'checks': { values: { rate: m.checksRate ?? 1 } },
    'correctness_failures': { values: { count: m.correctnessCount ?? 0 } },
  }
  if (m.endpointErrorRate !== undefined || m.endpointServerP95 !== undefined) {
    metrics['http_req_failed{endpoint:usernames_search}'] = { values: { rate: m.endpointErrorRate ?? m.errorRate } }
    metrics['server_processing_time{endpoint:usernames_search}'] = {
      values: { 'p(95)': m.endpointServerP95 ?? m.serverP95 },
    }
  }
  return { metrics }
}

function meta(baseUrl: string): RunMeta {
  return {
    runId: 'test-run',
    scenario: 'search',
    commit: 'abcdef0',
    branch: 'main',
    baseUrl,
    generatedAt: '2026-01-01T00:00:00.000Z',
    traceArchiveArtifact: null,
  }
}

function input(summaryValue: unknown, baseline: unknown = null, baseUrl = 'http://localhost:8080'): AnalyzeInput {
  return {
    summary: summaryValue,
    baseline,
    meta: meta(baseUrl),
    latencyRatio: 1.5,
    errorRateFloor: 0.05,
    checksFloor: 0.99,
  }
}

const FULL_SCAN_EXPLAIN = {
  verdict: 'full_scan',
  samples: [
    { prefix: 'zzq', fullScan: true, executionMs: 5071, rowsRemovedByFilter: 1000000 },
    { prefix: 'qqzx', fullScan: true, executionMs: 5009, rowsRemovedByFilter: 1000000 },
  ],
}

describe('analyzeRun', () => {
  it('Should_ReportInfraFailure_When_Regression1721b429Reproduced', () => {
    const rep = analyzeRun({
      ...input(
        summary({
          errorRate: 1,
          serverP95: 0,
          checksRate: 0,
          correctnessCount: 5696,
          endpointErrorRate: 1,
          endpointServerP95: 0,
        }),
        null,
        'unknown',
      ),
      explain: FULL_SCAN_EXPLAIN,
    })
    expect(rep.verdict).toBe('infra_failure')
    expect(rep.infraFailure?.signal).toBe('base_url_missing')
    expect(rep.regressions.filter((r) => r.kind === 'query_plan')).toHaveLength(2)
  })

  it('Should_ReportInfraFailureWithTargetUnreachable_When_AllRequestsFailAtZeroServerTime', () => {
    const rep = analyzeRun(
      input(summary({ errorRate: 1, serverP95: 0 }), null, 'http://localhost:8080'),
    )
    expect(rep.verdict).toBe('infra_failure')
    expect(rep.infraFailure?.signal).toBe('target_unreachable')
  })

  it('Should_ReclassifyToInfraFailure_When_RealConnectionStormRun63c687a9Reproduced', () => {
    const rep = analyzeRun(
      input(
        summary({
          errorRate: 1,
          serverP95: 0.6262605999999998,
          checksRate: 0,
          correctnessCount: 5697,
          endpointErrorRate: 1,
          endpointServerP95: 0.6262605999999998,
        }),
        null,
        'http://localhost:8080',
      ),
    )
    expect(rep.signature).toBe('63c687a9')
    expect(rep.verdict).toBe('infra_failure')
    expect(rep.infraFailure?.signal).toBe('target_unreachable')
  })

  it('Should_NotInfraFailureButRegressed_When_ServerP95AtFloorBoundary', () => {
    const rep = analyzeRun(
      input(summary({ errorRate: 1, serverP95: 1, endpointErrorRate: 1, endpointServerP95: 1 }), null),
    )
    expect(rep.infraFailure).toBeNull()
    expect(rep.verdict).toBe('regressed')
  })

  it('Should_NotInfraFailure_When_PartialErrorRateWithSubMillisecondServerTime', () => {
    const rep = analyzeRun(
      input(summary({ errorRate: 0.5, serverP95: 0.5, endpointErrorRate: 0.5, endpointServerP95: 0.5 }), null),
    )
    expect(rep.infraFailure).toBeNull()
  })

  it('Should_ReportInfraFailureWithSummaryAbsent_When_NoSummaryProduced', () => {
    const rep = analyzeRun(input(null, null, 'http://localhost:8080'))
    expect(rep.verdict).toBe('infra_failure')
    expect(rep.infraFailure?.signal).toBe('summary_absent')
  })

  it('Should_ReportLatencyRegression_When_EndpointP95ExceedsRatio', () => {
    const s = summary({
      errorRate: 0,
      serverP95: 5,
      endpointErrorRate: 0,
      endpointServerP95: 100,
      checksRate: 1,
      correctnessCount: 0,
    })
    const baseline = { 'server_processing_time{endpoint:usernames_search}': { 'p(95)': 10 } }
    const rep = analyzeRun(input(s, baseline))
    expect(rep.verdict).toBe('regressed')
    expect(rep.regressions.some((r) => r.kind === 'latency')).toBe(true)
  })

  it('Should_ReportRegressed_When_RealErrorRateWithHealthyServerTime', () => {
    const rep = analyzeRun(
      input(
        summary({ errorRate: 0.1, serverP95: 50, checksRate: 0.9, correctnessCount: 5 }),
        null,
        'http://localhost:8080',
      ),
    )
    expect(rep.verdict).toBe('regressed')
    expect(rep.infraFailure).toBeNull()
  })

  it('Should_ReportPass_When_CleanRunWithBaseline', () => {
    const s = summary({
      errorRate: 0,
      serverP95: 10,
      endpointErrorRate: 0,
      endpointServerP95: 10,
      checksRate: 1,
      correctnessCount: 0,
    })
    const baseline = {
      'server_processing_time{endpoint:usernames_search}': { 'p(95)': 10 },
      'http_req_failed{endpoint:usernames_search}': { rate: 0 },
    }
    expect(analyzeRun(input(s, baseline)).verdict).toBe('pass')
  })

  it('Should_ReportNoBaseline_When_CleanRunWithoutBaseline', () => {
    const s = summary({ errorRate: 0, serverP95: 10, checksRate: 1, correctnessCount: 0 })
    expect(analyzeRun(input(s, null)).verdict).toBe('no_baseline')
  })

  it('Should_RenderInfraFailureLine_When_StepSummaryCalled', () => {
    const rep = analyzeRun(input(summary({ errorRate: 1, serverP95: 0 }), null, 'unknown'))
    const text = stepSummary(rep)
    expect(text).toContain('INFRA FAILURE')
    expect(text).toContain('no regression issue opened')
  })
})

describe('captureBaseline', () => {
  it('Should_StoreMetricsUnderCanonicalKeys_When_Captured', () => {
    const captured = captureBaseline(
      summary({
        errorRate: 0.02,
        serverP95: 7,
        endpointErrorRate: 0.02,
        endpointServerP95: 7,
        checksRate: 1,
        correctnessCount: 3,
      }),
      0.05,
    )
    expect(captured).toMatchObject({
      ok: true,
      baseline: {
        'http_req_failed': { rate: 0.02 },
        'http_req_failed{endpoint:usernames_search}': { rate: 0.02 },
        'server_processing_time': { 'p(95)': 7 },
        'correctness_failures': { count: 3 },
      },
    })
  })

  it.effect.prop(
    '∀e_HighErrorRunCapture_=Refused',
    [fc.nat({ max: 940 }).map((n) => (n + 60) / 1000)],
    ([errorRate]) => Effect.succeed(!captureBaseline(summary({ errorRate, serverP95: 10 }), 0.05).ok),
    { fastCheck: { numRuns: 100 } },
  )

  it('Should_Refuse_When_ServerProcessingTimeIsZero', () => {
    const captured = captureBaseline(summary({ errorRate: 0, serverP95: 0 }), 0.05)
    expect(captured.ok).toBe(false)
  })

  it('Should_Refuse_When_ServerProcessingTimeIsSubMillisecond', () => {
    const captured = captureBaseline(summary({ errorRate: 0, serverP95: 0.6262605999999998 }), 0.05)
    expect(captured.ok).toBe(false)
  })

  it('Should_Capture_When_ServerProcessingTimeAtFloorBoundary', () => {
    const captured = captureBaseline(summary({ errorRate: 0, serverP95: 1 }), 0.05)
    expect(captured.ok).toBe(true)
  })

  it('Should_Capture_When_ErrorRateEqualsFloorExactly', () => {
    expect(captureBaseline(summary({ errorRate: 0.05, serverP95: 10 }), 0.05).ok).toBe(true)
  })
})
