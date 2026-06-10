import { USERNAME_DIGIT_V1_SET } from '#root/constants.js'
import type { UsernameDigits } from '#root/schema/username.js'
import { HashSet } from 'effect'

export const computeAvailableDigits = (allocatedDigits: HashSet.HashSet<UsernameDigits>): number[] => {
  const allocatedValues = new Set<string>(Array.from(HashSet.values(allocatedDigits)))
  return USERNAME_DIGIT_V1_SET
    .filter((digit) => digit !== '00' && !allocatedValues.has(digit))
    .map((digit) => parseInt(digit, 10))
}
