import { sha256 } from '@noble/hashes/sha2.js'
import { createExpiry } from '@novasamatech/sdk-statement'

export const deterministicDataBytes = (label: string): Uint8Array =>
  new TextEncoder().encode(`statement-contract:${label}:data`)

const topicHexFromLabel = (label: string, role: string): `0x${string}` =>
  `0x${
    Buffer.from(sha256(new TextEncoder().encode(`statement-contract:${label}:${role}:topic`))).toString('hex')
  }` as const

const channelHexFromLabel = (label: string): `0x${string}` =>
  `0x${Buffer.from(sha256(new TextEncoder().encode(`statement-contract:${label}:channel`))).toString('hex')}` as const

const DETERMINISTIC_EXPIRY_UNIX_SEC = 4102444800

export const deterministicFixtureParts = (label: string): {
  readonly topics: readonly `0x${string}`[]
  readonly channel: `0x${string}`
  readonly data: Uint8Array
  readonly expiry: bigint
} => ({
  topics: [topicHexFromLabel(label, 'a')],
  channel: channelHexFromLabel(label),
  data: deterministicDataBytes(label),
  expiry: createExpiry(DETERMINISTIC_EXPIRY_UNIX_SEC, 0),
})

export function deterministicMultiTopics(
  label: string,
  count: 2,
): readonly [`0x${string}`, `0x${string}`]
export function deterministicMultiTopics(
  label: string,
  count: 3,
): readonly [`0x${string}`, `0x${string}`, `0x${string}`]
export function deterministicMultiTopics(
  label: string,
  count: 4,
): readonly [`0x${string}`, `0x${string}`, `0x${string}`, `0x${string}`]
export function deterministicMultiTopics(label: string, count: number): readonly `0x${string}`[] {
  return Array.from({ length: count }, (_, i) => topicHexFromLabel(label, `t${i}`)) as readonly `0x${string}`[]
}
