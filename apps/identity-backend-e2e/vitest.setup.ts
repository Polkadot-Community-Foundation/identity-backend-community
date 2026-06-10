import { webcrypto } from 'node:crypto'

try {
  // Suppress: Cannot set property crypto of #<Object> which has only a getter
  globalThis.crypto = webcrypto as unknown as Crypto
} catch {}
