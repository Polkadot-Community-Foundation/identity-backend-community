import { PEOPLE_CHAIN_DESCRIPTOR } from '#root/config.js'
import { Effect } from 'effect'

export class PeopleChainCodecs extends Effect.Service<PeopleChainCodecs>()(
  '@identity-backend-container/PeopleChainCodecs',
  {
    effect: Effect.gen(function*() {
      const [{ Twox128 }, { mergeUint8, toHex }, { getTypedCodecs }] = yield* Effect
        .promise(() =>
          Promise.all([
            import('@polkadot-api/substrate-bindings'),
            import('polkadot-api/utils'),
            import('polkadot-api'),
          ])
        )

      const { ss58Decode } = yield* Effect.promise(() => import('@polkadot-labs/hdkd-helpers'))

      const descriptorName = yield* PEOPLE_CHAIN_DESCRIPTOR
      const descriptors = yield* Effect.promise(() => import('@identity-backend/descriptors'))
      const descriptor = descriptors[descriptorName]
      const codecs = yield* Effect.promise(() => getTypedCodecs(descriptor))
      const valueCodec = codecs.query.System.Account.value

      // Precompute Twox128 hashes — avoids the dynamic builder's expensive
      // codec (~90KB per call per gh-2538). The System.Account key layout is:
      //   Twox128("System") + Twox128("Account") + AccountId(32 bytes)
      const systemPrefix = Twox128(new TextEncoder().encode('System'))
      const accountPrefix = Twox128(new TextEncoder().encode('Account'))

      return {
        encodeKey: (id: string) => {
          const pubkey = ss58Decode(id)[0]
          return toHex(mergeUint8([systemPrefix, accountPrefix, pubkey]))
        },
        decodeValue: (hex: string) => valueCodec.dec(hex),
      }
    }),
  },
) {}
