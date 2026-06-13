#!/usr/bin/env node
import * as schema from '@identity-backend/db/Schema'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { encodeBase64 } from '@std/encoding'
import dotenv from 'dotenv'
import { drizzle } from 'drizzle-orm/postgres-js'
import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import postgres from 'postgres'
import QRCode from 'qrcode'

dotenv.config()

interface ProvisionedVoucher {
  readonly index: number
  readonly secretB64: string
  readonly secretHash: string
}

const makeVoucher = (index: number): ProvisionedVoucher => {
  const secret = crypto.getRandomValues(new Uint8Array(32))
  return { index, secretB64: encodeBase64(secret), secretHash: bytesToHex(sha256(secret)) }
}

const VOUCHER_DEEP_LINK_BASE = 'polkadotapp://invitation'
const voucherDeepLink = (secretB64: string): string =>
  `${VOUCHER_DEEP_LINK_BASE}?voucher=${encodeURIComponent(secretB64)}`

const main = async (): Promise<void> => {
  const { values } = parseArgs({
    options: {
      count: { type: 'string', default: '100' },
      'output-dir': { type: 'string', default: './vouchers' },
    },
  })

  const count = Number.parseInt(values.count, 10)
  if (!Number.isInteger(count) || count <= 0) {
    throw new Error(`--count must be a positive integer, got "${values.count}"`)
  }
  const outputDir = values['output-dir']

  const databaseUrl = process.env.DATABASE_URL
  if (databaseUrl === undefined || databaseUrl === '') {
    throw new Error('DATABASE_URL is required (set it in the environment or .env)')
  }

  fs.mkdirSync(outputDir, { recursive: true })
  const pad = String(count - 1).length

  const vouchers = Array.from({ length: count }, (_unused, i) => makeVoucher(i))

  // The QR encodes the app deep link carrying the plaintext secret; it is
  // written to disk only here.
  await Promise.all(
    vouchers.map((v) =>
      QRCode.toFile(
        path.join(outputDir, `voucher_${String(v.index).padStart(pad, '0')}.png`),
        voucherDeepLink(v.secretB64),
      )
    ),
  )

  const manifest = ['index,secret_hash', ...vouchers.map((v) => `${v.index},${v.secretHash}`)].join('\n')
  fs.writeFileSync(path.join(outputDir, 'manifest.csv'), `${manifest}\n`)

  const sql = postgres(databaseUrl)
  const db = drizzle({ client: sql, schema })
  try {
    await db.insert(schema.voucherSecrets).values(vouchers.map((v) => ({ secretHash: v.secretHash })))
  } finally {
    await sql.end()
  }

  console.log(
    `Provisioned ${count} vouchers → ${outputDir} (voucher_*.png + manifest.csv); hashes inserted into voucher_secrets.`,
  )
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
