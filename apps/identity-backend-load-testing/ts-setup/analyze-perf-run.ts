#!/usr/bin/env bun
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { parseArgs } from 'node:util'
import { issueBody, issueLabels, issueTitle, stepSummary } from './perf-issue.js'
import { analyzeRun, type RunMeta } from './perf-report.js'

const { values } = parseArgs({
  options: {
    summary: { type: 'string' },
    baseline: { type: 'string' },
    explain: { type: 'string' },
    scenario: { type: 'string', default: 'search' },
    out: { type: 'string', default: 'perf-summary.json' },
    'issue-out': { type: 'string', default: 'perf-issue.md' },
    'commit': { type: 'string' },
    'branch': { type: 'string' },
    'base-url': { type: 'string' },
    'run-id': { type: 'string' },
    'trace-archive': { type: 'string' },
    'latency-ratio': { type: 'string', default: '1.5' },
    'error-floor': { type: 'string', default: '0.05' },
    'checks-floor': { type: 'string', default: '0.99' },
  },
})

function readJson(path: string | undefined): unknown {
  if (!path || !existsSync(path)) return null
  return JSON.parse(readFileSync(path, 'utf8'))
}

function append(envVar: string, content: string): void {
  const target = process.env[envVar]
  if (target) writeFileSync(target, `${content}\n`, { flag: 'a' })
}

if (!values.summary) {
  console.error('--summary <k6 summary.json> is required')
  process.exit(2)
}

const meta: RunMeta = {
  runId: values['run-id'] ?? process.env.LOADTEST_RUN_ID ?? 'local',
  scenario: values.scenario ?? 'search',
  commit: values.commit ?? process.env.GITHUB_SHA ?? 'unknown',
  branch: values.branch ?? process.env.GITHUB_REF_NAME ?? 'unknown',
  baseUrl: values['base-url'] ?? process.env.BASE_URL ?? 'unknown',
  generatedAt: new Date().toISOString(),
  traceArchiveArtifact: values['trace-archive'] ?? null,
}

const report = analyzeRun({
  summary: readJson(values.summary),
  baseline: readJson(values.baseline),
  explain: readJson(values.explain),
  meta,
  latencyRatio: Number(values['latency-ratio']),
  errorRateFloor: Number(values['error-floor']),
  checksFloor: Number(values['checks-floor']),
})

function ensureParentDir(filePath: string): void {
  const dir = dirname(filePath)
  if (dir && dir !== '.' && !existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

ensureParentDir(values.out!)
writeFileSync(values.out!, `${JSON.stringify(report, null, 2)}\n`)
console.log(`wrote ${values.out} — verdict=${report.verdict} signature=${report.signature}`)

const summaryText = stepSummary(report)
console.log(`\n${summaryText}\n`)
append('GITHUB_STEP_SUMMARY', summaryText)
append('GITHUB_OUTPUT', `verdict=${report.verdict}`)
append('GITHUB_OUTPUT', `signature=${report.signature}`)
append('GITHUB_OUTPUT', `regressed=${report.verdict === 'regressed'}`)

if (report.verdict === 'regressed') {
  ensureParentDir(values['issue-out']!)
  writeFileSync(values['issue-out']!, issueBody(report))
  const labelFlags = issueLabels().map((l) => `--label ${l}`).join(' ')
  console.log(`\nregression detected — file the issue (dedupe on signature ${report.signature} first):`)
  console.log(`  gh-issue-sync list --label perf-regression --search ${report.signature} || \\`)
  console.log(
    `  gh-issue-sync new ${JSON.stringify(issueTitle(report))} ${labelFlags}  # then write ${
      values['issue-out']
    } into the created file and 'gh-issue-sync push'`,
  )
}
