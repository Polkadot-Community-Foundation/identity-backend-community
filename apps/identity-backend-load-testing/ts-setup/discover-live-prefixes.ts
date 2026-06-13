#!/usr/bin/env bun
import { type Puzzle, solvePuzzle } from '@identity-backend/people-lite-fixtures/proof-of-compute'
import { writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const CLI_ARGS = process.argv.slice(2).filter((a) => a !== '--')
const BASE_URL = (CLI_ARGS[0] || process.env.BASE_URL || 'http://localhost:8080').replace(/\/$/, '')
const NETWORK = process.env.PEOPLE_NETWORK || 'paseo'
const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = resolve(HERE, '..')
const MANIFEST_PATH = process.env.PREFIX_MANIFEST || join(PACKAGE_ROOT, 'prefixes.json')
const PER_LETTER_LIMIT = Math.min(Math.max(parseInt(process.env.DISCOVER_PER_LETTER || '50', 10), 1), 200)

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz'.split('')
const SPARSE_CANDIDATES = ['zxq', 'qzj', 'xqz', 'jwq', 'zzq', 'qqx', 'wxz', 'jqz', 'vqx', 'qxj']

interface SearchUsername {
  username: string
}

interface SearchPage {
  usernames: SearchUsername[]
  nextCursor: string | null
}

interface Prefixes {
  short: string[]
  medium: string[]
  full: string[]
  sparse: string[]
}

async function proofHeader(): Promise<Record<string, string>> {
  const res = await fetch(`${BASE_URL}/api/v1/poc/issue`, { method: 'POST' })
  if (res.status !== 201) return {}
  const puzzle = await res.json() as Puzzle
  return { 'Proof-Of-Compute': solvePuzzle(puzzle) }
}

async function search(prefix: string, limit: number): Promise<SearchUsername[]> {
  const url = `${BASE_URL}/api/v1/usernames/search?prefix=${encodeURIComponent(prefix)}&limit=${limit}`
  const res = await fetch(url, { headers: await proofHeader() })
  if (res.status !== 200) {
    console.warn(`  search "${prefix}" -> HTTP ${res.status} (skipping)`)
    return []
  }
  const page = await res.json() as Partial<SearchPage>
  return Array.isArray(page.usernames) ? page.usernames : []
}

function bucketByLength(harvested: string[]): Pick<Prefixes, 'short' | 'medium' | 'full'> {
  const short = new Set<string>()
  const medium = new Set<string>()
  const full = new Set<string>()
  for (const name of harvested) {
    const lower = name.toLowerCase()
    if (lower.length >= 1) short.add(lower.slice(0, Math.min(2, lower.length)))
    if (lower.length >= 3) medium.add(lower.slice(0, 3))
    full.add(lower)
  }
  return { short: [...short], medium: [...medium], full: [...full] }
}

async function main(): Promise<void> {
  console.log(`Discovering live prefixes against ${BASE_URL} (network=${NETWORK})...`)
  const start = performance.now()

  const searchResults = await Promise.all(
    ALPHABET.map((letter) => search(letter, PER_LETTER_LIMIT)),
  )

  const harvested = new Set<string>()
  for (const hits of searchResults) {
    for (const u of hits) {
      if (typeof u.username === 'string' && u.username.length > 0) harvested.add(u.username)
    }
  }

  if (harvested.size === 0) {
    console.error(
      `No usernames discovered at ${BASE_URL}. The target may be empty, gated, or unreachable. ` +
        `Refusing to write a manifest that would make k6 fall back to non-matching prefixes.`,
    )
    process.exit(1)
  }

  const buckets = bucketByLength([...harvested])
  const sparseHits = await Promise.all(SPARSE_CANDIDATES.map((candidate) => search(candidate, 1)))
  const sparse = SPARSE_CANDIDATES.filter((_, index) => sparseHits[index]!.length <= 1)
  const prefixes: Prefixes = { ...buckets, sparse: sparse.length > 0 ? sparse : SPARSE_CANDIDATES }

  const elapsed = Math.round(performance.now() - start)
  writeFileSync(
    MANIFEST_PATH,
    `${JSON.stringify({ profile: 'live-discovered', network: NETWORK, count: harvested.size, prefixes }, null, 2)}\n`,
  )
  console.log(
    `wrote ${MANIFEST_PATH} — ${prefixes.short.length} short / ${prefixes.medium.length} medium / ` +
      `${prefixes.full.length} full / ${prefixes.sparse.length} sparse prefixes from ${harvested.size} live usernames ` +
      `(${elapsed}ms)`,
  )
}

main().catch((err: unknown) => {
  console.error('Live prefix discovery failed:', err)
  process.exit(1)
})
