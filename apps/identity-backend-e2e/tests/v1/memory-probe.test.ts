import { checkResponse } from '@identity-backend/testing/hono'
import { hc } from 'hono/client'
import type { App } from 'identity-backend-container/v1'
import { execSync } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir, stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { StartedDockerComposeEnvironment } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { setupTestEnvironment, teardownTestEnvironment } from '../setup.ts'

const PROBE_ENABLED = process.env.E2E_MEMORY_PROBE === 'true'
const ITERATIONS = Number(process.env.E2E_MEMORY_PROBE_ITERATIONS ?? 2_000)
const SAMPLE_EVERY = Number(process.env.E2E_MEMORY_PROBE_SAMPLE_EVERY ?? 50)
const CONCURRENCY = Number(process.env.E2E_MEMORY_PROBE_CONCURRENCY ?? 10)
const HEAPDUMP_ENABLED = process.env.E2E_HEAPDUMP_ENABLED === 'true'
const HEAPDUMP_DIR = process.env.E2E_HEAPSNAPSHOTS_DIR ?? '.heapsnapshots'
const HEAPDUMP_USERNAME = process.env.SWAGGER_USERNAME ?? 'swagger'
const HEAPDUMP_PASSWORD = process.env.SWAGGER_PASSWORD ?? 'swagger'

interface Sample {
  readonly t: number
  readonly iter: number
  readonly label: string
  readonly rssMiB: number
  readonly memMiB: number
  readonly memPct: number
}

const parseDockerSize = (raw: string): number => {
  const m = raw.trim().match(/^([\d.]+)\s*([KMG]i?B)$/i)
  if (!m) return NaN
  const [, n, unit] = m
  const v = Number(n)
  switch (unit!.toLowerCase()) {
    case 'kib':
    case 'kb':
      return v / 1024
    case 'mib':
    case 'mb':
      return v
    case 'gib':
    case 'gb':
      return v * 1024
    default:
      return NaN
  }
}

const sampleContainer = (containerId: string, label: string, iter: number, t0: number): Sample => {
  const out = execSync(
    `docker stats --no-stream --format '{{.MemUsage}}|{{.MemPerc}}' ${containerId}`,
    { encoding: 'utf8' },
  ).trim()
  const [memUsage = '', memPerc = '0%'] = out.split('|')
  const usedRaw = memUsage.split('/')[0]?.trim() ?? ''
  const memMiB = parseDockerSize(usedRaw)
  const memPct = Number(memPerc.replace('%', ''))
  return {
    t: Math.round((Date.now() - t0) / 1000),
    iter,
    label,
    rssMiB: memMiB,
    memMiB,
    memPct,
  }
}

const formatSample = (s: Sample): string =>
  `[mem] t=${String(s.t).padStart(4)}s iter=${String(s.iter).padStart(5)} ` +
  `mem=${s.memMiB.toFixed(1).padStart(7)} MiB (${s.memPct.toFixed(1).padStart(5)}%) ${s.label}`

const captureHeapSnapshot = async (
  baseUrl: string,
  label: string,
): Promise<{ readonly path: string; readonly bytes: number; readonly identity: Record<string, string> }> => {
  const credentials = Buffer.from(`${HEAPDUMP_USERNAME}:${HEAPDUMP_PASSWORD}`).toString('base64')
  const url = `${baseUrl}/debug/heapdump?label=${encodeURIComponent(label)}`
  const res = await fetch(url, { headers: { Authorization: `Basic ${credentials}` } })
  if (!res.ok || !res.body) {
    throw new Error(`heapdump request failed: ${res.status} ${await res.text().catch(() => '')}`)
  }
  const identity = {
    hostname: res.headers.get('X-Heapdump-Hostname') ?? 'unknown',
    bootId: res.headers.get('X-Heapdump-Boot-Id') ?? 'unknown',
    pid: res.headers.get('X-Heapdump-Pid') ?? 'unknown',
    startedAt: res.headers.get('X-Heapdump-Started-At') ?? 'unknown',
  }
  const filename = res.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] ??
    `${Date.now()}-${label}.heapsnapshot`
  await mkdir(HEAPDUMP_DIR, { recursive: true })
  const path = `${HEAPDUMP_DIR}/${filename}`
  await pipeline(
    Readable.fromWeb(res.body as unknown as Parameters<typeof Readable.fromWeb>[0]),
    createWriteStream(path),
  )
  const { size } = await stat(path)
  return { path, bytes: size, identity }
}

