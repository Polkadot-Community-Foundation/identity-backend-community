import { getPolkadotSigner } from '@polkadot-api/signer'
import { sr25519CreateDerive } from '@polkadot-labs/hdkd'
import { mnemonicToMiniSecret, ss58Decode, ss58Encode } from '@polkadot-labs/hdkd-helpers'
import { Effect } from 'effect'
import { Binary } from 'polkadot-api'
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { sr25519 } from '@identity-backend/crypto'
import { getTransferClient } from '../helpers.js'
import { createInvitedSigner, setupGameInRegistrationPhase } from './invitation-ticket.helpers.js'

const INVITER_PUBLIC_KEY = 'd43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d'

describe('Chopsticks Control: Game sign_up_with_invite flow (no webserver)', () => {
  let container: StartedTestContainer
  let wsEndpoint: string

  beforeAll(async () => {
    container = await new GenericContainer('chopsticks:e2e-latest')
      .withEnvironment({ CONFIG_FILE: 'pop-testnet.json' })
      .withExposedPorts(8000)
      .withWaitStrategy(Wait.forHealthCheck())
      .withStartupTimeout(180_000)
      .start()

    const port = container.getMappedPort(8000)
    wsEndpoint = `ws://localhost:${port}`
  }, 180_000)

  afterAll(async () => {
    if (container) {
      await container.stop()
    }
  })

  it('Should_SignUpWithInvite_When_DirectTicketAndGameConfigured', async () => {
    const ticketKeypair = await Effect.runPromise(sr25519.generateKeypair())
    const ticketAddress = ss58Encode(ticketKeypair.publicKey, 42)

    const miniSecret = mnemonicToMiniSecret(
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
      '',
    )
    const derive = sr25519CreateDerive(miniSecret)
    const wallet = derive('//polkadot//0')
    const claimantAddress = ss58Encode(wallet.publicKey, 42)

    const [whoBytes] = ss58Decode(claimantAddress)
    const signature = await Effect.runPromise(ticketKeypair.sign(whoBytes))

    await setupGameInRegistrationPhase(wsEndpoint)

    const { client } = getTransferClient(wsEndpoint)
    await client._request('dev_setStorage', [
      {
        System: {
          Account: [
            [
              [claimantAddress],
              {
                nonce: 0,
                consumers: 0,
                providers: 1,
                sufficients: 0,
                data: {
                  free: '1000000000000000000',
                  reserved: '0',
                  frozen: '0',
                  flags: '0',
                },
              },
            ],
          ],
        },
        Game: {
          PendingInvites: [
            [
              ['5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY', ticketAddress],
              '0x',
            ],
          ],
        },
      },
    ])

    const { api } = getTransferClient(wsEndpoint)
    const baseSigner = getPolkadotSigner(wallet.publicKey, 'Sr25519', wallet.sign)
    const inviterBytes = new Uint8Array(INVITER_PUBLIC_KEY.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16)))
    const signer = createInvitedSigner(
      baseSigner,
      0,
      inviterBytes,
      ticketKeypair.publicKey,
      signature,
    )
    const tx = api.tx.Game.sign_up_with_invite({
      identifier_key: Binary.toHex(new Uint8Array(65).fill(0x42)),
      airdrop: undefined,
    })
    const result = await tx.signAndSubmit(signer)

    expect(result.ok, `Transaction failed: ${JSON.stringify(result.dispatchError)}`).toBe(true)
  }, 120_000)
})
