#!/usr/bin/env bun
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import * as path from 'node:path'

const USAGE = [
  'usage: effect-ls <command> <file> [name]',
  '',
  '  layer <file> <name>   provides/requires + suggested composition for an EXPORTED layer',
  '  diagnose <file>       effect diagnostics for a file (works on non-exported bindings too)',
  '  overview <file>       every exported Effect service/layer in a file, with channels',
].join('\n')

const cliPath = createRequire(import.meta.url).resolve('@effect/language-service/cli.js')

const [, , command, fileArg, nameArg] = process.argv
if (!command || !fileArg) {
  console.error(USAGE)
  process.exit(2)
}
const file = path.resolve(fileArg)

const commands: Record<string, () => readonly string[] | undefined> = {
  layer: () => nameArg ? ['layerinfo', '--file', file, '--name', nameArg] : undefined,
  diagnose: () => ['diagnostics', '--file', file, '--format', 'pretty'],
  overview: () => ['overview', '--file', file],
}

const build = commands[command]
if (!build) {
  console.error(`unknown command '${command}'\n\n${USAGE}`)
  process.exit(2)
}
const cliArgs = build()
if (!cliArgs) {
  console.error(`'${command}' requires a layer name\n\n${USAGE}`)
  process.exit(2)
}

const result = spawnSync(process.execPath, [cliPath, ...cliArgs], { stdio: 'inherit' })
process.exit(result.status ?? 1)
