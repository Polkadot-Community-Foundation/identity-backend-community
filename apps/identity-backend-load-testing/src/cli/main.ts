#!/usr/bin/env bun
import { Command } from '@effect/cli'
import { FetchHttpClient } from '@effect/platform'
import { BunContext, BunRuntime } from '@effect/platform-bun'
import { Effect } from 'effect'
import { loadgen } from './loadgen.js'

const cli = Command.run(loadgen, {
  name: 'loadgen',
  version: '0.0.0',
})

// pnpm 10's `--` arg-forwarding appends the forwarded tokens to the inner
// `bun run` script body. Strip the trailing `--` (and anything after it) so
// `pnpm --filter ... loadgen:jwt-tokens -- "URL"` doesn't leak the URL as an
// unknown positional to @effect/cli.
const argv = (() => {
  const sep = process.argv.indexOf('--')
  return sep === -1 ? process.argv : process.argv.slice(0, sep)
})()

cli(argv).pipe(
  Effect.provide(BunContext.layer),
  Effect.provide(FetchHttpClient.layer),
  BunRuntime.runMain,
)
