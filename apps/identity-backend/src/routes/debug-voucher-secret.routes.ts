import { DEBUG_VOUCHER_ENABLED } from '#root/config.js'
import { VoucherSecretHash } from '#root/routes/v1/token/voucher-secret.schema.js'
import { insertVoucherSecret } from '#root/routes/v1/token/voucher-secret.store.js'
import { DB } from '@identity-backend/db'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { encodeBase64 } from '@std/encoding'
import { Effect, Runtime } from 'effect'
import { Hono } from 'hono'

const makeDisabledRoute = () => new Hono().post('/', (c) => c.notFound())

export const makeDebugVoucherSecretRoute = Effect.gen(function* makeDebugVoucherSecretRoute() {
  const enabled = yield* DEBUG_VOUCHER_ENABLED
  if (!enabled) return makeDisabledRoute()

  const runtime = yield* Effect.runtime<DB>()

  return new Hono().post('/', async (c) => {
    const secret = crypto.getRandomValues(new Uint8Array(32))
    const secretB64 = encodeBase64(secret)
    const secretHash = VoucherSecretHash.make(bytesToHex(sha256(secret)))

    await Runtime.runPromise(runtime)(insertVoucherSecret(secretHash))

    return c.json({ secret: secretB64, secretHash })
  })
})
