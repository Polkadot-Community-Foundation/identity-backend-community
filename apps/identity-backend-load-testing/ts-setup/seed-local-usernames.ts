#!/usr/bin/env bun
import { once } from 'node:events'
import { writeFileSync } from 'node:fs'
import { finished } from 'node:stream/promises'
import { Pool } from 'pg'
import { from as copyFrom } from 'pg-copy-streams'
import { FIXTURE_PROFILES, type FixtureProfile, generateUsername, sampleSearchPrefixes } from './username-fixtures.js'

const COUNT = Math.min(
  Math.max(parseInt(process.argv.slice(2).find((a) => a !== '--') || '10000', 10), 1),
  5_000_000,
)
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:password@localhost:15432/identity_backend'
const NETWORK = 'westend2'
const PREFIX_SAMPLE_SIZE = 1024
const MANIFEST_PATH = process.env.PREFIX_MANIFEST || 'apps/identity-backend-load-testing/prefixes.json'
const ALLOW_PRODUCTION = process.env.SEED_ALLOW_PRODUCTION === '1'

export function looksLikeProductionUrl(databaseUrl: string): boolean {
  return /prod(uction)?[-._]?/i.test(databaseUrl)
}

function assertNotProduction(databaseUrl: string): void {
  if (looksLikeProductionUrl(databaseUrl) && !ALLOW_PRODUCTION) {
    console.error(
      `Refusing to seed: DATABASE_URL looks like a production target. ` +
        `Set SEED_ALLOW_PRODUCTION=1 to override (you almost certainly should not).`,
    )
    process.exit(1)
  }
}

function resolveProfile(): FixtureProfile {
  const requested = process.env.FIXTURE_PROFILE
  const found = FIXTURE_PROFILES.find((p) => p === requested)
  return found ?? 'zipf'
}

const PROFILE = resolveProfile()
const pool = new Pool({ connectionString: DATABASE_URL, max: 4 })

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

function row(index: number, signedAt: string): string {
  return [
    generateUsername(PROFILE, index),
    String(index).padStart(10, '0'),
    NETWORK,
    hex(index),
    hex(index),
    hex(index),
    hex(index + 1),
    hex(index),
    hex(index),
    signedAt,
  ].join('\t')
}

function writeManifest(): void {
  const prefixes = sampleSearchPrefixes(PROFILE, Math.min(PREFIX_SAMPLE_SIZE, COUNT))
  writeFileSync(
    MANIFEST_PATH,
    `${JSON.stringify({ profile: PROFILE, network: NETWORK, count: COUNT, prefixes }, null, 2)}\n`,
  )
  console.log(
    `wrote ${MANIFEST_PATH} — ${prefixes.short.length} short / ${prefixes.medium.length} medium / ${prefixes.full.length} full prefixes`,
  )
}

async function countExisting(client: import('pg').PoolClient): Promise<number> {
  const { rows: [{ count }] } = await client.query(
    'SELECT count(*) FROM polkadot_app.individuality_usernames WHERE network = $1',
    [NETWORK],
  )
  return Number(count)
}

async function assertProfileMatchesExisting(client: import('pg').PoolClient, existing: number): Promise<void> {
  if (existing === 0) return
  const probe = generateUsername(PROFILE, 0)
  const { rows } = await client.query(
    'SELECT 1 FROM polkadot_app.individuality_usernames WHERE network = $1 AND username = $2 LIMIT 1',
    [NETWORK, probe],
  )
  if (rows.length === 0) {
    console.error(
      `Existing ${existing} rows do not match profile "${PROFILE}" (probe username "${probe}" absent). ` +
        `Truncate polkadot_app.individuality_usernames for network ${NETWORK} before re-seeding with a new profile.`,
    )
    process.exit(1)
  }
}

async function seedViaStaging(client: import('pg').PoolClient, existing: number): Promise<void> {
  const startedAt = performance.now()
  const signedAt = new Date().toISOString()
  await client.query('BEGIN')
  try {
    await client.query(
      `CREATE TEMP TABLE _seed_staging ON COMMIT DROP AS
         SELECT ${COLUMNS.join(', ')} FROM polkadot_app.individuality_usernames WITH NO DATA`,
    )
    const stream = client.query(copyFrom(`COPY _seed_staging (${COLUMNS.join(', ')}) FROM STDIN`))
    for (let index = existing; index < COUNT; index++) {
      if (!stream.write(`${row(index, signedAt)}\n`)) await once(stream, 'drain')
    }
    stream.end()
    await finished(stream)
    await client.query(
      `INSERT INTO polkadot_app.individuality_usernames (${COLUMNS.join(', ')})
         SELECT ${COLUMNS.join(', ')} FROM _seed_staging
         ON CONFLICT DO NOTHING`,
    )
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  }
  console.log(`COPY + ON CONFLICT insert done in ${((performance.now() - startedAt) / 1000).toFixed(1)}s`)
}

async function main() {
  assertNotProduction(DATABASE_URL)
  const client = await pool.connect()
  try {
    const existing = await countExisting(client)
    await assertProfileMatchesExisting(client, existing)

    if (existing < COUNT) {
      console.log(`Seeding ${COUNT - existing} usernames (profile=${PROFILE}, target ${COUNT}) via COPY...`)
      await seedViaStaging(client, existing)
    } else {
      console.log(`Already have ${existing} records (requested ${COUNT}) — skipping COPY`)
    }

    console.log('Running ANALYZE so the planner sees the new distribution...')
    await client.query('ANALYZE polkadot_app.individuality_usernames')

    const total = await countExisting(client)
    console.log(`Total records: ${total}`)
    writeManifest()
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch((err) => {
  console.error('Seed failed:', err)
  process.exit(1)
})
