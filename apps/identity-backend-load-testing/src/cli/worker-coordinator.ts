import { mkdirSync, rmSync, truncateSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface WorkerRunOptions {
  readonly count: number
  readonly chunkSize: number
  readonly workerCount: number
  readonly verifierAddress: string
  readonly tmpDir?: string
}

export interface WorkerRunResult {
  readonly outPath: string
  readonly entriesWritten: number
  readonly generateMs: number
  readonly writeMs: number
  readonly workerCount: number
}

interface ChunkSpec {
  chunkIndex: number
  startIndex: number
  count: number
}

interface ChunkResult {
  chunkIndex: number
  filePath: string
  count: number
}

interface WorkerReply {
  results: ChunkResult[]
}

interface Child {
  proc: ReturnType<typeof Bun.spawn>
  inFlight: ChunkSpec | null
  replyResolver: ((r: ChunkResult) => void) | null
  replyRejecter: ((e: Error) => void) | null
  exited: boolean
  exitCode: number | null
}

function splitIntoChunks(total: number, chunkSize: number): ChunkSpec[] {
  const chunks: ChunkSpec[] = []
  for (let startIndex = 0, chunkIndex = 0; startIndex < total; startIndex += chunkSize, chunkIndex++) {
    chunks.push({ chunkIndex, startIndex, count: Math.min(chunkSize, total - startIndex) })
  }
  return chunks
}

function defaultWorkerCount(): number {
  return Math.max(1, availableParallelism() - 1)
}

function rejectInFlight(child: Child, code: number | null): void {
  if (!child.inFlight) return
  const inFlight = child.inFlight
  const reject = child.replyRejecter
  child.inFlight = null
  child.replyResolver = null
  child.replyRejecter = null
  reject?.(new Error(`worker exited mid-chunk ${inFlight.chunkIndex} (code=${code})`))
}

function spawnChild(workerPath: string): Child {
  const child: Child = {
    proc: undefined as never,
    inFlight: null,
    replyResolver: null,
    replyRejecter: null,
    exited: false,
    exitCode: null,
  }
  const proc = Bun.spawn({
    cmd: ['bun', 'run', workerPath],
    stdio: ['ignore', 'inherit', 'inherit'],
    ipc: (message: unknown) => {
      const reply = message as WorkerReply
      if (!reply || !Array.isArray(reply.results)) return
      const inFlight = child.inFlight
      if (!inFlight) return
      const result = reply.results.find((r) => r.chunkIndex === inFlight.chunkIndex)
      if (!result) return
      const resolve = child.replyResolver
      child.inFlight = null
      child.replyResolver = null
      child.replyRejecter = null
      resolve?.(result)
    },
    onDisconnect: () => {
      child.exited = true
      child.exitCode = child.proc.exitCode
      rejectInFlight(child, child.exitCode)
    },
  })
  child.proc = proc
  void proc.exited.then((code) => {
    child.exited = true
    child.exitCode = code
    rejectInFlight(child, code)
  })
  return child
}

async function runInSubprocesses(
  count: number,
  chunkSize: number,
  workerCount: number,
  verifierAddress: string,
  outDir: string,
): Promise<ChunkResult[]> {
  const chunks = splitIntoChunks(count, chunkSize)
  if (chunks.length === 0) return []

  const workerPath = fileURLToPath(new URL('../../ts-setup/generate-payloads-worker.ts', import.meta.url))
  const poolSize = Math.min(workerCount, chunks.length)

  const pendingChunks = new Set<ChunkSpec>(chunks)
  const children: Child[] = []
  const inflightPromises: Promise<ChunkResult>[] = []
  let respawnCount = 0

  const dispatch = (child: Child) => {
    if (child.exited || child.inFlight) return
    const next = pendingChunks.values().next().value as ChunkSpec | undefined
    if (!next) return
    pendingChunks.delete(next)
    child.inFlight = next
    const promise = new Promise<ChunkResult>((resolve, reject) => {
      child.replyResolver = resolve
      child.replyRejecter = reject
    })
    inflightPromises.push(promise)
    const onSuccess = () => {
      if (!child.exited) queueMicrotask(() => dispatch(child))
    }
    const onFailure = () => {
      pendingChunks.add(next)
      try {
        child.proc.kill()
      } catch {}
      const idx = children.indexOf(child)
      if (idx >= 0) children.splice(idx, 1)
      respawnCount++
      const replacement = spawnChild(workerPath)
      children.push(replacement)
      queueMicrotask(() => dispatch(replacement))
    }
    promise.then(onSuccess, onFailure)
    child.proc.send({ chunks: [next], verifierAddress, outDir })
  }

  for (let i = 0; i < poolSize; i++) {
    const child = spawnChild(workerPath)
    children.push(child)
  }
  for (const child of children) dispatch(child)

  while (pendingChunks.size > 0) {
    await Promise.race([Promise.allSettled(inflightPromises), sleep(50)])
  }

  await Promise.allSettled(inflightPromises)

  for (const child of children) {
    if (!child.exited) {
      try {
        child.proc.kill()
      } catch {}
    }
  }

  if (respawnCount > 0) {
    process.stderr.write(`[loadgen] ${respawnCount} worker crash(es); chunks were reissued\n`)
  }

  const settled = await Promise.allSettled(inflightPromises)
  return settled.flatMap((s) => s.status === 'fulfilled' && s.value.filePath ? [s.value] : [])
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function streamConcat(results: ChunkResult[], outPath: string): Promise<number> {
  const sorted = [...results].sort((a, b) => a.chunkIndex - b.chunkIndex)
  const outDir = dirname(outPath)
  mkdirSync(outDir, { recursive: true })
  // Bun.file(outPath).writer() opens O_WRONLY without O_TRUNC, so writing fewer
  // bytes than an existing file leaves residue. Truncate first.
  try {
    truncateSync(outPath, 0)
  } catch {}
  const writer = Bun.file(outPath).writer()
  let total = 0
  try {
    for (const result of sorted) {
      if (!result.filePath) continue
      const text = await Bun.file(result.filePath).text()
      await writer.write(text)
      total += result.count
    }
  } finally {
    await writer.end()
  }
  return total
}

export async function generateRegisterPayloads(
  outPath: string,
  options: WorkerRunOptions,
): Promise<WorkerRunResult> {
  const tmpDir = options.tmpDir ?? process.env.TMPDIR ?? '/tmp'
  const outDir = join(tmpDir, `identity-backend-register-payloads-${Date.now()}`)
  mkdirSync(outDir, { recursive: true })

  const workerCount = options.workerCount > 0 ? options.workerCount : defaultWorkerCount()
  const startedAt = performance.now()
  try {
    const results = await runInSubprocesses(
      options.count,
      options.chunkSize,
      workerCount,
      options.verifierAddress,
      outDir,
    )
    const generatedAt = performance.now()
    const entriesWritten = await streamConcat(results, outPath)
    const writtenAt = performance.now()

    return {
      outPath,
      entriesWritten,
      generateMs: generatedAt - startedAt,
      writeMs: writtenAt - generatedAt,
      workerCount,
    }
  } finally {
    rmSync(outDir, { recursive: true, force: true })
  }
}
