#!/usr/bin/env bun
import type { PerfReport, Regression } from './perf-report.js'

function headline(regression: Regression): string {
  const where = regression.endpoint ? ` on ${regression.endpoint}` : ''
  return `${regression.metric}${where}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function explainSection(explain: unknown): string {
  if (!isRecord(explain) || !Array.isArray(explain['samples'])) return ''
  const rows = explain['samples'].filter(isRecord).map((s) =>
    `| ${String(s['prefix'])}% | ${s['fullScan'] ? '🔴 full scan' : 'fast'} | ${
      typeof s['executionMs'] === 'number' ? `${s['executionMs'].toFixed(0)}ms` : '—'
    } | ${typeof s['rowsRemovedByFilter'] === 'number' ? s['rowsRemovedByFilter'] : '—'} |`
  ).join('\n')
  return `\n## Query plan (EXPLAIN ANALYZE, verdict: ${String(explain['verdict'])})

| prefix | plan | exec time | rows removed by filter |
| --- | --- | --- | --- |
${rows}

Full \`EXPLAIN (ANALYZE, BUFFERS)\` output is attached as the \`explain-search\` artifact. A full scan on a sparse/no-match prefix means the query walks the whole table applying the filter — the fix is a supporting index for the case-insensitive prefix predicate.
`
}

export function issueTitle(report: PerfReport): string {
  const lead = report.regressions[0]
  const subject = lead ? headline(lead) : 'performance'
  const title = `perf: ${subject} regressed in ${report.run.scenario} (${report.run.commit.slice(0, 7)})`
  return title.length > 72 ? title.slice(0, 72) : title
}

export function issueLabels(): readonly string[] {
  return ['perf-regression', 'P3']
}

export function issueBody(report: PerfReport): string {
  const machineBlock = JSON.stringify(
    {
      schemaVersion: report.schemaVersion,
      signature: report.signature,
      run: report.run,
      verdict: report.verdict,
      regressions: report.regressions,
      observed: report.observed,
    },
    null,
    2,
  )

  const regressionLines = report.regressions
    .map((r) => `- **${headline(r)}** — ${r.detail}`)
    .join('\n')

  const traceLine = report.evidence.traceArchiveArtifact
    ? `Download artifact \`${report.evidence.traceArchiveArtifact}\`, then filter spans by \`${report.evidence.traceFilter}\` and open the slowest trace.`
    : `Tracing was not captured for this run; re-run with the trace-capture profile to attach the server span tree.`

  return `## Summary

A load-test run regressed against baseline. This issue is machine-generated and agent-actionable.

${regressionLines}

## Machine-readable report (parse with jq)

\`\`\`json
${machineBlock}
\`\`\`

## Reproduce locally

\`\`\`bash
${report.repro.command}
\`\`\`

Against a deployed target:

\`\`\`bash
${report.repro.liveTarget}
\`\`\`

## Trace evidence

${traceLine}
${explainSection(report.explain)}
## Acceptance criteria (close only when all hold)

- A re-run of \`${report.run.scenario}\` clears every regression listed above (signature \`${report.signature}\`).
- \`correctness_failures\` is 0 and the \`checks\` pass rate stays above the floor.
- The fixing PR comments the root cause with the span/query that grew, and links the green \`perf-summary.json\`.

## Agent playbook

1. Reproduce with the command above (drives the real stack via \`scripts/load-test-local.sh\`).
2. Open the slowest trace from the archive to locate the span that grew.
3. Ship the minimal fix and open a PR referencing this issue.
`
}

export function stepSummary(report: PerfReport): string {
  const verdictLine = report.verdict === 'regressed'
    ? `🔴 REGRESSED — ${report.regressions.length} regression(s), signature \`${report.signature}\``
    : report.verdict === 'infra_failure'
    ? `⛔ INFRA FAILURE — ${
      report.infraFailure?.detail ?? 'run did not validly exercise the target'
    }; no regression issue opened`
    : report.verdict === 'pass'
    ? '🟢 PASS — within baseline'
    : '🟡 NO BASELINE — recorded observed metrics only'

  const rows = report.regressions
    .map((r) =>
      `| ${r.kind} | ${headline(r)} | ${r.baseline ?? '—'} | ${r.observed} | ${r.ratio ?? '—'} | ${r.threshold} |`
    )
    .join('\n')

  const table = report.regressions.length > 0
    ? `\n\n| kind | metric | baseline | observed | ratio | threshold |\n| --- | --- | --- | --- | --- | --- |\n${rows}`
    : ''

  return `## k6 perf report — ${report.run.scenario} (run ${report.run.runId})\n\n${verdictLine}${table}`
}
