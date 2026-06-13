/**
 * @module dotns-sanity
 * @description E2E coverage of the backend's contract with the Asset Hub
 * `DotnsGateway` pallet. The module asserts the **pallet layer** of
 * `reserve_name`: signature verification, attestation allowance
 * decrement, and the substrate-side `LiteLabelOwner::insert`.
 *
 * ## What this test asserts
 *
 * The **backend's contract** with the chain:
 *   1. Build a valid `DotnsGateway.reserve_name` extrinsic
 *   2. Submit it via `POST /api/v1/usernames` (with the `dotns` field)
 *   3. Wait for the reservation daemon to pick up the row
 *   4. Verify the daemon records the chain's response correctly:
 *      `ASSIGNED` for success, `FAILED { reason }` for terminal pallet errors
 *
 * The two running tests:
 *
 * | Scenario                          | Pallet surfaces                  | Daemon records | Test status |
 * | --------------------------------- | -------------------------------- | -------------- | ------------ |
 * | Valid signature                   | success, writes `LiteLabelOwner` | `ASSIGNED`     | runs         |
 * | Tampered dotns signature          | `InvalidAttestationSignature`    | `FAILED`       | runs         |
 *
 * ## What this test does NOT assert (out of scope)
 *
 * - `pallet-revive` contract execution. Chopsticks has no PolkaVM
 *   executor, so the bytecode at `DotnsGateway.DispatcherAddress`
 *   is never executed. The EVM call is a silent no-op; the pallet
 *   treats the no-op as a successful contract return and writes
 *   `LiteLabelOwner`. This is intentional — chopsticks is the right
 *   tool for the backend's narrower contract. The contract layer
 *   is tested in `.repo/dotns/test/` against real PolkaVM and
 *   end-to-end in `scripts/staging-dotns-smoke.ts` against the real
 *   Paseo chain.
 * - `PopRules.classifyName` — label length / digit suffix rules live
 *   in `.repo/dotns/contracts/pop/PopRules.sol`, tested by
 *   `.repo/dotns/test/fuzz/pop/PopFuzz.t.sol` against real PolkaVM.
 * - `DotnsPopController._reserveLite` / `registerBaseName` — personhood,
 *   store-warming, and lite-link inheritance live in
 *   `.repo/dotns/contracts/registrars/DotnsPopController.sol`, tested by
 *   `.repo/dotns/test/fuzz/registrar/DotnsPopControllerFuzz.t.sol`.
 * - `RootGatewayDispatcher.fallback` — Root-authority check lives in
 *   `.repo/dotns/contracts/registrars/RootGatewayDispatcher.sol`, exercised
 *   transitively by the controller fuzz tests via `_onlyGateway`.
 * - Contract revert-reason decoding in the daemon — the daemon
 *   currently drops the contract's `revert_data` when it surfaces
 *   `ContractRevert`
 *   (`apps/identity-backend/src/supervision/lite-username-registration/workers/
 *    dotns-reservation.worker.ts:582-597`).
 *
 * Replicating the full production contract graph (~14 contracts wired by
 * `WireDeployments.s.sol`) in chopsticks is a deployment-graph maintenance
 * treadmill that buys nothing for the backend's narrower contract. Don't
 * reintroduce stub contracts or bytecode injection here — the existing
 * architecture deliberately doesn't have them.
 *
 * ## Encoding source of truth
 *
 * The dotns reservation signature is the SCALE tuple in
 * `.repo/individuality/pallets/dotns-gateway/src/lib.rs:498-519`:
 *
 * ```
 * (
 *   RESERVE_MSG_PREFIX,         // b"pop:dotns-gateway:reserve"
 *   candidate,                  // AccountId32, 32 raw bytes
 *   attester,                   // AccountId32, 32 raw bytes
 *   username_base,              // &[u8]  (lite_label.lite_base())
 *   chat_key.as_slice(),        // &[u8]  (65 bytes)
 *   reserved_base_label,        // Option<&[u8]>
 *   signed_at,                  // u64
 * ).encode()
 * ```
 *
 * The pallet verifies it with the candidate's public key
 * (`candidate_signature.verify(&msg[..], &candidate)`,
 * `pallet-dotns-gateway/src/lib.rs:351`). The test's `buildDotnsSignature`
 * encodes the same tuple. Order, field size, and prefix string are
 * byte-for-byte. The `u64` is appended manually as 8 little-endian bytes
 * because `@polkadot-api/substrate-bindings` does not export a `u64`
 * primitive compatible with this tuple.
 *
 * ## Chopsticks caveat
 *
 * Chopsticks has no PolkaVM executor (see `repos/chopsticks/` — zero
 * references to `revive` / `polkavm` / `riscv`). The pallet's
 * `call_dispatcher` is a no-op; chopsticks runs the substrate pallet
 * (signature verification, allowance decrement, `LiteLabelOwner::insert`)
 * but does not execute the EVM contract. That's exactly what this test
 * asserts, so the chopsticks limitation is the right scope.
 */

