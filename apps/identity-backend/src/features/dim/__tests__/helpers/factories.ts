import { sr25519 } from '@identity-backend/crypto'
import { Effect, Redacted } from 'effect'

export const generateTestTicket = Effect.gen(function*() {
  const keypair = yield* sr25519.generateKeypair()
  return { publicKey: keypair.publicKey, privateKey: Redacted.value(keypair.privateKey) }
})
