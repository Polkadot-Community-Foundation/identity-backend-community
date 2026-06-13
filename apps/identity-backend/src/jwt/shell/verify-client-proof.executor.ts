import { ClientProofVerificationFailedError } from '#root/jwt/core/jwt.types.js'
import { AuthService } from '@identity-backend/auth/services'
import { sr25519 } from '@identity-backend/crypto'
import { Effect, Schema as S } from 'effect'

export interface ClientProofInput {
  readonly clientId: Uint8Array
  readonly clientProof: Uint8Array
  readonly challenge: Uint8Array
  readonly body: Uint8Array
}

export const verifyClientProof = Effect.fn('jwt.verify_client_proof')(function*(
  input: ClientProofInput,
) {
  const authService = yield* AuthService

  const pubkey = yield* S.decodeUnknown(sr25519.PublicKey)(input.clientId).pipe(
    Effect.catchAll(() => Effect.fail(new ClientProofVerificationFailedError({}))),
  )

  const proofPayload = yield* authService.buildClientDataHash({
    payload: input.body,
    challenge: input.challenge,
    clientId: input.clientId,
  })

  const verifier = yield* sr25519.fromPublicKey({ publicKey: pubkey })
  const verified = yield* verifier.verify(proofPayload, input.clientProof).pipe(
    Effect.catchAll(() => Effect.fail(new ClientProofVerificationFailedError({}))),
  )

  if (!verified) {
    return yield* new ClientProofVerificationFailedError({})
  }
})
