import { fail } from 'k6'
import { solverMatchesServerVectors } from './proof-of-compute'
import { RUN_ID } from './trace-context'

export interface RunContext {
  runId: string
  baseUrl: string
  pocVerified: boolean
}

export function startRun(baseUrl: string, requirePoc: boolean): RunContext {
  if (requirePoc && !solverMatchesServerVectors()) {
    fail('proof-of-compute solver does not match server frozen vectors — aborting to avoid generating invalid load')
  }

  return { runId: RUN_ID, baseUrl, pocVerified: requirePoc }
}

export function endRun(ctx: RunContext, scenario: string): void {
  console.log('──────────────────────────────────────────────────────────────')
  console.log(`  load-test run complete — scenario=${scenario} run_id=${ctx.runId}`)
  console.log(`  target=${ctx.baseUrl} poc_solver_verified=${ctx.pocVerified}`)
  console.log(`  trace correlation: filter spans by http.user_agent="k6-loadtest/${ctx.runId} (scenario:${scenario})"`)
  console.log('  every request carried a sampled W3C traceparent — open any slow/errored')
  console.log('  request in the trace backend to see the full server-side span tree.')
  console.log('──────────────────────────────────────────────────────────────')
}
