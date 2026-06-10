import { Config, Effect, Layer, Logger, LogLevel, Match, Option, pipe } from 'effect'

const LogLevelLiterals = Config.literal(
  'All',
  'ALL',
  'Fatal',
  'FATAL',
  'Error',
  'ERROR',
  'Warning',
  'WARNING',
  'WARN',
  'Info',
  'INFO',
  'Debug',
  'DEBUG',
  'Trace',
  'TRACE',
  'None',
  'NONE',
)

export const layerLogger = Layer.unwrapEffect(Effect.gen(function*() {
  const logLevel = yield* pipe(
    Config.option(LogLevelLiterals('LOG_LEVEL')),
    Effect.map(Option.map((l) =>
      Match.value(l).pipe(
        Match.whenOr('All', 'ALL', () => 'All' as const),
        Match.whenOr('Fatal', 'FATAL', () => 'Fatal' as const),
        Match.whenOr('Error', 'ERROR', () => 'Error' as const),
        Match.whenOr('Warning', 'WARNING', 'WARN', () => 'Warning' as const),
        Match.whenOr('Info', 'INFO', () => 'Info' as const),
        Match.whenOr('Debug', 'DEBUG', () => 'Debug' as const),
        Match.whenOr('Trace', 'TRACE', () => 'Trace' as const),
        Match.whenOr('None', 'NONE', () => 'None' as const),
        Match.exhaustive,
        LogLevel.fromLiteral,
      )
    )),
    Effect.map(Option.getOrElse(() => LogLevel.Debug)),
    Effect.orDie,
  )

  return Layer.mergeAll(
    Logger.minimumLogLevel(logLevel),
    Layer.suspend(() => {
      if (Bun.env.CI) {
        return Logger.logFmt
      } else if (Bun.env.NODE_ENV === 'production') {
        return Logger.json
      } else {
        return Layer.empty
      }
    }),
  )
}))
