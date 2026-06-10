import type { Statement as SdkStatement } from '@novasamatech/sdk-statement'
import { sr25519CreateDerive } from '@polkadot-labs/hdkd'
import { DEV_PHRASE, entropyToMiniSecret, mnemonicToEntropy } from '@polkadot-labs/hdkd-helpers'
import { Effect, Schema as S } from 'effect'
import { deterministicFixtureParts } from './deterministic-bytes.js'

export class SignedStatementFixtureError extends S.TaggedError<SignedStatementFixtureError>()(
  'SignedStatementFixtureError',
  {
    reason: S.Literal('signing_failed', 'unexpected_proof_type'),
    cause: S.optional(S.Unknown),
  },
) {}

const aliceKey = (() => {
  const entropy = mnemonicToEntropy(DEV_PHRASE)
  const miniSecret = entropyToMiniSecret(entropy)
  const derive = sr25519CreateDerive(miniSecret)
  return derive('//Alice')
})()

export const aliceSignerPubkey = aliceKey.publicKey

export interface SignedStatementFixture {
  readonly raw: SdkStatement
  readonly data: Uint8Array
  readonly topics: readonly `0x${string}`[]
  readonly signerPubkey: Uint8Array
  readonly signature: string
  readonly channel: string | null
  readonly expiry: bigint | null
}

interface BuildState {
  readonly label: string
  readonly salt: string | null
  readonly topics: readonly `0x${string}`[] | undefined
  readonly data: Uint8Array | null | undefined
  readonly channel: `0x${string}` | null | undefined
  readonly expiry: bigint | null | undefined
}

export type SignedStatementBuilder = {
  readonly withTopics: (topics: readonly `0x${string}`[]) => SignedStatementBuilder
  readonly withChannel: (channel: `0x${string}` | null) => SignedStatementBuilder
  readonly withData: (data: Uint8Array | null) => SignedStatementBuilder
  readonly withExpiry: (expiry: bigint | null) => SignedStatementBuilder
  readonly withSalt: (salt: string) => SignedStatementBuilder
  readonly build: () => Effect.Effect<SignedStatementFixture, SignedStatementFixtureError, never>
  readonly buildTampered: () => Effect.Effect<SignedStatementFixture, SignedStatementFixtureError, never>
  readonly buildWithoutProof: () => Effect.Effect<SdkStatement, SignedStatementFixtureError, never>
}

const makeSignedStatementBuilder = (state: BuildState): SignedStatementBuilder => ({
  withTopics: (topics) => makeSignedStatementBuilder({ ...state, topics }),
  withChannel: (channel) => makeSignedStatementBuilder({ ...state, channel }),
  withData: (data) => makeSignedStatementBuilder({ ...state, data }),
  withExpiry: (expiry) => makeSignedStatementBuilder({ ...state, expiry }),
  withSalt: (salt) => makeSignedStatementBuilder({ ...state, salt }),
  build: () => buildSignedFixture(state),
  buildTampered: () => buildSignedFixture(state).pipe(Effect.map(withTamperedSignature)),
  buildWithoutProof: () =>
    buildSignedFixture(state).pipe(
      Effect.map((signed) => {
        const { proof: _proof, ...withoutProof } = signed.raw
        return withoutProof
      }),
    ),
})

export const SignedStatementBuilder = {
  fromLabel: (label: string): SignedStatementBuilder =>
    makeSignedStatementBuilder({
      label,
      salt: null,
      topics: undefined,
      data: undefined,
      channel: undefined,
      expiry: undefined,
    }),
}

const buildSignedFixture = (
  state: BuildState,
): Effect.Effect<SignedStatementFixture, SignedStatementFixtureError, never> =>
  Effect.gen(function*() {
    const { getStatementSigner } = yield* Effect.promise(() => import('@novasamatech/sdk-statement'))
    const parts = deterministicFixtureParts(state.salt === null ? state.label : `${state.salt}:${state.label}`)

    const topics = state.topics === undefined ? parts.topics : state.topics
    const channel = state.channel === undefined ? parts.channel : state.channel
    const data = state.data === undefined ? parts.data : state.data
    const expiry = state.expiry === undefined ? parts.expiry : state.expiry
    const signer = getStatementSigner(aliceSignerPubkey, 'sr25519', (payload) => aliceKey.sign(payload))
    const payload: SdkStatement = {
      topics: [...topics],
      ...(channel === null ? {} : { channel }),
      ...(data === null ? {} : { data }),
      ...(expiry === null ? {} : { expiry }),
    }
    const raw = yield* Effect.tryPromise({
      try: () => signer.sign(payload),
      catch: (cause) => new SignedStatementFixtureError({ reason: 'signing_failed', cause }),
    })
    if (raw.proof?.type !== 'sr25519') {
      return yield* Effect.fail(new SignedStatementFixtureError({ reason: 'unexpected_proof_type' }))
    }
    return {
      raw,
      data: data ?? new Uint8Array(0),
      topics,
      signerPubkey: aliceSignerPubkey,
      signature: raw.proof.value.signature,
      channel,
      expiry,
    }
  })

export const withTamperedSignature = (fixture: SignedStatementFixture): SignedStatementFixture => {
  const proof = fixture.raw.proof
  if (proof?.type !== 'sr25519') throw new SignedStatementFixtureError({ reason: 'unexpected_proof_type' })
  const flipped = (proof.value.signature.startsWith('0x01') ? '0x00' : '0x01') +
    proof.value.signature.slice(4) as `0x${string}`
  return {
    ...fixture,
    signature: flipped,
    raw: { ...fixture.raw, proof: { ...proof, value: { ...proof.value, signature: flipped } } },
  }
}

export const signedStatementOf = (
  overrides?: Partial<{
    topics: readonly `0x${string}`[]
    data: Uint8Array | null
    channel: `0x${string}` | null
    expiry: bigint | null
  }>,
): Effect.Effect<SignedStatementFixture, SignedStatementFixtureError, never> => {
  let builder = SignedStatementBuilder.fromLabel('legacy-default')
  if (overrides?.topics !== undefined) builder = builder.withTopics(overrides.topics)
  if (overrides?.data !== undefined) builder = builder.withData(overrides.data)
  if (overrides?.channel !== undefined) builder = builder.withChannel(overrides.channel)
  if (overrides?.expiry !== undefined) builder = builder.withExpiry(overrides.expiry)
  return builder.build()
}

export const signedStatementWithoutProof = (): Effect.Effect<SdkStatement, SignedStatementFixtureError, never> =>
  SignedStatementBuilder.fromLabel('legacy-without-proof').buildWithoutProof()

export const signedStatementWithExpiredExpiry = (): Effect.Effect<
  SignedStatementFixture,
  SignedStatementFixtureError,
  never
> => SignedStatementBuilder.fromLabel('legacy-expired').withExpiry(1n).build()

export const signedStatementWithoutTopics = (): Effect.Effect<SdkStatement, SignedStatementFixtureError, never> =>
  Effect.gen(function*() {
    const { getStatementSigner } = yield* Effect.promise(() => import('@novasamatech/sdk-statement'))
    const signer = getStatementSigner(aliceSignerPubkey, 'sr25519', (payload) => aliceKey.sign(payload))
    const { expiry } = deterministicFixtureParts('no-topics')
    const payload: SdkStatement = { topics: [], expiry }
    return yield* Effect.tryPromise({
      try: () => signer.sign(payload),
      catch: (cause) => new SignedStatementFixtureError({ reason: 'signing_failed', cause }),
    })
  })
