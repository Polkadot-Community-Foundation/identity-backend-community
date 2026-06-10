import { Pool } from 'pg'
import { BASES } from '../src/lib/usernames.js'

const COUNT = Math.min(Math.max(parseInt(process.argv[2] || '10000', 10), 1), 100000)
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:password@localhost:15432/identity_backend'
const NETWORK = 'westend2'

const pool = new Pool({ connectionString: DATABASE_URL, max: 10 })

const COLUMNS = [
  'username',
  'digits',
  'network',
  'candidate_account_id',
  'candidate_signature',
  'ring_vrf_key',
  'proof_of_ownership',
  'consumer_registration_signature',
  'identifier_key',
  'signed_at',
]

function hex(n: number): string {
  return `0x${n.toString(16).padStart(64, '0')}`
}

async function main() {
  const client = await pool.connect()
  try {
    const { rows: [{ count: existing }] } = await client.query(
      'SELECT count(*) FROM polkadot_app.individuality_usernames WHERE network = $1',
      [NETWORK],
    )

    if (Number(existing) >= COUNT) {
      console.log(`Already have ${existing} records (requested ${COUNT}) — nothing to seed`)
      return
    }

    const toInsert = COUNT - Number(existing)
    console.log(`Seeding ${toInsert} individuality_usernames records on network=${NETWORK}...`)

    const batchSize = 500
    let inserted = 0

    for (let start = Number(existing); start < COUNT; start += batchSize) {
      const end = Math.min(start + batchSize, COUNT)
      const rows: Array<Record<string, unknown>> = []

      for (let i = start; i < end; i++) {
        const base = BASES[i % BASES.length]!
        rows.push({
          username: base,
          digits: String(i).padStart(10, '0'),
          network: NETWORK,
          candidate_account_id: hex(i),
          candidate_signature: hex(i),
          ring_vrf_key: hex(i),
          proof_of_ownership: hex(i + 1),
          consumer_registration_signature: hex(i),
          identifier_key: hex(i),
          signed_at: new Date(),
        })
      }

      const placeholders = rows
        .map((_, ri) => `(${COLUMNS.map((_, ci) => `$${ri * COLUMNS.length + ci + 1}`).join(', ')})`)
        .join(', ')
      const values = rows.flatMap((r) => COLUMNS.map((c) => r[c]))

      await client.query(
        `INSERT INTO polkadot_app.individuality_usernames (${COLUMNS.join(', ')})
         VALUES ${placeholders}
         ON CONFLICT (username, network, digits) DO NOTHING`,
        values,
      )

      inserted += end - start
      console.log(`  ${inserted}/${toInsert} records inserted`)
    }

    const { rows: [{ count: total }] } = await client.query(
      'SELECT count(*) FROM polkadot_app.individuality_usernames WHERE network = $1',
      [NETWORK],
    )
    console.log(`Done. Total records: ${total}`)
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch((err) => {
  console.error('Seed failed:', err)
  process.exit(1)
})
