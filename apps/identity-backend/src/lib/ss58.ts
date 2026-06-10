import { PublicKey } from '#root/features/subscriptions/types.js'
import { ss58Address } from '@polkadot-labs/hdkd-helpers'
import { Redacted } from 'effect'

const SHORT_ADDRESS_MIN_LENGTH = 11

export const toShortSs58Address = (pubkey: Redacted.Redacted<PublicKey>): string => {
  const address = ss58Address(Redacted.value(pubkey))
  return address.length <= SHORT_ADDRESS_MIN_LENGTH ? address : `${address.slice(0, 5)}…${address.slice(-5)}`
}