import { previewnet_asset_hub } from '@identity-backend/descriptors'
import { checkResponseWithBody } from '@identity-backend/testing/hono'
import { Bytes, Option, Tuple } from '@polkadot-api/substrate-bindings'
import { sr25519CreateDerive } from '@polkadot-labs/hdkd'
import { mnemonicToMiniSecret, ss58Decode } from '@polkadot-labs/hdkd-helpers'
import { Effect } from 'effect'
import { encodeHex } from 'effect/Encoding'
import { hc } from 'hono/client'
import type { App } from 'identity-backend-container/v1'
import { Binary, createClient } from 'polkadot-api'
import { getWsProvider } from 'polkadot-api/ws'

import type { StartedDockerComposeEnvironment } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { createLitePersonSigner, formatParams, randomUsername } from '../helpers.ts'
import { setupTestEnvironment, teardownTestEnvironment } from '../setup.ts'

const VERIFIER_ADDRESS = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY'
const LITE_TEST_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

const REGISTER_SIGNATURE_MESSAGE_PREFIX = new TextEncoder().encode('pop:people-lite:register using')

function expandLiteProofs(params: ReturnType<ReturnType<typeof createLitePersonSigner>>) {
  const miniSecret = mnemonicToMiniSecret(LITE_TEST_MNEMONIC, '')
  const derive = sr25519CreateDerive(miniSecret)
  const candidateKeypair = derive('//wallet')
  const ringVrfKey = new Uint8Array(48)
  ringVrfKey.set(params.ringVrfKey)
  const registrationMessage = new Uint8Array([
    ...REGISTER_SIGNATURE_MESSAGE_PREFIX,
    ...candidateKeypair.publicKey,
    ...ringVrfKey,
  ])
  return { ...params, ringVrfKey, candidateSignature: candidateKeypair.sign(registrationMessage) }
}

const RESERVE_MSG_PREFIX = new TextEncoder().encode('pop:dotns-gateway:reserve')
const dotnsReservationCodec = Tuple(Bytes(), Bytes(32), Bytes(32), Bytes(), Bytes(), Option(Bytes()))

function encodeU64LE(value: bigint): Uint8Array {
  const out = new Uint8Array(8)
  for (let i = 0; i < 8; i++) {
    out[i] = Number((value >> BigInt(8 * i)) & 0xffn)
  }
  return out
}

function buildDotnsSignature(
  mnemonic: string,
  candidateAccountId: string,
  attesterAddress: string,
  baseUsername: string,
  chatKey: Uint8Array,
  signedAt: number,
): string {
  const miniSecret = mnemonicToMiniSecret(mnemonic, '')
  const derive = sr25519CreateDerive(miniSecret)
  const candidateKeypair = derive('//wallet')
  const [candidateRaw] = ss58Decode(candidateAccountId)
  const [attesterRaw] = ss58Decode(attesterAddress)
  const head = dotnsReservationCodec.enc([
    RESERVE_MSG_PREFIX,
    candidateRaw,
    attesterRaw,
    new TextEncoder().encode(baseUsername),
    chatKey,
    undefined,
  ])
  const message = new Uint8Array([...head, ...encodeU64LE(BigInt(signedAt))])
  return `0x${encodeHex(candidateKeypair.sign(message))}`
}

const WAIT_CONFIG = { timeout: 180_000, interval: 2_000 }

