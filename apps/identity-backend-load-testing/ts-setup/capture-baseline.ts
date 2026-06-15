#!/usr/bin/env bun
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { parseArgs } from 'node:util'
import { captureBaseline } from './perf-report.js'

const { values } = parseArgs({
  options: {
    summary: { type: 'string' },
    out: { type: 'string' },
    'error-floor': { type: 'string', default: '0.05' },
  },
})

if (!values.summary) {
  console.error('--summary <k6 summary.json> is required')
  process.exit(2)
}
if (!values.out) {
  console.error('--out <baseline.json> is required')
  process.exit(2)
}
if (!existsSync(values.summary)) {
  console.error(`summary not found: ${values.summary}`)
  process.exit(2)
}

const summary: unknown = JSON.parse(readFileSync(values.summary, 'utf8'))
const result = captureBaseline(summary, Number(values['error-floor']))

if (!result.ok) {
  console.error(`refusing to capture baseline: ${result.reason}`)
  process.exit(1)
}

const dir = dirname(values.out)
if (dir && dir !== '.' && !existsSync(dir)) {
  mkdirSync(dir, { recursive: true })
}

writeFileSync(values.out, `${JSON.stringify(result.baseline, null, 2)}\n`)
console.log(`captured baseline (${Object.keys(result.baseline).length} metrics) -> ${values.out}`)
