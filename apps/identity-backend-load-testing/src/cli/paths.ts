import { FileSystem, Path } from '@effect/platform'
import { PlatformError } from '@effect/platform/Error'
import { Effect } from 'effect'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

export const PACKAGE_ROOT = resolve(HERE, '..', '..')

export const DEFAULT_FILES = {
  registerPayloads: join(PACKAGE_ROOT, 'register-payloads.jsonl'),
  jwtTokens: join(PACKAGE_ROOT, 'jwt-tokens.json'),
} as const

export function readEnvPath(env: NodeJS.ProcessEnv, envVar: string, fallback: string): string {
  const value = env[envVar]
  if (value !== undefined && value.length > 0) return resolve(value)
  return fallback
}

export function ensureParentDir(filePath: string) {
  return Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const dir = path.dirname(filePath)
    const exists = yield* fs.exists(dir)
    if (!exists) yield* fs.makeDirectory(dir, { recursive: true })
  }) as Effect.Effect<void, PlatformError, FileSystem.FileSystem | Path.Path>
}
