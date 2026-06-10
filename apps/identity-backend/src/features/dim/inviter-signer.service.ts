import { sr25519 } from '@identity-backend/crypto'
import { Context, Effect, Layer, Runtime } from 'effect'
import type { PolkadotSigner } from 'polkadot-api'

export class InviterSignerConfig extends Context.Tag('InviterSignerConfig')<
  InviterSignerConfig,
  { readonly keypair: sr25519.Keypair }
>() {}

export namespace InviterSignerService {
  export interface Definition {
    readonly getSigner: () => Effect.Effect<PolkadotSigner, never>
  }
}

const make = Effect.gen(function*() {
  const config = yield* InviterSignerConfig
  const runtime = yield* Effect.runtime()

  const { getPolkadotSigner } = yield* Effect.promise(() => import('@polkadot-api/signer'))

  const getSigner = (): Effect.Effect<PolkadotSigner, never> =>
    Effect.sync(() => {
      const keyPair = config.keypair
      const baseSigner = getPolkadotSigner(
        keyPair.publicKey,
        'Sr25519',
        (input) => Runtime.runSync(runtime, keyPair.sign(input)),
      )

      const createInviterSigner = (): PolkadotSigner => ({
        publicKey: baseSigner.publicKey,
        signBytes: baseSigner.signBytes,
        signTx: async (
          callData: Uint8Array,
          signedExtensions: Record<string, unknown>,
          metadata: Uint8Array,
          atBlockNumber: number,
          hasher?: (data: Uint8Array) => Uint8Array,
        ) => {
          const ext = {
            ...signedExtensions,
            VerifyMultiSignature: {
              identifier: 'VerifyMultiSignature',
              value: new Uint8Array([0]),
              additionalSigned: new Uint8Array([]),
            },
          }
          return baseSigner.signTx(callData, ext, metadata, atBlockNumber, hasher)
        },
      })

      return createInviterSigner()
    })

  return InviterSignerService.of({ getSigner })
})

export class InviterSignerService extends Context.Tag('@app/InviterSignerService')<
  InviterSignerService,
  InviterSignerService.Definition
>() {
  static readonly Default = Layer.effect(InviterSignerService, make)
}
