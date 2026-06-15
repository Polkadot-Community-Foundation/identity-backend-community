#!/usr/bin/env bun
export interface RunMeta {
  runId: string
  scenario: string
  commit: string
  branch: string
  baseUrl: string
  generatedAt: string
  traceArchiveArtifact: string | null
}

export type RegressionKind = 'latency' | 'error_rate' | 'correctness' | 'checks' | 'query_plan'

export interface Regression {
  kind: RegressionKind
  metric: string
  endpoint: string | null
  baseline: number | null
  observed: number
  ratio: number | null
  threshold: number
  detail: string
}

export type Verdict = 'pass' | 'regressed' | 'no_baseline' | 'infra_failure'

export type InfraFailureSignal = 'summary_absent' | 'base_url_missing' | 'target_unreachable'

export interface InfraFailureReason {
  readonly signal: InfraFailureSignal
  readonly detail: string
}

export type BaselineCapture =
  | Readonly<{ ok: true; baseline: Record<string, Record<string, number>> }>
  | Readonly<{ ok: false; reason: string }>

export interface PerfReport {
  schemaVersion: string
  run: RunMeta
  verdict: Verdict
  infraFailure: InfraFailureReason | null
  signature: string
  regressions: Regression[]
  observed: Record<string, number>
  repro: { command: string; liveTarget: string }
  evidence: { traceArchiveArtifact: string | null; traceFilter: string }
  explain: unknown
}

export interface AnalyzeInput {
  summary: unknown
  baseline: unknown
  meta: RunMeta
  latencyRatio: number
  errorRateFloor: number
  checksFloor: number
  explain?: unknown
}

const SCHEMA_VERSION = '1.0.0'
const LATENCY_METRIC = 'server_processing_time'
const ERROR_METRIC = 'http_req_failed'
const CORRECTNESS_METRIC = 'correctness_failures'
const CHECKS_METRIC = 'checks'
const ENDPOINT_TAG = /[{,]endpoint:([^,}]+)[,}]/
const UNREACHABLE_SERVER_P95_FLOOR_MS = 1

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function metricKeys(summary: unknown): string[] {
  if (!isRecord(summary)) return []
  const metrics = summary['metrics']
  return isRecord(metrics) ? Object.keys(metrics) : []
}

function stat(summary: unknown, metricKey: string, names: readonly string[]): number | null {
  if (!isRecord(summary)) return null
  const metrics = summary['metrics']
  if (!isRecord(metrics)) return null
  const metric = metrics[metricKey]
  if (!isRecord(metric)) return null
  const container = isRecord(metric['values']) ? metric['values'] : metric
  for (const name of names) {
    const value = finiteNumber(container[name])
    if (value !== null) return value
  }
  return null
}

const P95 = ['p(95)'] as const
const RATE = ['value', 'rate'] as const
const COUNT = ['count'] as const

function baselineStat(baseline: unknown, metricKey: string, name: string): number | null {
  if (!isRecord(baseline)) return null
  const entry = baseline[metricKey]
  if (!isRecord(entry)) return null
  return finiteNumber(entry[name])
}

export function endpointOf(metricKey: string): string | null {
  const match = ENDPOINT_TAG.exec(metricKey)
  return match ? match[1]! : null
}

