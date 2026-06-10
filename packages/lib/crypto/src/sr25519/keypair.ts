import { sr25519_pubkey, sr25519_secret_from_seed, sr25519_sign, sr25519_verify } from '@polkadot-labs/schnorrkel-wasm'
import { Effect, Redacted, Schema as S } from 'effect'
import { PrivateKey, PublicKey } from './types.js'

namespace Keypair {
  export type Keypair = Readonly<{
    privateKey: Redacted.Redacted<PrivateKey>
    publicKey: PublicKey
    sign: (msg: Uint8Array) => Effect.Effect<Uint8Array, never, never>
    verify: (msg: Uint8Array, sig: Uint8Array) => Effect.Effect<boolean, never, never>
  }>

  export type ReadonlyKeypair = Omit<Keypair, 'privateKey' | 'sign'>
}

namespace GeneratePrivateKey {
  export interface Options {
    readonly crypto?: {
      getRandomValues: Crypto['getRandomValues']
    }
  }

  export type GeneratePrivateKey = (options?: Options) => Effect.Effect<PrivateKey, never, never>
}

const generatePrivateKey: GeneratePrivateKey.GeneratePrivateKey = (options = {}) =>
  Effect.gen(function*() {
    const crypto = options.crypto ?? globalThis.crypto

    const seed = new Uint8Array(32)
    yield* Effect.sync(() => crypto.getRandomValues(seed))

    return yield* S.decode(PrivateKey)(sr25519_secret_from_seed(seed))
  }).pipe(
    Effect.orDie,
  )

export namespace FromPublicKey {
  export interface Options {
    readonly publicKey: PublicKey
  }
  export type ReadonlyKeypair = Keypair.ReadonlyKeypair
  export type FromPublicKey = (options: Options) => Effect.Effect<ReadonlyKeypair, never, never>
}

export const verify = (publicKey: Uint8Array, msg: Uint8Array, sig: Uint8Array): boolean => {
  if (sig.byteLength !== 64) return false
  try {
    return sr25519_verify(publicKey, msg, sig)
  } catch {
    return false
  }
}

export const fromPublicKey: FromPublicKey.FromPublicKey = ({ publicKey }) =>
  Effect.gen(function*() {
    yield* Effect.void

    return {
      publicKey,
      verify: (msg, sig) => Effect.sync(() => verify(publicKey, msg, sig)),
    } satisfies FromPublicKey.ReadonlyKeypair
  }).pipe(
    Effect.orDie,
  )

export namespace FromPrivateKey {
  export interface Options {
    readonly privateKey: Redacted.Redacted<PrivateKey>
  }
  export type Keypair = Keypair.Keypair
  export type FromPrivateKey = (options: Options) => Effect.Effect<Keypair, never, never>
}

export const fromPrivateKey: FromPrivateKey.FromPrivateKey = ({ privateKey }) =>
  Effect.gen(function*() {
    const publicKey = yield* S.decode(PublicKey)(yield* Effect.sync(() => sr25519_pubkey(Redacted.value(privateKey))))
    const { verify } = yield* fromPublicKey({ publicKey })
    const sign = (msg: Uint8Array) => Effect.sync(() => sr25519_sign(publicKey, Redacted.value(privateKey), msg))

    return {
      privateKey,
      publicKey,
      sign,
      verify,
    } satisfies FromPrivateKey.Keypair
  }).pipe(
    Effect.orDie,
  )

export namespace GenerateKeypair {
  export interface Options {
    readonly crypto?: {
      getRandomValues: Crypto['getRandomValues']
    }
  }

  export type Keypair = Keypair.Keypair
  export type GenerateKeypair = (options?: Options) => Effect.Effect<Keypair, never, never>
}

export const generateKeypair: GenerateKeypair.GenerateKeypair = (options = {}) => {
  return Effect.gen(function*() {
    const crypto = options.crypto ?? globalThis.crypto

    const privateKey = yield* generatePrivateKey({ crypto })
    return yield* fromPrivateKey({ privateKey: Redacted.make(privateKey) })
  })
}

export interface Keypair extends Keypair.Keypair {}
export interface ReadonlyKeypair extends Keypair.ReadonlyKeypair {}
