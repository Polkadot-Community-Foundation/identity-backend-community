#!/usr/bin/env bun
import { writeFileSync } from 'node:fs'
import { Pool } from 'pg'

const DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:password@localhost:15432/identity_backend'
const NETWORK = 'westend2'
const LIMIT = 21
const OUT = process.env.EXPLAIN_OUT || 'explain-search.json'
const TEXT_OUT = process.env.EXPLAIN_TEXT_OUT || 'explain-search.txt'

const pool = new Pool({ connectionString: DATABASE_URL, max: 2 })

const FULL_SCAN_ROWS = Number(process.env.EXPLAIN_FULL_SCAN_ROWS || '100000')
const SLOW_MS = Number(process.env.EXPLAIN_SLOW_MS || '1000')

interface ExplainSample {
  prefix: string
  bucket: string
  seqScan: boolean
  fullScan: boolean
  rowsRemovedByFilter: number
  scannedRelations: string[]
  indexesUsed: string[]
  planningMs: number | null
  executionMs: number | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const SEARCH_SQL = `SELECT * FROM polkadot_app.individuality_usernames
    WHERE network = $1
      AND (lower(coalesce(full_username, username || '.' || digits))) COLLATE "C" >= $2
      AND (lower(coalesce(full_username, username || '.' || digits))) COLLATE "C" < $3
    ORDER BY (lower(coalesce(full_username, username || '.' || digits))) COLLATE "C", username ASC, digits::integer ASC
    LIMIT $4`

function nextPrefixBound(lowered: string): string {
  return lowered.slice(0, -1) + String.fromCharCode(lowered.charCodeAt(lowered.length - 1) + 1)
}

function searchParams(prefix: string): [string, string, string, number] {
  const lower = prefix.toLowerCase()
  return [NETWORK, lower, nextPrefixBound(lower), LIMIT]
}

function walkPlan(node: unknown, onNode: (n: Record<string, unknown>) => void): void {
  if (!isRecord(node)) return
  onNode(node)
  const children = node['Plans']
  if (Array.isArray(children)) {
    for (const child of children) walkPlan(child, onNode)
  }
}

async function explainOne(client: import('pg').PoolClient, prefix: string, bucket: string): Promise<ExplainSample> {
  const result = await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${SEARCH_SQL}`, searchParams(prefix))
  const planRow = result.rows[0]
  const planArray = isRecord(planRow) ? planRow['QUERY PLAN'] : null
  const root = Array.isArray(planArray) && isRecord(planArray[0]) ? planArray[0] : {}
  const plan = isRecord(root['Plan']) ? root['Plan'] : {}

  const scannedRelations: string[] = []
  const indexesUsed: string[] = []
  let seqScan = false
  let rowsRemovedByFilter = 0
  walkPlan(plan, (n) => {
    const nodeType = n['Node Type']
    if (nodeType === 'Seq Scan') {
      seqScan = true
      if (typeof n['Relation Name'] === 'string') scannedRelations.push(n['Relation Name'])
    }
    if (typeof n['Index Name'] === 'string') indexesUsed.push(n['Index Name'])
    const removed = n['Rows Removed by Filter']
    if (typeof removed === 'number') rowsRemovedByFilter += removed
  })

  const planningMs = typeof root['Planning Time'] === 'number' ? root['Planning Time'] : null
  const executionMs = typeof root['Execution Time'] === 'number' ? root['Execution Time'] : null
  const fullScan = seqScan || rowsRemovedByFilter >= FULL_SCAN_ROWS || (executionMs !== null && executionMs >= SLOW_MS)

  return {
    prefix,
    bucket,
    seqScan,
    fullScan,
    rowsRemovedByFilter,
    scannedRelations,
    indexesUsed,
    planningMs,
    executionMs,
  }
}

async function explainText(client: import('pg').PoolClient, prefix: string): Promise<string> {
  const result = await client.query(`EXPLAIN (ANALYZE, BUFFERS) ${SEARCH_SQL}`, searchParams(prefix))
  return result.rows.map((r) => (isRecord(r) && typeof r['QUERY PLAN'] === 'string' ? r['QUERY PLAN'] : '')).join('\n')
}

async function pickPrefixes(client: import('pg').PoolClient): Promise<Array<{ prefix: string; bucket: string }>> {
  const cli = process.argv.slice(2).filter((a) => a !== '--')
  if (cli.length > 0) return cli.map((prefix) => ({ prefix, bucket: 'cli' }))

  const { rows } = await client.query<{ ch: string }>(
    `SELECT DISTINCT left(lower(username), 1) AS ch FROM polkadot_app.individuality_usernames
     WHERE network = $1 ORDER BY ch LIMIT 1`,
    [NETWORK],
  )
  const short = rows[0]?.ch ?? 'a'
  const { rows: med } = await client.query<{ p: string }>(
    `SELECT lower(username) AS p FROM polkadot_app.individuality_usernames
     WHERE network = $1 ORDER BY username LIMIT 1`,
    [NETWORK],
  )
  const medium = (med[0]?.p ?? 'abc').slice(0, 3)
  return [{ prefix: short, bucket: 'short' }, { prefix: medium, bucket: 'medium' }]
}

async function main() {
  const client = await pool.connect()
  try {
    const targets = await pickPrefixes(client)
    const samples: ExplainSample[] = []
    const textBlocks: string[] = []

    for (const { prefix, bucket } of targets) {
      const sample = await explainOne(client, prefix, bucket)
      samples.push(sample)
      textBlocks.push(`-- ${bucket} prefix ${JSON.stringify(prefix)}\n${await explainText(client, prefix)}`)
      console.log(
        `${bucket} "${prefix}%": ${sample.fullScan ? 'FULL SCAN' : 'fast'} ` +
          `exec=${sample.executionMs?.toFixed(1)}ms rowsFiltered=${sample.rowsRemovedByFilter} ` +
          `indexes=[${sample.indexesUsed.join(',')}]`,
      )
    }

    const anyFullScan = samples.some((s) => s.fullScan)
    const artifact = {
      generatedAt: new Date().toISOString(),
      network: NETWORK,
      verdict: anyFullScan ? 'full_scan' : 'ok',
      fullScanThresholdRows: FULL_SCAN_ROWS,
      slowMs: SLOW_MS,
      samples,
    }
    writeFileSync(OUT, `${JSON.stringify(artifact, null, 2)}\n`)
    writeFileSync(TEXT_OUT, `${textBlocks.join('\n\n')}\n`)
    console.log(`\nwrote ${OUT} (verdict=${artifact.verdict}) and ${TEXT_OUT}`)
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch((err) => {
  console.error('explain-search failed:', err)
  process.exit(1)
})
