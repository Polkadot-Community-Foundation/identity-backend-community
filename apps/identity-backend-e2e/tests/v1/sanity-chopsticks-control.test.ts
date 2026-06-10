import { sr25519CreateDerive } from '@polkadot-labs/hdkd'
import { mnemonicToMiniSecret, ss58Encode } from '@polkadot-labs/hdkd-helpers'
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { generateMnemonic, withPolkadotClient } from '../helpers.ts'
import { ALICE_ADDRESS, createAliceSigner } from './username-search.helpers.js'

function deriveAccountId(mnemonic: string): string {
  const miniSecret = mnemonicToMiniSecret(mnemonic, '')
  const derive = sr25519CreateDerive(miniSecret)
  const wallet = derive('//polkadot//0')
  return ss58Encode(wallet.publicKey)
}

describe('Chopsticks Control: transfer flow (no webserver)', () => {
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

  it('Should_TransferWithPersonSigner_When_NonceMatchesAccountNonce', async () => {
    const addr = deriveAccountId(generateMnemonic())

    await withPolkadotClient(wsEndpoint, async (api) => {
      const aliceAccount = await api.query.System.Account.getValue(ALICE_ADDRESS)
      const aliceNonce = Number(aliceAccount!.nonce)
      const personSigner = createAliceSigner(aliceNonce)

      const tx = api.tx.Balances.transfer_allow_death({
        dest: { type: 'Id', value: addr },
        value: 1_000_000_000_000_000_000n,
      })
      const result = await tx.signAndSubmit(personSigner)
      expect(result.txHash).toBeTruthy()
    })
  })
})
