import { DBTest } from '#root/db/drizzle.js'
import { DimTicketBlockchainService } from '#root/features/dim/dim-ticket-blockchain.service.js'
import { DimTicketConfig } from '#root/features/dim/dim-ticket.shell.js'
import { InviterSignerService } from '#root/features/dim/inviter-signer.service.js'
import { BatchRegistrationResult } from '@identity-backend/dim-ticket'
import { Effect, Layer } from 'effect'
import type { PolkadotSigner } from 'polkadot-api'
import { vi } from 'vitest'
import { TestTracingLive } from './tracing.js'

export const MOCK_INVITER = '5DAAnrj7VHTznn2AWBemMuyBwZWs6FNFjdyVXUeYum3PTXFy'
export const MOCK_BLOCK_HASH = '0xmockblockhash'
export const MOCK_BLOCK_NUMBER = 42

export const makeRegisterBatchMock = () => vi.fn<DimTicketBlockchainService['Type']['registerBatch']>()

export const makeCheckQuotaMock = () => vi.fn<DimTicketBlockchainService['Type']['checkQuota']>(() => Effect.succeed(5))

const mockSigner = {
  publicKey: new Uint8Array(32),
  signBytes: vi.fn<PolkadotSigner['signBytes']>(async () => new Uint8Array(64)),
  signTx: vi.fn<PolkadotSigner['signTx']>(async () => new Uint8Array(64)),
}

export const makeDimTicketInfraLayer = (
  registerBatch: ReturnType<typeof makeRegisterBatchMock>,
  checkQuota: ReturnType<typeof makeCheckQuotaMock> = makeCheckQuotaMock(),
) =>
  Layer.mergeAll(
    DBTest,
    Layer.succeed(DimTicketConfig, { inviterAddress: MOCK_INVITER }),
    Layer.succeed(DimTicketBlockchainService, DimTicketBlockchainService.of({ registerBatch, checkQuota })),
    Layer.succeed(InviterSignerService, InviterSignerService.of({ getSigner: () => Effect.succeed(mockSigner) })),
    TestTracingLive,
  )

export { BatchRegistrationResult }
