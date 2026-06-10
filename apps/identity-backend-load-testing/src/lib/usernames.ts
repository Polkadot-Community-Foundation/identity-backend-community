export const BASES = [
  'alice',
  'bob',
  'charlie',
  'dave',
  'eve',
  'frank',
  'grace',
  'henry',
  'isabella',
  'jack',
] as const

export type Base = (typeof BASES)[number]

export const SHORT_PREFIXES = BASES.map((b) => b[0]!) as readonly string[]
export const MEDIUM_PREFIXES: readonly string[] = ['al', 'bo', 'cha', 'da', 'ev', 'fra', 'gr', 'he', 'is', 'ja']
export const FULL_PREFIXES: readonly string[] = [...BASES]
