import { FileSystem, Path } from '@effect/platform'
import { PlatformError } from '@effect/platform/Error'
import { verifierAddressFromPublicKeyHex } from '@identity-backend/people-lite-fixtures'
import { Console, Effect } from 'effect'
import { DEFAULT_FILES, ensureParentDir, readEnvPath } from './paths.js'
import { generateRegisterPayloads } from './worker-coordinator.js'

export interface RegisterPayloadsArgs {
  readonly count: number
  readonly chunkSize: number
  readonly workers: number
  readonly out: string
  readonly attesterPublicKey: string
  readonly verifierAddress: string
}

const TESTNET_ATTESTER_PUBLIC_KEY = '86aac84d0032db1bca8819a89cdd675c1a304f7e40013039a14afdda7ba9607d'

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function makeRegisterPayloadsHandler(
  args: RegisterPayloadsArgs,
): Effect.Effect<void, PlatformError, FileSystem.FileSystem | Path.Path> {
  return Effect.gen(function*() {
    const count = clamp(args.count, 1, 1_000_000)
    const chunkSize = clamp(args.chunkSize, 100, 20_000)
    const verifierAddress = args.verifierAddress.length > 0
      ? args.verifierAddress
      : verifierAddressFromPublicKeyHex(args.attesterPublicKey || TESTNET_ATTESTER_PUBLIC_KEY)
    const outPath = readEnvPath(process.env, 'REGISTER_PAYLOADS', args.out || DEFAULT_FILES.registerPayloads)

    yield* ensureParentDir(outPath)

    const result = yield* Effect.promise(() =>
      generateRegisterPayloads(outPath, {
        count,
        chunkSize,
        workerCount: args.workers,
        verifierAddress,
      })
    )

    const totalMs = result.generateMs + result.writeMs
    const entriesPerSec = result.generateMs > 0 ? result.entriesWritten / (result.generateMs / 1000) : 0

    yield* Console.log(
      `wrote ${result.outPath} — ${result.entriesWritten} signed register entries ` +
        `(verifier=${verifierAddress}, workers=${result.workerCount}, chunkSize=${chunkSize})`,
    )
    yield* Console.log(
      `  generate: ${(result.generateMs / 1000).toFixed(2)}s (${entriesPerSec.toFixed(1)} entries/sec), ` +
        `merge/write: ${(result.writeMs / 1000).toFixed(2)}s, total: ${(totalMs / 1000).toFixed(2)}s`,
    )
  })
}
