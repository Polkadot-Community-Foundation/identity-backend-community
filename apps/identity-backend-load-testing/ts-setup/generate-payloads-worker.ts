#!/usr/bin/env bun
import {
  deriveLitePersonParams,
  formatParams,
  generateMnemonic,
  litePersonParamsCandidatePublicKeyHex,
} from '@identity-backend/people-lite-fixtures'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUsername } from './username-fixtures.js'

interface ChunkSpec {
  chunkIndex: number
  startIndex: number
  count: number
}

interface WorkerTask {
  chunks: ChunkSpec[]
  verifierAddress: string
  outDir: string
}

interface ChunkResult {
  chunkIndex: number
  filePath: string
  count: number
}

interface WorkerReply {
  results: ChunkResult[]
}

function generateChunk(
  startIndex: number,
  count: number,
  verifierAddress: string,
): string[] {
  const lines: string[] = []
  for (let offset = 0; offset < count; offset++) {
    void (startIndex + offset)
    const mnemonic = generateMnemonic()
    const baseUsername = randomUsername()
    const params = deriveLitePersonParams(mnemonic, baseUsername, verifierAddress)
    const body = formatParams(params)
    const entry = {
      body,
      who: body.candidateAccountId,
      sub: litePersonParamsCandidatePublicKeyHex(params),
      mnemonic,
    }
    lines.push(JSON.stringify(entry))
  }
  return lines
}

interface ProcessLike {
  on(event: 'message', listener: (msg: WorkerTask) => void): void
  send(msg: WorkerReply): void
}

const proc = process as unknown as ProcessLike

proc.on('message', async (task: WorkerTask) => {
  const { chunks, verifierAddress, outDir } = task
  const results: ChunkResult[] = []
  for (const chunk of chunks) {
    const lines = generateChunk(chunk.startIndex, chunk.count, verifierAddress)
    const filePath = join(outDir, `register-payloads-chunk-${chunk.chunkIndex}.jsonl`)
    await writeFile(filePath, `${lines.join('\n')}${lines.length > 0 ? '\n' : ''}`)
    results.push({ chunkIndex: chunk.chunkIndex, filePath, count: lines.length })
  }
  proc.send({ results })
})