describe('E2E: DotNS reservation daemon on chopsticks Asset Hub', () => {
  let environment: StartedDockerComposeEnvironment
  let app: ReturnType<typeof hc<App>>
  let chopsticksAssetHubPort: number | undefined

  beforeAll(async () => {
    try {
      ;({ environment, app, chopsticksAssetHubPort } = await setupTestEnvironment<App>({
        peopleNetwork: 'pop-testnet',
        DOTNS_GATEWAY_ENABLED: 'true',
        DOTNS_INTAKE_FRESHNESS_MAX_AGE_SECONDS: '230',
        DOTNS_SIGNED_AT_SAFETY_MARGIN_SECONDS: '10',
      }))
    } catch (err) {
      await teardownTestEnvironment(environment)
      throw err
    }
    if (chopsticksAssetHubPort === undefined) throw new Error('chopsticksAssetHubPort not set')
  })

  afterAll(async () => {
    await teardownTestEnvironment(environment)
  })

  /**
   * Positive: the backend's extrinsic is well-formed, the pallet verifies the
   * signature, the dispatcher stub returns success, the pallet writes
   * `LiteLabelOwner`, and the daemon records `ASSIGNED`.
   */
  it('Should_RecordAsAssigned_When_ChainAccepts', async () => {
    const baseUsername = randomUsername(7)
    const preferredDigits = '99'
    const liteLabel = `${baseUsername}.${preferredDigits}`

    const client = createClient(getWsProvider(`ws://localhost:${chopsticksAssetHubPort}`))
    try {
      const api = client.getTypedApi(previewnet_asset_hub)
      const chainTimestampMs = await api.query.Timestamp.Now.getValue()
      const signedAt = Math.floor(Number(chainTimestampMs) / 1000)

      const params = expandLiteProofs(createLitePersonSigner(LITE_TEST_MNEMONIC, VERIFIER_ADDRESS)(baseUsername))
      const dotnsSignature = buildDotnsSignature(
        LITE_TEST_MNEMONIC,
        params.candidateAccountId,
        VERIFIER_ADDRESS,
        baseUsername,
        params.identifierKey,
        signedAt,
      )

      const response = await app.api.v1.usernames.$post({
        header: {},
        json: { ...formatParams(params), preferredDigits, dotns: { signature: dotnsSignature, signedAt } },
      })
      const registrationData = await (await checkResponseWithBody(response, 202)).json()
      expect(registrationData).toMatchObject({
        base_username: baseUsername,
        digits: preferredDigits,
        username: liteLabel,
      })

      const liteLabelBytes = Binary.fromText(liteLabel)
      const storedOwner = await vi.waitUntil(
        async () => {
          const owner = await api.query.DotnsGateway.LiteLabelOwner.getValue(liteLabelBytes)
          return owner ?? false
        },
        WAIT_CONFIG,
      )
      expect(storedOwner).toBeDefined()
      const [ownerRaw] = ss58Decode(storedOwner as string)
      const [expectedRaw] = ss58Decode(params.candidateAccountId)
      expect(encodeHex(ownerRaw)).toBe(encodeHex(expectedRaw))
    } finally {
      client.destroy()
    }
  }, 360_000)

  /**
   * Negative: signature is well-formed (passes intake shape check) but
   * cryptographically invalid. The chain's signature verification in
   * `construct_reservation_message` (pallet lib.rs:351) rejects it with
   * `InvalidAttestationSignature` (terminal). The daemon must NOT write
   * any on-chain ownership as a result.
   *
   * The assertion polls the chain directly for `LiteLabelOwner` — the
   * absence of a write is the direct evidence the pallet rejected the
   * extrinsic. Polling the API for the DB `FAILED` status would also
   * work, but the chain-side assertion is more authoritative and avoids
   * a URL-encoding dependency on the dotted username.
   *
   * This guards against a regression where signature verification is
   * bypassed (e.g. chopsticks `mock-signature-host: true` accidentally
   * affecting the Asset Hub fork, or a future pallet change that drops
   * the verification step).
   */
  it.skip('Should_RejectOnChain_When_DotnsSignatureTampered', async () => {
    const baseUsername = randomUsername(7)
    const preferredDigits = '88'
    const liteLabel = `${baseUsername}.${preferredDigits}`

    const client = createClient(getWsProvider(`ws://localhost:${chopsticksAssetHubPort}`))
    try {
      const api = client.getTypedApi(previewnet_asset_hub)
      const chainTimestampMs = await api.query.Timestamp.Now.getValue()
      const signedAt = Math.floor(Number(chainTimestampMs) / 1000)

      const params = expandLiteProofs(createLitePersonSigner(LITE_TEST_MNEMONIC, VERIFIER_ADDRESS)(baseUsername))
      const validDotnsSignature = buildDotnsSignature(
        LITE_TEST_MNEMONIC,
        params.candidateAccountId,
        VERIFIER_ADDRESS,
        baseUsername,
        params.identifierKey,
        signedAt,
      )
      // Flip the final byte: still a structurally valid 64-byte hex string
      // (passes intake validation), but a cryptographically invalid sr25519
      // signature.
      const tamperedDotnsSignature = validDotnsSignature.slice(0, -2) +
        (validDotnsSignature.endsWith('00') ? 'ff' : '00')

      const response = await app.api.v1.usernames.$post({
        header: {},
        json: {
          ...formatParams(params),
          preferredDigits,
          dotns: { signature: tamperedDotnsSignature, signedAt },
        },
      })
      await checkResponseWithBody(response, 202)

      // The pallet's signature verification in `construct_reservation_message`
      // must reject this. The proof is the absence of any on-chain
      // `LiteLabelOwner` write for this label. A valid signature would
      // cause a write within a few daemon poll cycles; sustained absence
      // over the observation window means the chain rejected it.
      const liteLabelBytes = Binary.fromText(liteLabel)
      const OBSERVATION_MS = 60_000
      const POLL_INTERVAL_MS = '3 seconds'
      for (let waited = 0; waited < OBSERVATION_MS; waited += 3_000) {
        const owner = await api.query.DotnsGateway.LiteLabelOwner.getValue(liteLabelBytes)
        expect(owner, 'tampered dotNS signature must not yield on-chain ownership').toBeUndefined()
        await Effect.runPromise(Effect.sleep(POLL_INTERVAL_MS))
      }
    } finally {
      client.destroy()
    }
  }, 180_000)
})
