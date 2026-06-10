/**
 * @module dotns-sanity-proxy
 * @description E2E coverage of the reservation daemon's proxy-delegation
 * path on the Asset Hub `DotnsGateway` pallet. Mirrors the architecture
 * documented in {@link ./dotns-sanity.test.ts}: this module asserts
 * the **pallet layer** of `reserve_name` going through the `Proxy.proxy`
 * wrapper.
 *
 * Differences from the non-proxy module:
 *   - `PROXY_DELEGATION_ENABLED: 'true'` in the test environment so the
 *     daemon wraps the `reserve_name` batch in `Proxy.proxy(real: attester)`.
 *   - A `Proxy.Proxies` storage entry is pre-seeded in
 *     `docker/test/e2e/paseo-ah-next.json` (Alice → Bob, type `Any`).
 *   - `transferFunds` funds the candidate on Asset Hub (the proxy's real
 *     account pays the inclusion fee; the candidate must have nonce 0).
 *   - The test queries the finalized block for a `Proxy.ProxyExecuted`
 *     event, asserting the proxy wrapper reached the pallet.
 *
 * See {@link ./dotns-sanity.test.ts} for the full scope, "out of scope"
 * disclaimers, and encoding source of truth. The proxy-specific
 * additions are documented inline.
 */

import { previewnet_asset_hub } from '@identity-backend/descriptors'
import { checkResponse } from '@identity-backend/testing/hono'
import { Bytes, Option, Tuple } from '@polkadot-api/substrate-bindings'
import { sr25519CreateDerive } from '@polkadot-labs/hdkd'
import { mnemonicToMiniSecret, ss58Decode } from '@polkadot-labs/hdkd-helpers'
import { encodeHex } from 'effect/Encoding'
import { hc } from 'hono/client'
import type { App } from 'identity-backend-container/v1'
import { Binary, createClient } from 'polkadot-api'
import { getWsProvider } from 'polkadot-api/ws'

import type { StartedDockerComposeEnvironment } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  deriveLitePersonParams,
  formatParams,
  generateMnemonic,
  getEventsAtBlock,
  randomUsername,
  transferFunds,
} from '../helpers.ts'

import { setupTestEnvironment, teardownTestEnvironment } from '../setup.ts'

const ALICE_MNEMONIC = 'bottom drive obey lake curtain smoke basket hold race lonely fit walk'
const VERIFIER_ADDRESS = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY'

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
;(['pop-testnet'] as const).map((chain) => {
  return describe(`E2E: DotNS reservation daemon on ${chain} via proxy delegation`, () => {
    let environment: StartedDockerComposeEnvironment
    let app: ReturnType<typeof hc<App>>
    let chopsticksAssetHubPort: number

    beforeAll(async () => {
      ;({ environment, app, chopsticksAssetHubPort } = await setupTestEnvironment<App>({
        peopleNetwork: chain,
        DOTNS_GATEWAY_ENABLED: 'true',
        DOTNS_INTAKE_FRESHNESS_MAX_AGE_SECONDS: '230',
        DOTNS_SIGNED_AT_SAFETY_MARGIN_SECONDS: '10',
        PROXY_DELEGATION_ENABLED: 'true',
      }))
    })

    afterAll(async () => {
      await teardownTestEnvironment(environment)
    })

    it('Should_RecordAsAssigned_When_ProxyDelegationWrapsReserveName', async () => {
      const mnemonic = generateMnemonic()
      const baseUsername = randomUsername(7)
      const preferredDigits = '99'
      const liteLabel = `${baseUsername}.${preferredDigits}`

      const params = deriveLitePersonParams(mnemonic, baseUsername, VERIFIER_ADDRESS)
      await transferFunds(
        `ws://localhost:${chopsticksAssetHubPort}`,
        ALICE_MNEMONIC,
        params.candidateAccountId,
      )

      const ahWsEndpoint = `ws://localhost:${chopsticksAssetHubPort}`
      const client = createClient(getWsProvider(ahWsEndpoint))
      try {
        const api = client.getTypedApi(previewnet_asset_hub)
        const chainTimestampMs = await api.query.Timestamp.Now.getValue()
        const signedAt = Math.floor(Number(chainTimestampMs) / 1000)

        const dotnsSignature = buildDotnsSignature(
          mnemonic,
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
        checkResponse(response, 202)

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

        // The reservation must have been submitted through the proxy
        // (Alice → Bob, type `Any`), not via a direct extrinsic. The
        // `Proxy.ProxyExecuted` event on the finalized block is the
        // evidence the wrapper unwrapped to the right real account.
        const ahClient = createClient(getWsProvider(ahWsEndpoint))
        try {
          const finalizedHash = await ahClient._request<string>('chain_getFinalizedHead', [])
          expect(finalizedHash, 'finalized block hash').toBeTruthy()
          const events = await getEventsAtBlock(ahWsEndpoint, finalizedHash)
          const hasProxyExecuted = events.some(
            (e) => e.event.type === 'Proxy' && e.event.value.type === 'ProxyExecuted',
          )
          expect(hasProxyExecuted, 'Proxy.ProxyExecuted event must be on the finalized block').toBe(true)
        } finally {
          ahClient.destroy()
        }
      } finally {
        client.destroy()
      }
    }, 360_000)
  })
})
