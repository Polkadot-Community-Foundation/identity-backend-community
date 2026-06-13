import { sr25519 } from '@identity-backend/crypto'
import { checkResponseWithBody } from '@identity-backend/testing/hono'
import { sha256 } from '@noble/hashes/sha2.js'
import { Effect } from 'effect'
import { hc } from 'hono/client'
import type { App } from 'identity-backend-container/v1'
import type { StartedDockerComposeEnvironment } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { setupTestEnvironment, teardownTestEnvironment } from '../setup.ts'

const concatBytes = (parts: readonly Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}

const toBase64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64')

interface VoucherHeaders {
  readonly 'Auth-ClientId': string
  readonly 'Auth-ClientProof': string
  readonly 'Auth-Challenge': string
  readonly 'Auth-Attestation-Type': 'voucher'
  readonly 'Auth-Voucher-Secret': string
}

const buildVoucherHeaders = async (secret: string): Promise<VoucherHeaders> => {
  const keypair = await Effect.runPromise(sr25519.generateKeypair())
  const challenge = crypto.getRandomValues(new Uint8Array(24))
  const bodyBytes = new TextEncoder().encode('{}')
  const clientDataHash = sha256(concatBytes([challenge, keypair.publicKey, sha256(bodyBytes)]))
  const clientProof = await Effect.runPromise(keypair.sign(clientDataHash))
  return {
    'Auth-ClientId': toBase64(keypair.publicKey),
    'Auth-ClientProof': toBase64(clientProof),
    'Auth-Challenge': toBase64(challenge),
    'Auth-Attestation-Type': 'voucher',
    'Auth-Voucher-Secret': secret,
  }
}

describe('E2E: Voucher redemption', () => {
  let environment: StartedDockerComposeEnvironment
  let app: ReturnType<typeof hc<App>>
  let baseUrl: string

  beforeAll(async () => {
    ;({ environment, app } = await setupTestEnvironment<App>({
      peopleNetwork: 'pop-testnet',
      DEBUG_VOUCHER_ENABLED: 'true',
    }))
    const port = environment.getContainer('web-1').getMappedPort(8080)
    baseUrl = `http://127.0.0.1:${port}`
  })

  afterAll(async () => {
    await teardownTestEnvironment(environment)
  })

  const mintVoucher = async (): Promise<{ secret: string; secretHash: string }> => {
    const res = await checkResponseWithBody(await fetch(`${baseUrl}/debug/voucher`, { method: 'POST' }), 200)
    return res.json() as Promise<{ secret: string; secretHash: string }>
  }

  const redeem = async (secret: string) =>
    app.api.v1.auth.token.$post({ header: await buildVoucherHeaders(secret), json: {} })

  it('Should_IssueTokenThenRejectReuse_When_VoucherIsMintedAndRedeemedTwice', async () => {
    const { secret, secretHash } = await mintVoucher()
    expect(secret).toMatch(/^[A-Za-z0-9+/]+=*$/)
    expect(secretHash).toMatch(/^[0-9a-f]{64}$/)

    const first = await checkResponseWithBody(await redeem(secret), 200)
    const tokens = await first.json()
    expect(typeof tokens.token).toBe('string')
    expect(tokens.token.length).toBeGreaterThan(0)
    expect(typeof tokens.refreshToken).toBe('string')
    expect(tokens.refreshToken.length).toBeGreaterThan(0)

    await checkResponseWithBody(await redeem(secret), 409)
  })

  it('Should_Reject_When_VoucherSecretIsUnregistered', async () => {
    const unknownSecret = toBase64(crypto.getRandomValues(new Uint8Array(32)))
    await checkResponseWithBody(await redeem(unknownSecret), 401)
  })
})
