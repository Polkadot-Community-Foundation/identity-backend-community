import { encodeBase64Url } from '@std/encoding'

import { addressFromSeed } from './queue-entry-builder.js'

export interface DeviceToken {
  readonly androidId: string
  readonly widevineId: string
}

export interface Claimant {
  readonly account: string
  readonly username: string
  readonly voucherKey: string
  readonly deviceToken: DeviceToken
}

const aClaimant = (username: string, seed: number): Claimant => ({
  account: addressFromSeed(seed),
  username,
  voucherKey: `voucher-${username}`,
  deviceToken: { androidId: `${username}-android`, widevineId: `${username}-widevine` },
})

export const Claimants = {
  alice: aClaimant('alice', 0xa1),
  bella: aClaimant('bella', 0xb2),
  cara: aClaimant('cara', 0xc3),
  dora: aClaimant('dora', 0xd4),
  erin: aClaimant('erin', 0xe5),
  faye: aClaimant('faye', 0xf6),
  gwen: aClaimant('gwen', 0x77),
  hank: aClaimant('hank', 0x88),
}

export const aPriorDeviceOwner = addressFromSeed(0x11)

export const MALFORMED_DEVICE_TOKEN_HEADER = '!!!malformed!!!'

export const encodeDeviceToken = (token: DeviceToken): string =>
  encodeBase64Url(new TextEncoder().encode(JSON.stringify(token)))
