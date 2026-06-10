export const computeRetryDelay = (baseMs: number, maxMs: number, maxExponent: number) => (attempt: number): number => {
  const capped = Math.min(attempt, maxExponent)
  return Math.min(baseMs * Math.pow(2, capped), maxMs)
}
