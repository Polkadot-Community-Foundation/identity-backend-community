#!/usr/bin/env bun
// Mutation testing report parser for StrykerJS
// Usage: cat reports/mutation-report.json | bun parse-mutation-report.ts [options]
//
// Options:
//   --format=env    Output as shell export statements (default)
//   --format=json   Output as JSON
//   --threshold=N   Override threshold (default: reads from report)

interface Mutant {
  id: string
  status: 'Killed' | 'Survived' | 'Timeout' | 'NoCoverage' | 'Ignored'
}

interface FileData {
  source: string
  mutants: Mutant[]
}

interface MutationReport {
  files: Record<string, FileData>
  thresholds?: {
    high?: number
    low?: number
    break?: number
  }
}

function parseArgs(args: string[]): { format: 'env' | 'json'; threshold?: number } {
  const result: { format: 'env' | 'json'; threshold?: number } = { format: 'env' }

  for (const arg of args) {
    if (arg.startsWith('--format=')) {
      const fmt = arg.split('=')[1]
      if (fmt === 'json' || fmt === 'env') {
        result.format = fmt
      }
    }
    if (arg.startsWith('--threshold=')) {
      result.threshold = parseInt(arg.split('=')[1], 10)
    }
  }

  return result
}

async function main() {
  const args = parseArgs(Bun.argv.slice(2))

  const chunks: Uint8Array[] = []
  for await (const chunk of Bun.stdin.stream()) {
    chunks.push(chunk)
  }
  const input = new TextDecoder().decode(Buffer.concat(chunks))

  let data: MutationReport
  try {
    data = JSON.parse(input)
  } catch {
    console.error('Error: Invalid JSON input')
    process.exit(1)
  }

  let killed = 0
  let survived = 0
  let timeout = 0
  let noCoverage = 0
  let ignored = 0

  for (const [_filePath, fileData] of Object.entries(data.files || {})) {
    for (const mutant of fileData.mutants || []) {
      switch (mutant.status) {
        case 'Killed':
          killed++
          break
        case 'Survived':
          survived++
          break
        case 'Timeout':
          timeout++
          break
        case 'NoCoverage':
          noCoverage++
          break
        case 'Ignored':
          ignored++
          break
      }
    }
  }

  const totalValid = killed + survived + timeout + noCoverage
  const detected = killed + timeout
  const score = totalValid > 0 ? ((detected / totalValid) * 100).toFixed(2) : '0.00'
  const threshold = args.threshold ?? data.thresholds?.break ?? 90
  const passed = parseFloat(score) >= threshold

  if (args.format === 'json') {
    console.log(JSON.stringify(
      {
        killed,
        survived,
        timeout,
        noCoverage,
        ignored,
        totalValid,
        score,
        threshold,
        passed,
      },
      null,
      2,
    ))
  } else {
    console.log(`KILLED=${killed}`)
    console.log(`SURVIVED=${survived}`)
    console.log(`TIMEOUT=${timeout}`)
    console.log(`NO_COVERAGE=${noCoverage}`)
    console.log(`IGNORED=${ignored}`)
    console.log(`TOTAL_VALID=${totalValid}`)
    console.log(`SCORE=${score}`)
    console.log(`THRESHOLD=${threshold}`)
    console.log(`PASSED=${passed}`)
  }
}

main().catch((e) => {
  console.error('Error:', e)
  process.exit(1)
})
