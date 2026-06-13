import { bytesToHex as nobleBytesToHex, concatBytes, hexToBytes as nobleHexToBytes } from '@noble/hashes/utils.js'

export { concatBytes }

export function bytesToHex(input: ArrayBuffer | Uint8Array): string {
  return nobleBytesToHex(input instanceof Uint8Array ? input : new Uint8Array(input))
}

export function hexToBytes(hex: string): Uint8Array {
  return nobleHexToBytes(hex.length % 2 === 0 ? hex : `0${hex}`)
}

const UINT32_RADIX = 0x1_0000_0000

export function uint64BigEndian(value: number): Uint8Array {
  const out = new Uint8Array(8)
  const view = new DataView(out.buffer)
  view.setUint32(0, Math.floor(value / UINT32_RADIX), false)
  view.setUint32(4, value % UINT32_RADIX, false)
  return out
}

const BYTE_CLZ32_BASE = 24

export function leadingZeroBitsOfHexDigest(hexDigest: string): number {
  const bytes = hexToBytes(hexDigest)
  let bits = 0
  for (const byte of bytes) {
    if (byte === 0) {
      bits += 8
      continue
    }
    return bits + Math.clz32(byte) - BYTE_CLZ32_BASE
  }
  return bits
}
