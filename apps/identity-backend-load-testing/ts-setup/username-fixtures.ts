#!/usr/bin/env bun
import { customRandom } from 'nanoid'
import { randomBytes } from 'node:crypto'
import { adjectives, animals, colors, uniqueNamesGenerator } from 'unique-names-generator'

export type FixtureProfile = 'uniform' | 'corpus' | 'zipf'

export const FIXTURE_PROFILES: readonly FixtureProfile[] = ['uniform', 'corpus', 'zipf']

const ALNUM = 'abcdefghijklmnopqrstuvwxyz0123456789'
const ZIPF_ALPHA = 1.0
const VOCAB: readonly string[] = [...adjectives, ...animals].map((w) => w.toLowerCase())

export function randomUsername(): string {
  const bytes = randomBytes(22)
  let base = ''
  for (let i = 0; i < 20; i++) base += String.fromCharCode(97 + (bytes[i]! % 26))
  const suffix = String((bytes[20]! % 99) + 1).padStart(2, '0')
  return `${base}.${suffix}`
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function cryptoUniform(): number {
  const buf = randomBytes(4)
  return buf.readUInt32BE(0) / 4294967296
}

function buildZipfCdf(size: number, alpha: number): readonly number[] {
  const weights: number[] = []
  let sum = 0
  for (let rank = 1; rank <= size; rank++) {
    const weight = 1 / Math.pow(rank, alpha)
    weights.push(weight)
    sum += weight
  }
  const cdf: number[] = []
  let acc = 0
  for (const weight of weights) {
    acc += weight / sum
    cdf.push(acc)
  }
  return cdf
}

const ZIPF_CDF = buildZipfCdf(VOCAB.length, ZIPF_ALPHA)

function zipfRank(u: number): number {
  let lo = 0
  let hi = ZIPF_CDF.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (u <= ZIPF_CDF[mid]!) hi = mid
    else lo = mid + 1
  }
  return lo
}

function uniformFromRand(rand: () => number): string {
  const size = 5 + Math.floor(rand() * 8)
  const bytes = (length: number) => {
    const out = new Uint8Array(length)
    for (let i = 0; i < length; i++) out[i] = Math.floor(rand() * 256)
    return out
  }
  return customRandom(ALNUM, size, bytes)()
}

function corpusFromRand(rand: () => number): string {
  return uniqueNamesGenerator({
    dictionaries: [adjectives, colors, animals],
    separator: '',
    style: 'lowerCase',
    seed: Math.floor(rand() * 0x7fffffff),
  })
}

function zipfFromRand(rand: () => number): string {
  return VOCAB[zipfRank(rand())]!
}

function generateFromRand(profile: FixtureProfile, rand: () => number): string {
  switch (profile) {
    case 'uniform':
      return uniformFromRand(rand)
    case 'corpus':
      return corpusFromRand(rand)
    case 'zipf':
      return zipfFromRand(rand)
  }
}

export function generateUsername(profile: FixtureProfile, index: number): string {
  return generateFromRand(profile, mulberry32(index + 1))
}

export function generateRandomUsername(profile: FixtureProfile): string {
  return generateFromRand(profile, cryptoUniform)
}

export interface SearchPrefixes {
  short: string[]
  medium: string[]
  full: string[]
  sparse: string[]
}

const RARE_LETTERS = ['q', 'z', 'x', 'j', 'w']

function sparsePrefixes(): string[] {
  const out = new Set<string>()
  for (const a of RARE_LETTERS) {
    for (const b of RARE_LETTERS) {
      out.add(`${a}${b}`)
      for (const c of RARE_LETTERS) out.add(`${a}${b}${c}`)
    }
  }
  return [...out]
}

export function sampleSearchPrefixes(profile: FixtureProfile, sampleSize: number): SearchPrefixes {
  const names: string[] = []
  for (let i = 0; i < sampleSize; i++) names.push(generateRandomUsername(profile))
  const short = [...new Set(names.map((n) => n.slice(0, 1)))]
  const medium = [...new Set(names.filter((n) => n.length >= 3).map((n) => n.slice(0, 3)))]
  const full = [...new Set(names)]
  return { short, medium, full, sparse: sparsePrefixes() }
}
