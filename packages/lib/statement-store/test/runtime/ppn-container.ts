import { previewnet_people } from '@identity-backend/descriptors'
import { fromObservable } from '@identity-backend/rx-effect'
import { logTxEvent, runTxFinalized, watchThroughReorgs } from '@identity-backend/tx-events'
import { Binary } from '@polkadot-api/substrate-bindings'
import { toHex } from '@polkadot-api/utils'
import { sr25519CreateDerive } from '@polkadot-labs/hdkd'
import { DEV_PHRASE, entropyToMiniSecret, mnemonicToEntropy, ss58Address } from '@polkadot-labs/hdkd-helpers'
import { Effect, pipe, Schema as S, Stream } from 'effect'
import { createClient } from 'polkadot-api'
import { getPolkadotSigner } from 'polkadot-api/signer'
import { getWsProvider } from 'polkadot-api/ws'
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers'
import { aliceSignerPubkey } from '../fixtures/signed-statement-builder.js'
import {
  grantAllowanceInclusionTimeout,
  grantAllowanceRpcTimeout,
  grantAllowanceTxFinalizationTimeout,
  ppnContainerStartupTimeoutMillis,
} from '../harness/timings.js'

export const PPN_IMAGE = process.env['PPN_IMAGE'] ?? 'paritytech/ppn:latest'
export const PEOPLE_WS_PORT = 10010
export const RELAY_RPC_PORT = 10000

const STATEMENT_ALLOWANCE_PREFIX = '0x3a73746174656d656e745f616c6c6f77616e63653a'
const ALICE_ALLOWANCE_KEY_HEX = `${STATEMENT_ALLOWANCE_PREFIX}${toHex(aliceSignerPubkey).slice(2)}`

const encodeStatementAllowance = (maxCount: number, maxSize: number): string => {
  const value = new Uint8Array(8)
  const dv = new DataView(value.buffer)
  dv.setUint32(0, maxCount, true)
  dv.setUint32(4, maxSize, true)
  return toHex(value)
}

export const startPpnContainer = async (): Promise<StartedTestContainer> => {
  const githubToken = process.env['GITHUB_TOKEN'] ?? process.env['GH_TOKEN']
  if (!githubToken) {
    throw new Error(
      'PPN container requires GITHUB_TOKEN. ' +
        'Run `export GITHUB_TOKEN=$(gh auth token)` before `pnpm test:ppn`. ' +
        'Or set PPN_WS_URL to point at an already-running PPN node.',
    )
  }
  return new GenericContainer(PPN_IMAGE)
    .withPlatform('linux/amd64')
    .withExposedPorts(RELAY_RPC_PORT, PEOPLE_WS_PORT)
    .withEnvironment({ EPHEMERAL: '1', GITHUB_TOKEN: githubToken })
    .withWaitStrategy(Wait.forLogMessage(/network is up/, 1))
    .withStartupTimeout(ppnContainerStartupTimeoutMillis)
    .start()
}

export class TxSubmitError extends S.TaggedError<TxSubmitError>()('TxSubmitError', {
  cause: S.Unknown,
}) {}

export class GrantAllowancePreconditionError
  extends S.TaggedError<GrantAllowancePreconditionError>()('GrantAllowancePreconditionError', {
    reason: S.String,
    wsUrl: S.String,
  })
{}

export class GrantAllowanceDispatchError
  extends S.TaggedError<GrantAllowanceDispatchError>()('GrantAllowanceDispatchError', {
    dispatchError: S.Unknown,
  })
{}

export const grantStatementAllowance = (wsUrl: string) =>
  Effect.gen(function*() {
    const client = createClient(getWsProvider(wsUrl))
    yield* Effect.addFinalizer(() => Effect.sync(() => client.destroy()))
    const api = client.getTypedApi(previewnet_people)

    const aliceKey = sr25519CreateDerive(entropyToMiniSecret(mnemonicToEntropy(DEV_PHRASE)))('//Alice')
    const ss58Prefix = yield* Effect.tryPromise({
      try: () => api.constants.System.SS58Prefix(),
      catch: (cause) => new TxSubmitError({ cause }),
    }).pipe(Effect.timeout(grantAllowanceRpcTimeout))
    const aliceAddress = ss58Address(aliceKey.publicKey, ss58Prefix)

    const sudoKey = yield* Effect.tryPromise({
      try: () => api.query.Sudo.Key.getValue(),
      catch: (cause) => new TxSubmitError({ cause }),
    }).pipe(Effect.timeout(grantAllowanceRpcTimeout))
    if (sudoKey !== aliceAddress) {
      return yield* new GrantAllowancePreconditionError({
        reason: `sudo key is ${sudoKey ?? '<none>'}, not dev-Alice ${aliceAddress};` +
          ` grantStatementAllowance requires //Alice as sudo (local PPN container).`,
        wsUrl,
      })
    }

    const aliceAccount = yield* Effect.tryPromise({
      try: () => api.query.System.Account.getValue(aliceAddress),
      catch: (cause) => new TxSubmitError({ cause }),
    }).pipe(Effect.timeout(grantAllowanceRpcTimeout))
    if (aliceAccount.data.free === 0n) {
      return yield* new GrantAllowancePreconditionError({
        reason: `dev-Alice ${aliceAddress} has zero balance`,
        wsUrl,
      })
    }
    yield* Effect.logInfo('grantStatementAllowance preflight ok').pipe(
      Effect.annotateLogs({ wsUrl, sudoKey, aliceFree: aliceAccount.data.free.toString() }),
    )

    const baseSigner = getPolkadotSigner(aliceKey.publicKey, 'Sr25519', aliceKey.sign)
    const signer = {
      publicKey: baseSigner.publicKey,
      signBytes: baseSigner.signBytes,
      signTx: (
        callData: Uint8Array,
        signedExtensions: Record<string, { value: Uint8Array; additionalSigned: Uint8Array }>,
        metadata: Uint8Array,
        atBlockNumber: number,
        hasher?: (data: Uint8Array) => Uint8Array,
      ) =>
        baseSigner.signTx(
          callData,
          {
            ...signedExtensions,
            VerifyMultiSignature: {
              identifier: 'VerifyMultiSignature',
              value: new Uint8Array([0]),
              additionalSigned: new Uint8Array([]),
            },
          },
          metadata,
          atBlockNumber,
          hasher,
        ),
    }

    const setStorageCall = api.tx.System.set_storage({
      items: [[Binary.fromHex(ALICE_ALLOWANCE_KEY_HEX), Binary.fromHex(encodeStatementAllowance(1000, 1024 * 1024))]],
    }).decodedCall
    const tx = api.tx.Sudo.sudo({ call: setStorageCall })

    const txResult = yield* pipe(
      Effect.sync(() => tx.signSubmitAndWatch(signer)),
      Effect.map(fromObservable((cause: unknown) => new TxSubmitError({ cause }))),
      Effect.andThen((stream) =>
        pipe(
          stream,
          Stream.tap(logTxEvent),
          watchThroughReorgs,
          runTxFinalized({
            inclusionTimeout: grantAllowanceInclusionTimeout,
            finalizationTimeout: grantAllowanceTxFinalizationTimeout,
          }),
        )
      ),
    )

    if (!txResult.ok) {
      return yield* new GrantAllowanceDispatchError({ dispatchError: txResult.dispatchError })
    }
  }).pipe(Effect.scoped)
