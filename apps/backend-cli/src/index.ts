#!/usr/bin/env bun

import { Args, Command, Options } from '@effect/cli'
import { BunContext, BunRuntime } from '@effect/platform-bun'
import { Console, Effect, Option } from 'effect'

function isUnsafeVitestCommand(cmd: string, args: string[]): boolean {
  const isVitest = cmd === 'vitest' || cmd === 'pnpm' || cmd.endsWith('/vitest')

  if (!isVitest) {
    return false
  }

  if (cmd === 'pnpm' && args.length > 0 && args[0] === 'vitest') {
    return !args.slice(1).some((arg) => arg === 'run' || arg === '--run')
  }

  return !args.some((arg) => arg === 'run' || arg === '--run')
}

function isMutationCommand(cmd: string, args: string[]): boolean {
  const fullCommand = [cmd, ...args].join(' ').toLowerCase()
  return (
    fullCommand.includes('stryker') ||
    fullCommand.includes('mutation') ||
    cmd.toLowerCase().includes('stryker')
  )
}

function isFullMutationCommand(cmd: string, args: string[]): boolean {
  const fullCommand = [cmd, ...args].join(' ').toLowerCase()
  return (
    fullCommand.includes('stryker') &&
    !fullCommand.includes('--mutate')
  )
}

function hasRequiredMutationFlags(args: string[]): boolean {
  return args.some((arg) => arg.includes('--mutate'))
}

const blockCommand = Effect.gen(function*() {
  yield* Console.error('🚨 FORBIDDEN: Non-interactive environments require CI=true (auto-set, not manual)')
  return yield* Effect.sync(() => process.exit(1))
})

const blockMutationCommand = Effect.gen(function*() {
  yield* Console.error(`
⚠️  STRYKER: --mutate <pattern> REQUIRED

Add target file(s) to avoid full mutation suite.
Example: --mutate src/rules/no-console.ts
`)
  return yield* Effect.sync(() => process.exit(1))
})

const blockWatchMode = (fullCommand: string) =>
  Effect.gen(function*() {
    yield* Console.error(`
🚨 *** SYSTEM INTERVENTION ***
STATUS: CRITICAL
ACTION: ❌ WATCH MODE BLOCKED

The command "${fullCommand}" would start Vitest in WATCH MODE.
Watch mode is FORBIDDEN in non-interactive environments.

REQUIRED ACTION:
You MUST use "vitest run" for one-time test execution.

FORBIDDEN:
- Running vitest without "run" subcommand in AI agent contexts
- Exporting CI=true manually to bypass safeguards

EXAMPLES:
  backend run pnpm vitest run --project=unit
  vitest run --project=unit

Remember: CI=true is for real CI systems ONLY and is set automatically.
*** END INTERVENTION ***
`)
    return yield* Effect.sync(() => process.exit(1))
  })

function checkGuardConditions(cmd: string, args: string[]): Effect.Effect<void, Error> {
  const isTTY = process.stdout.isTTY === true
  const isCI = Bun.env.CI === 'true'

  if (!isTTY && !isCI) {
    if (isUnsafeVitestCommand(cmd, args)) {
      const fullCommand = [cmd, ...args].join(' ')
      return blockWatchMode(fullCommand)
    }

    if (isMutationCommand(cmd, args)) {
      if (isFullMutationCommand(cmd, args) || !hasRequiredMutationFlags(args)) {
        return blockMutationCommand
      }
    }

    return blockCommand
  }

  return Effect.void
}

function spawnCommand(
  command: string,
  args: string[],
  options: { useXvfb?: boolean; env?: Record<string, string | undefined> } = {},
): Effect.Effect<number, Error> {
  return Effect.gen(function*() {
    const cmd = options.useXvfb ? 'xvfb-run' : command
    const finalArgs = options.useXvfb ? ['-a', command, ...args] : args

    const proc = options.useXvfb
      ? Bun.spawn([cmd, ...finalArgs], {
        stdio: ['inherit', 'pipe', 'pipe'] as ['inherit', 'pipe', 'pipe'],
        env: options.env,
      })
      : Bun.spawn([cmd, ...finalArgs], {
        stdio: ['inherit', 'inherit', 'inherit'] as ['inherit', 'inherit', 'inherit'],
        env: options.env,
      })

    if (options.useXvfb && proc.stderr) {
      const reader = proc.stderr.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const { done, value } = yield* Effect.promise(() => reader.read())
        if (done) break
        const text = decoder.decode(value)
        const lines = text.split('\n')
        for (const line of lines) {
          if (!line.includes('[ERROR] The build was canceled')) {
            if (line.trim()) {
              yield* Effect.promise(() => Bun.write(Bun.stderr, line + '\n'))
            }
          }
        }
      }
    }

    if (options.useXvfb && proc.stdout) {
      const reader = proc.stdout.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const { done, value } = yield* Effect.promise(() => reader.read())
        if (done) break
        const text = decoder.decode(value)
        yield* Effect.promise(() => Bun.write(Bun.stdout, text))
      }
    }

    const exitCode = yield* Effect.promise(() => proc.exited)
    return exitCode
  })
}

const passthroughArgs = Args.text({ name: 'args' }).pipe(Args.repeated)

const cmdOption = Options.text('cmd').pipe(Options.optional)
const guardOption = Options.boolean('guard', { ifPresent: true }).pipe(Options.withDefault(false))
const xvfbOption = Options.boolean('xvfb', { ifPresent: true }).pipe(Options.withDefault(false))
const strykerOption = Options.boolean('stryker', { ifPresent: true }).pipe(Options.withDefault(false))

const runCmd = Command.make(
  'run',
  {
    cmd: cmdOption,
    guard: guardOption,
    xvfb: xvfbOption,
    stryker: strykerOption,
    args: passthroughArgs,
  },
  ({ cmd, guard, xvfb, stryker, args }) =>
    Effect.gen(function*() {
      const isTTY = process.stdout.isTTY === true
      const isCI = Bun.env.CI === 'true'
      const isProduction = Bun.env.NODE_ENV === 'production'

      const cmdString = Option.getOrElse(cmd, () => args.length > 0 ? args.join(' ') : 'npx playwright test')
      const parts = cmdString.split(' ')
      const command = parts[0]!
      const baseArgsFromCmd = parts.slice(1)
      const baseArgs = Option.isSome(cmd) ? [...baseArgsFromCmd, ...args] : baseArgsFromCmd

      if (guard) {
        yield* checkGuardConditions(command, baseArgs)
      }

      if (stryker && !hasRequiredMutationFlags(baseArgs) && !isCI) {
        yield* blockMutationCommand
      }

      const env: Record<string, string | undefined> = { ...Bun.env }
      if (!isTTY || isCI || isProduction) {
        env.FORCE_COLOR = '0'
        env.NO_COLOR = '1'
      }

      const exitCode = yield* spawnCommand(command, baseArgs, {
        useXvfb: xvfb,
        env,
      })

      if (exitCode !== 0) {
        return yield* Effect.fail(new Error(`Command exited with code ${exitCode}`))
      }
    }),
)

const command = Command.make('backend', {}, () => Console.log('Use "backend run --help" for usage information')).pipe(
  Command.withSubcommands([runCmd]),
)

const cli = Command.run(command, {
  name: 'backend',
  version: '0.1.0',
})

cli(process.argv).pipe(
  Effect.provide(BunContext.layer),
  BunRuntime.runMain,
)
