import { BunRuntime } from '@effect/platform-bun'
import { sr25519 } from '@identity-backend/crypto'
import { entropyToMiniSecret, mnemonicToEntropy, ss58Address } from '@polkadot-labs/hdkd-helpers'
import { Console, Effect, Redacted } from 'effect'
import { Binary } from 'polkadot-api'

const program = Effect.gen(function*() {
  const entropy = mnemonicToEntropy('put the mnemonic here')
  const miniSecret = entropyToMiniSecret(entropy)
  const fakeCrypto = {
    getRandomValues: (array: Uint8Array) => {
      array.set(miniSecret)
      return array
    },
    subtle: globalThis.crypto.subtle,
  } as Crypto

  const keypair = yield* sr25519.generateKeypair({ crypto: fakeCrypto })
  const expandedPrivateKey = Binary.toHex(Redacted.value(keypair.privateKey))

  yield* Console.log('Expanded Private Key (hex):')
  yield* Console.log(expandedPrivateKey)
  yield* Console.log('')
  yield* Console.log('SS58 Address:')
  yield* Console.log(ss58Address(keypair.publicKey))
})

BunRuntime.runMain(program)
