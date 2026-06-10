import { InviterSignerService } from '#root/features/dim/inviter-signer.service.js'
import { Effect, Layer } from 'effect'
import type { PolkadotSigner } from 'polkadot-api'
import { vi } from 'vitest'

const makeFakeSignerService = Effect.sync(() => {
  const mockSigner = {
    publicKey: new Uint8Array(32),
    signBytes: vi.fn<PolkadotSigner['signBytes']>(async () => new Uint8Array(64)),
    signTx: vi.fn<PolkadotSigner['signTx']>(async () => new Uint8Array(64)),
  }
  return InviterSignerService.of({ getSigner: () => Effect.succeed(mockSigner) })
})

export const FakeInviterSignerServiceLayer = Layer.effect(InviterSignerService, makeFakeSignerService)
