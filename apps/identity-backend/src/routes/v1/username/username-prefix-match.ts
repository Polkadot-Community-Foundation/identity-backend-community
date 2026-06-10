export type SearchPrefixKind = 'LiteOnly' | 'LiteAndFull'

export const classifySearchPrefix = (prefix: string): SearchPrefixKind =>
  prefix.includes('.') ? 'LiteOnly' : 'LiteAndFull'