export function fnv1a(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function latencyRegressions(input: AnalyzeInput): Regression[] {
  return metricKeys(input.summary)
    .filter((key) => key.startsWith(`${LATENCY_METRIC}{`))
    .flatMap((key) => {
      const observed = stat(input.summary, key, P95)
      const baseline = baselineStat(input.baseline, key, 'p(95)')
      const breached = observed !== null && baseline !== null && observed > baseline * input.latencyRatio
      return breached
        ? [{
          kind: 'latency' as const,
          metric: `${LATENCY_METRIC}_p95`,
          endpoint: endpointOf(key),
          baseline,
          observed,
          ratio: Number((observed / baseline).toFixed(3)),
          threshold: input.latencyRatio,
          detail: `p95 ${observed.toFixed(1)}ms exceeds ${input.latencyRatio}x baseline ${baseline.toFixed(1)}ms`,
        }]
        : []
    })
}

function errorRateRegressions(input: AnalyzeInput): Regression[] {
  return metricKeys(input.summary)
    .filter((key) => key.startsWith(`${ERROR_METRIC}{`))
    .flatMap((key) => {
      const observed = stat(input.summary, key, RATE)
      const baseline = baselineStat(input.baseline, key, 'rate')
      const threshold = Math.max((baseline ?? 0) * 2, input.errorRateFloor)
      const breached = observed !== null && observed > threshold
      return breached
        ? [{
          kind: 'error_rate' as const,
          metric: ERROR_METRIC,
          endpoint: endpointOf(key),
          baseline,
          observed,
          ratio: baseline && baseline > 0 ? Number((observed / baseline).toFixed(3)) : null,
          threshold,
          detail: `error rate ${(observed * 100).toFixed(2)}% exceeds threshold ${(threshold * 100).toFixed(2)}%`,
        }]
        : []
    })
}

function correctnessRegressions(input: AnalyzeInput): Regression[] {
  const observed = stat(input.summary, CORRECTNESS_METRIC, COUNT)
  return observed !== null && observed > 0
    ? [{
      kind: 'correctness' as const,
      metric: CORRECTNESS_METRIC,
      endpoint: null,
      baseline: 0,
      observed,
      ratio: null,
      threshold: 0,
      detail: `${observed} correctness failure(s): responses were served but semantically wrong`,
    }]
    : []
}

function checksRegressions(input: AnalyzeInput): Regression[] {
  const observed = stat(input.summary, CHECKS_METRIC, RATE)
  return observed !== null && observed < input.checksFloor
    ? [{
      kind: 'checks' as const,
      metric: CHECKS_METRIC,
      endpoint: null,
      baseline: input.checksFloor,
      observed,
      ratio: null,
      threshold: input.checksFloor,
      detail: `check pass rate ${(observed * 100).toFixed(2)}% below floor ${(input.checksFloor * 100).toFixed(2)}%`,
    }]
    : []
}

type StatNames = typeof P95 | typeof RATE | typeof COUNT

function statNameFor(key: string): StatNames | null {
  return key.startsWith(LATENCY_METRIC)
    ? P95
    : key.startsWith(ERROR_METRIC)
    ? RATE
    : key === CHECKS_METRIC
    ? RATE
    : key === CORRECTNESS_METRIC
    ? COUNT
    : null
}

function baselineNameFor(key: string): string | null {
  return key.startsWith(LATENCY_METRIC)
    ? 'p(95)'
    : key.startsWith(ERROR_METRIC)
    ? 'rate'
    : key === CHECKS_METRIC
    ? 'rate'
    : key === CORRECTNESS_METRIC
    ? 'count'
    : null
}

function observedSnapshot(summary: unknown): Record<string, number> {
  const snapshot: Record<string, number> = {}
  for (const key of metricKeys(summary)) {
    const names = statNameFor(key)
    if (names === null) continue
    const value = stat(summary, key, names)
    if (value !== null) snapshot[`${key}.${names[0]}`] = value
  }
  return snapshot
}

export function signatureOf(regressions: Regression[]): string {
  const fingerprint = regressions
    .map((r) => `${r.kind}:${r.metric}:${r.endpoint ?? '-'}`)
    .sort()
    .join('|')
  return fnv1a(fingerprint)
}

function explainRegressions(explain: unknown): Regression[] {
  if (!isRecord(explain) || explain['verdict'] !== 'full_scan') return []
  const samples = explain['samples']
  if (!Array.isArray(samples)) return []
  return samples.filter(isRecord).filter((s) => s['fullScan'] === true).map((s) => {
    const observed = finiteNumber(s['executionMs']) ?? 0
    const removed = finiteNumber(s['rowsRemovedByFilter']) ?? 0
    return {
      kind: 'query_plan' as const,
      metric: 'query_plan_full_scan',
      endpoint: 'usernames_search',
      baseline: null,
      observed,
      ratio: null,
      threshold: 0,
      detail: `prefix "${String(s['prefix'])}%" triggers a full scan — ${removed} rows filtered in ${
        observed.toFixed(0)
      }ms`,
    }
  })
}

function detectInfraFailure(input: AnalyzeInput): InfraFailureReason | null {
  if (!isRecord(input.summary) || !isRecord(input.summary['metrics'])) {
    return {
      signal: 'summary_absent' as const,
      detail: 'k6 produced no summary — load test was skipped, did not execute, or the summary is unreadable',
    }
  }
  const baseUrl = input.meta.baseUrl.trim()
  if (baseUrl === '' || baseUrl === 'unknown') {
    return {
      signal: 'base_url_missing' as const,
      detail:
        'analyze step received no base URL — the k6 summary cannot be attributed to a known target, so HTTP-derived regressions are not trustworthy',
    }
  }
  const errorRate = stat(input.summary, ERROR_METRIC, RATE)
  const serverP95 = stat(input.summary, LATENCY_METRIC, P95)
  if (errorRate !== null && errorRate >= 1 && serverP95 !== null && serverP95 < UNREACHABLE_SERVER_P95_FLOOR_MS) {
    return {
      signal: 'target_unreachable' as const,
      detail:
        '100% request failure with sub-millisecond p95 server processing time — responses were not produced; k6 records ~0ms wait time for reset/EOF connections (connection-level failure)',
    }
  }
  return null
}

export function captureBaseline(summary: unknown, errorFloor: number): BaselineCapture {
  const errorRate = stat(summary, ERROR_METRIC, RATE)
  if (errorRate !== null && errorRate > errorFloor) {
    return {
      ok: false as const,
      reason: `http_req_failed rate ${(errorRate * 100).toFixed(2)}% exceeds ${
        (errorFloor * 100).toFixed(0)
      }% capture floor`,
    }
  }
  const serverP95 = stat(summary, LATENCY_METRIC, P95)
  if (serverP95 !== null && serverP95 < UNREACHABLE_SERVER_P95_FLOOR_MS) {
    return {
      ok: false as const,
      reason:
        'server_processing_time p(95) is sub-millisecond — run looks infra-broken (reset/EOF connections record ~0ms wait), refusing to capture as baseline',
    }
  }
  const baseline: Record<string, Record<string, number>> = {}
  for (const key of metricKeys(summary)) {
    const name = baselineNameFor(key)
    const names = statNameFor(key)
    if (name === null || names === null) continue
    const value = stat(summary, key, names)
    if (value !== null) {
      const entry = baseline[key] ?? (baseline[key] = {})
      entry[name] = value
    }
  }
  if (Object.keys(baseline).length === 0) {
    return { ok: false as const, reason: 'summary yielded no capturable metrics — refusing to write an empty baseline' }
  }
  return { ok: true as const, baseline }
}

export function analyzeRun(input: AnalyzeInput): PerfReport {
  const infraFailure = detectInfraFailure(input)
  const regressions = [
    ...latencyRegressions(input),
    ...errorRateRegressions(input),
    ...correctnessRegressions(input),
    ...checksRegressions(input),
    ...explainRegressions(input.explain),
  ]

  const hasBaseline = isRecord(input.baseline) && Object.keys(input.baseline).length > 0
  const verdict: Verdict = infraFailure !== null
    ? 'infra_failure'
    : regressions.length > 0
    ? 'regressed'
    : hasBaseline
    ? 'pass'
    : 'no_baseline'

  return {
    schemaVersion: SCHEMA_VERSION,
    run: input.meta,
    verdict,
    infraFailure,
    signature: signatureOf(regressions),
    regressions,
    observed: observedSnapshot(input.summary),
    repro: {
      command: `bash scripts/load-test-local.sh ${input.meta.scenario}`,
      liveTarget: `bash scripts/load-test-local.sh ${input.meta.scenario} --target-url <url>`,
    },
    evidence: {
      traceArchiveArtifact: input.meta.traceArchiveArtifact,
      traceFilter: `http.user_agent="k6-loadtest/${input.meta.runId} (scenario:${input.meta.scenario})"`,
    },
    explain: input.explain ?? null,
  }
}
