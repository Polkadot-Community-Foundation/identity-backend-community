import { webcrypto } from 'node:crypto'
try {
  globalThis.crypto = webcrypto as unknown as Crypto
} catch { /* empty */ }
