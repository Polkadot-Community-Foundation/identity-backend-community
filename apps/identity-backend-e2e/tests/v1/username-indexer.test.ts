import { hc } from 'hono/client'
import type { App } from 'identity-backend-container/v1'
import type { StartedDockerComposeEnvironment } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { setupTestEnvironment, teardownTestEnvironment } from '../setup.js'
import {
  ALICE_ADDRESS,
  deriveLitePersonParams,
  formatParams,
  generateMnemonic,
  randomUsername,
  transferFundsBatch,
} from './username-search.helpers.js'

const ALICE_MNEMONIC = 'bottom drive obey lake curtain smoke basket hold race lonely fit walk'

const USER_COUNT = 3

type TestApp = ReturnType<typeof hc<App>>

interface UsernameData {
  candidateAccountId: string
  username: string
  status: 'RESERVED' | 'ASSIGNED' | 'FAILED'
  onchainData: {
    blockHash: string
    blockNumber: number
    blockIndex: number
    eventIndex?: number
  } | null
  createdAt: string
  updatedAt: string | null
}

interface NukeResult {
  success: boolean
  deletedCounts: { usernames: number; invitationTickets: number }
}

interface AdminNukeResponse {
  status: number
  body: NukeResult
}

interface RegistrationResult {
  candidateAccountId: string
  status: number
  username: string
}

function pollUntilAssigned(
  app: TestApp,
  username: string,
  timeout: number,
  interval: number,
): Promise<UsernameData | undefined> {
  return vi.waitUntil(
    async (): Promise<UsernameData | undefined> => {
      const response = await app.api.v1.usernames[':username'].$get({
        param: { username },
      })
      if (response.status !== 200) return undefined
      const d = (await response.json()) as UsernameData
      return d.status === 'ASSIGNED' ? d : undefined
    },
    { timeout, interval },
  )
}

async function waitForAssigned(
  app: TestApp,
  username: string,
  timeout: number,
  interval: number,
): Promise<UsernameData> {
  const data = await pollUntilAssigned(app, username, timeout, interval)
  if (data === undefined) {
    throw new Error(`Timed out waiting for username ${username} to become ASSIGNED`)
  }
  return data
}

async function nukeDatabase(adminUrl: string): Promise<AdminNukeResponse> {
  const adminUser = process.env.ADMIN_USERNAME ?? 'admin'
  const adminPassword = process.env.ADMIN_PASSWORD ?? 'admin'
  const auth = Buffer.from(`${adminUser}:${adminPassword}`).toString('base64')
  const response = await fetch(adminUrl, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}` },
  })
  return {
    status: response.status,
    body: (await response.json()) as NukeResult,
  }
}

function getIndexedUsername(indexedByUsername: ReadonlyMap<string, UsernameData>, username: string): UsernameData {
  const data = indexedByUsername.get(username)
  if (data === undefined) {
    throw new Error(`Missing pre-nuke indexed data for username ${username}`)
  }
  return data
}

describe('E2E: Username Indexer Reindex', () => {
  let environment: StartedDockerComposeEnvironment
  let app: TestApp
  let chopsticksPort: number
  let wsEndpoint: string
  let adminUrl: string

  beforeAll(async () => {
    ;({ environment, app, chopsticksPort } = await setupTestEnvironment<App>({
      peopleNetwork: 'pop-testnet',
      USERNAME_INDEXER_ENABLED: 'true',
      USERNAME_INDEXER_SYNC_INTERVAL_MS: '5000',
      ADMIN_ROUTE_ENABLED: 'true',
    }))
    wsEndpoint = `ws://localhost:${chopsticksPort}`

    const webPort = environment.getContainer('web-1').getMappedPort(8080)
    adminUrl = `http://127.0.0.1:${webPort}/admin/nuke`
  }, 300_000)

  afterAll(async () => {
    await teardownTestEnvironment(environment)
  })

  it('Should_ReindexAssignedUsernames_When_AdminNukeDeletesDatabaseRows', async () => {
    const testUsers = Array.from({ length: USER_COUNT }, () => ({
      mnemonic: generateMnemonic(),
      baseUsername: randomUsername(),
    }))

    const userParams = testUsers.map(({ mnemonic, baseUsername }) =>
      deriveLitePersonParams(mnemonic, baseUsername, ALICE_ADDRESS)
    )

    await transferFundsBatch(
      wsEndpoint,
      ALICE_MNEMONIC,
      userParams.map((p) => ({ toAddress: p.candidateAccountId })),
    )

    const registrations: RegistrationResult[] = []

    for (const params of userParams) {
      const response = await app.api.v1.usernames.$post({
        header: {},
        json: formatParams(params),
      })
      const { username } = (await response.json()) as { username: string }
      registrations.push({ candidateAccountId: params.candidateAccountId, status: response.status, username })
    }

    const registeredUsernames = registrations.map((r) => r.username)
    const initiallyIndexed = await Promise.all(
      registeredUsernames.map((username) => waitForAssigned(app, username, 180_000, 2_000)),
    )

    expect.soft(
      {
        registrations: registrations.map(({ candidateAccountId, status }) => ({ candidateAccountId, status })),
        registeredUsernames,
        indexed: initiallyIndexed.map(({ candidateAccountId, onchainData, status, username }) => ({
          candidateAccountId,
          hasOnchainData: onchainData !== null,
          status,
          username,
        })),
      },
      'registration plus initial indexing should create assigned usernames with matching account ids and on-chain data',
    ).toMatchObject({
      registrations: userParams.map(({ candidateAccountId }) => ({ candidateAccountId, status: 202 })),
      registeredUsernames: expect.arrayContaining(registrations.map((r) => r.username)),
      indexed: registrations.map(({ candidateAccountId, username }) => ({
        candidateAccountId,
        hasOnchainData: true,
        status: 'ASSIGNED',
        username,
      })),
    })

    const indexedBeforeNuke = new Map<string, UsernameData>()
    for (const data of initiallyIndexed) {
      indexedBeforeNuke.set(data.username, data)
    }

    const nukeResponse = await nukeDatabase(adminUrl)
    const reindexed = await Promise.all(
      registeredUsernames.map((username) => waitForAssigned(app, username, 180_000, 3_000)),
    )

    expect.soft(
      {
        nuke: {
          deletedAtLeastUserCount: nukeResponse.body.deletedCounts.usernames >= USER_COUNT,
          status: nukeResponse.status,
          success: nukeResponse.body.success,
        },
        reindexed: reindexed.map((record) => ({
          candidateAccountId: record.candidateAccountId,
          status: record.status,
          username: record.username,
        })),
      },
      'admin nuke should delete at least the scenario data and the indexer should restore the same assigned usernames',
    ).toMatchObject({
      nuke: {
        deletedAtLeastUserCount: true,
        status: 200,
        success: true,
      },
      reindexed: reindexed.map((record) => {
        const original = getIndexedUsername(indexedBeforeNuke, record.username)
        return {
          candidateAccountId: original.candidateAccountId,
          status: 'ASSIGNED',
          username: original.username,
        }
      }),
    })
  }, 360_000)
})
