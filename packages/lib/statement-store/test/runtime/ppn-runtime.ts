import { Context, Effect, Layer } from 'effect'
import { grantStatementAllowance, PEOPLE_WS_PORT, startPpnContainer } from './ppn-container.js'

export interface PpnRuntimeValue {
  readonly wsUrl: string
  readonly scenarioSalt: string
}

export class PpnRuntime extends Context.Tag('@identity-backend/statement-store/PpnRuntime')<
  PpnRuntime,
  PpnRuntimeValue
>() {}

export const hasPpnRuntimeEnv = (): boolean =>
  Boolean(
    process.env['PPN_WS_URL'] ?? process.env['GITHUB_TOKEN'] ?? process.env['GH_TOKEN'],
  )

export const PpnRuntimeLayer = Layer.orDie(
  Layer.scoped(
    PpnRuntime,
    Effect.gen(function*() {
      const scenarioSalt = `${Date.now()}_${Math.random().toString(36).slice(2)}_${process.pid}`
      const externalWs = process.env['PPN_WS_URL']

      if (externalWs !== undefined && externalWs.length > 0) {
        return { wsUrl: externalWs, scenarioSalt }
      }

      const container = yield* Effect.acquireRelease(
        Effect.promise(() => startPpnContainer()),
        (c) => Effect.promise(() => c.stop().catch(() => undefined)),
      )

      const wsUrl = `ws://127.0.0.1:${container.getMappedPort(PEOPLE_WS_PORT)}`
      yield* grantStatementAllowance(wsUrl)
      return { wsUrl, scenarioSalt }
    }),
  ),
)
