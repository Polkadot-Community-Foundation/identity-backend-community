import { concat as _concatBytes } from '@std/bytes'
import { Effect } from 'effect'

/**
 * @internal
 * Converts a Uint8Array<ArrayBufferLike> to Uint8Array<ArrayBuffer>
 * by copying the data to a new ArrayBuffer
 */
export const toArrayBuffer = (uint8Array: Uint8Array): Uint8Array<ArrayBuffer> => {
  const buffer = new ArrayBuffer(uint8Array.byteLength)
  new Uint8Array(buffer).set(uint8Array)
  return new Uint8Array(buffer)
}

/**
 * @internal
 */
export const concatBytesSync = _concatBytes

/**
 * @internal
 */
export const concatBytes = (buffers: Uint8Array[]): Effect.Effect<Uint8Array<ArrayBuffer>, never, never> =>
  Effect.sync(() => {
    const result = _concatBytes(buffers)
    return toArrayBuffer(result)
  })
