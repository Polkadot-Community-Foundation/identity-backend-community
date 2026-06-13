interface Prefixes {
  short: string[]
  medium: string[]
  full: string[]
  sparse: string[]
}

const FALLBACK: Prefixes = {
  short: 'abcdefghijklmnopqrstuvwxyz'.split(''),
  medium: ['the', 'and', 'red', 'sun', 'big', 'cat', 'dog', 'fox', 'sky', 'joy'],
  full: ['alice', 'bob', 'charlie', 'dave', 'eve', 'frank', 'grace', 'henry'],
  sparse: ['zxq', 'qzj', 'xqz', 'jwq', 'zzq', 'qqx', 'wxz', 'jqz'],
}

function loadPrefixes(): Prefixes {
  const path = __ENV.PREFIX_MANIFEST
  if (!path) return FALLBACK
  try {
    const parsed: { prefixes?: Partial<Prefixes> } = JSON.parse(open(path))
    const p = parsed.prefixes
    if (p && Array.isArray(p.short) && p.short.length > 0 && Array.isArray(p.medium) && Array.isArray(p.full)) {
      return { short: p.short, medium: p.medium, full: p.full, sparse: p.sparse ?? FALLBACK.sparse }
    }
    return FALLBACK
  } catch {
    console.warn(`failed to load prefix manifest at ${path}, using fallback`)
    return FALLBACK
  }
}

const PREFIXES = loadPrefixes()

export const SHORT_PREFIXES: readonly string[] = PREFIXES.short
export const MEDIUM_PREFIXES: readonly string[] = PREFIXES.medium
export const FULL_PREFIXES: readonly string[] = PREFIXES.full
export const SPARSE_PREFIXES: readonly string[] = PREFIXES.sparse