const logSnapshot = (label: string, snap: { path: string; bytes: number; identity: Record<string, string> }) => {
  const sizeMiB = (snap.bytes / 1024 / 1024).toFixed(1)
  console.log(
    `[heap] label=${label} path=${snap.path} size=${sizeMiB} MiB ` +
      `host=${snap.identity.hostname} bootId=${snap.identity.bootId} pid=${snap.identity.pid}`,
  )
}

const summarize = (samples: readonly Sample[]) => {
  if (samples.length < 2) return
  const first = samples[0]!
  const last = samples[samples.length - 1]!
  const peak = samples.reduce((p, s) => (s.memMiB > p.memMiB ? s : p), first)
  const deltaMiB = last.memMiB - first.memMiB
  const deltaSec = last.t - first.t || 1
  const ratePerHr = (deltaMiB / deltaSec) * 3600
  console.log('')
  console.log('=== memory probe summary ===')
  console.log(`samples:           ${samples.length}`)
  console.log(`window:            ${first.t}s → ${last.t}s (${last.t - first.t}s)`)
  console.log(`baseline:          ${first.memMiB.toFixed(1)} MiB`)
  console.log(`final:             ${last.memMiB.toFixed(1)} MiB`)
  console.log(`peak:              ${peak.memMiB.toFixed(1)} MiB at iter=${peak.iter} (t=${peak.t}s)`)
  console.log(`growth:            ${deltaMiB.toFixed(1)} MiB`)
  console.log(`rate (linear):     ${ratePerHr.toFixed(1)} MiB/hour`)
  console.log('============================')
  console.log('')
}

describe.skipIf(!PROBE_ENABLED)('E2E: Memory probe under request load', () => {
  let environment: StartedDockerComposeEnvironment
  let app: ReturnType<typeof hc<App>>

  beforeAll(async () => {
    ;({ environment, app } = await setupTestEnvironment<App>({ peopleNetwork: 'pop-testnet' }))
  })

  afterAll(async () => {
    await teardownTestEnvironment(environment)
  })

  it('Should_RecordMemoryGrowth_When_RequestLoadIsApplied', { timeout: 30 * 60_000 }, async () => {
    const webContainer = environment.getContainer('web-1')
    const containerId = webContainer.getId()
    const baseUrl = `http://localhost:${webContainer.getMappedPort(8080)}`
    const t0 = Date.now()
    const samples: Sample[] = []

    const record = (label: string, iter: number) => {
      const s = sampleContainer(containerId, label, iter, t0)
      samples.push(s)
      console.log(formatSample(s))
    }

    const heap = async (label: string) => {
      if (!HEAPDUMP_ENABLED) return
      try {
        const snap = await captureHeapSnapshot(baseUrl, label)
        logSnapshot(label, snap)
      } catch (err) {
        console.warn(`[heap] capture failed for label=${label}:`, err)
      }
    }

    record('baseline', 0)
    await heap('baseline')

    const usernames = Array.from({ length: 5 }, (_, i) => `probeuser${i}.${1000 + i}`)

    let completed = 0
    while (completed < ITERATIONS) {
      const batch = Array.from({ length: CONCURRENCY }, async () => {
        const r1 = await app.api.v1.usernames.available.$post({
          query: {},
          json: { usernames },
        })
        checkResponse(r1, 200)
        await r1.json()
      })
      await Promise.all(batch)
      completed += CONCURRENCY

      if (completed % SAMPLE_EVERY === 0 || completed === ITERATIONS) {
        record('availability-batch', completed)
      }
    }

    record('after-load', ITERATIONS)
    await heap('after-load')
    await new Promise((r) => setTimeout(r, 30_000))
    record('post-cooldown-30s', ITERATIONS)
    await heap('post-cooldown')

    summarize(samples)

    expect(samples.length).toBeGreaterThan(2)
  })
})
