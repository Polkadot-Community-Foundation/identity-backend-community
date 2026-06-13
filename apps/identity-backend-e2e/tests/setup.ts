import { IntegreSQLClient } from '@devoxa/integresql-client'
import dotenv from 'dotenv'
import { Match } from 'effect'
import type { Hono } from 'hono'
import { hc } from 'hono/client'
import { DockerComposeEnvironment, type StartedDockerComposeEnvironment, Wait } from 'testcontainers'

import { destroySharedClient } from './helpers.js'

dotenv.config()

/**
 * Alice's well-known dev account private key (PROXY).
 * WARNING: This is a publicly known test key - NEVER use in production!
 */
export const PROXY_PRIVATE_KEY =
  '98319d4ff8a9508c4bb0cf0b5a78d760a0b2082c02775e6e82370816fedfff48925a225d97aa00682d6a59b95b18780c10d7032336e88f3442b42361f4a66011'
/**
 * Alice's well-known dev account public key (ATTESTER).
 * WARNING: This is a publicly known test key - NEVER use in production!
 */
export const ATTESTER_PUBLIC_KEY = '0xd43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d'
/**
 * Bob's extended private key for proxy delegation signing.
 * WARNING: This is a publicly known test key - NEVER use in production!
 */
export const ATTESTER_PROXY_PRIVATE_KEY =
  '081ff694633e255136bdb456c20a5fc8fed21f8b964c11bb17ff534ce80ebd5941ae88f85d0c1bfc37be41c904e1dfc01de8c8067b0d6d5df25dd1ac0894a325'

export const VALID_PACKAGE_NAMES = [
  'io.polkadotapp.dev',
  'io.polkadotapp.staging',
  'io.polkadotapp.prod',
]

export const VALID_INTEGRITY_TOKENS = ['validToken1', 'validToken2', 'validToken3']

/**
 * HS256 secret the backend verifies bearer tokens against.
 * WARNING: This is a dev-only test secret - NEVER use in production!
 */
export const JWT_AUTH_SECRET = 'my-very-strong-random-jwt-secret'

export const integreSQL = new IntegreSQLClient({
  url: `http://localhost:${process.env.E2E_INTEGRESQL_HOST_PORT ?? '5000'}`,
})

export type SetupTestEnvironmentOptions = {
  peopleNetwork?: 'paseo-people-next' | 'pop-testnet'
  apiVersion?: 'v1'
  composeProfiles?: string[]
  REGISTER_USERNAME_BATCH_SIZE?: number
  REQUEST_SAMPLE_RATE?: string
  USERNAME_INDEXER_ENABLED?: string
  USERNAME_INDEXER_SYNC_INTERVAL_MS?: string
  DB_POOL_MAX?: string
  PROXY_DELEGATION_ENABLED?: string
  INVITATION_TICKET_DAEMON_ENABLED?: string
  ADMIN_ROUTE_ENABLED?: string
  DEBUG_VOUCHER_ENABLED?: string
  DOTNS_GATEWAY_ENABLED?: string
  DOTNS_INTAKE_FRESHNESS_MAX_AGE_SECONDS?: string
  DOTNS_SIGNED_AT_SAFETY_MARGIN_SECONDS?: string
  ASSET_HUB_RPC_ENDPOINTS?: string
  POC_ENABLED?: string
  POC_DIFFICULTY_BITS?: string
  EXPOSE_BUILD_INFO?: string
  APP_SERVICE?: string
  APP_VERSION?: string
  GIT_COMMIT?: string
  BUILD_TIME?: string
  DEPLOYMENT_ENVIRONMENT?: string
}

export interface TestEnvironmentOptions {
  USERNAME_INDEXER_ENABLED?: string
  USERNAME_INDEXER_SYNC_INTERVAL_MS?: string
  REGISTER_USERNAME_BATCH_SIZE?: string
  REQUEST_SAMPLE_RATE?: string
}

/* oxlint-disable typescript/no-explicit-any -- generic test env accepts any Hono app */
/**
 * Address that `DotnsGateway.DispatcherAddress` is set to in
 * `docker/test/e2e/paseo-ah-next.json`. The value is arbitrary — the
 * only requirement is that the address is non-null so the pallet's
 * `call_dispatcher` doesn't return `DispatcherAddressNotSet`. Chopsticks
 * has no PolkaVM executor, so the bytecode at this address is never
 * executed. The EVM call is a silent no-op that the pallet treats as a
 * successful contract return.
 */
export const TEST_DISPATCHER_ADDRESS = '0x41dd18f9f646da9b8bada37d2fc1d6e5160a4da3'

export async function setupTestEnvironment<T extends Hono<any, any, any>>(options: SetupTestEnvironmentOptions = {}) {
  const hash = await integreSQL.hashFiles(['drizzle/**/*'])
  await integreSQL.initializeTemplate(hash, async () => {})

  const databaseConfig = await integreSQL.getTestDatabase(hash)
  const connectionString = integreSQL.databaseConfigToConnectionUrl(databaseConfig)

  const peopleNetwork = options.peopleNetwork ?? 'paseo-people-next'
  const peopleRpcEndpoints = Match.value(peopleNetwork).pipe(
    Match.when('paseo-people-next', () => 'ws://chopsticks-people-paseo-next:8000'),
    Match.when('pop-testnet', () => 'ws://chopsticks_pop_testnet:8000'),
    Match.exhaustive,
  )

  // Map test network names to backend network values
  const backendNetwork = Match.value(peopleNetwork).pipe(
    Match.when('paseo-people-next', () => 'paseo' as const),
    Match.when('pop-testnet', () => 'paseo' as const),
    Match.exhaustive,
  )

  const chopsticksContainerName = Match.value(peopleNetwork).pipe(
    Match.when('paseo-people-next', () => 'chopsticks_people_paseo_next'),
    Match.when('pop-testnet', () => 'chopsticks_pop_testnet'),
    Match.exhaustive,
  )

  const composeProfiles = new Set(options.composeProfiles ?? [])
  const dotnsGatewayEnabled = options.DOTNS_GATEWAY_ENABLED ?? 'false'
  const assetHubRpcEndpoints = options.ASSET_HUB_RPC_ENDPOINTS ?? 'ws://chopsticks_asset_hub:8000'

  let composeEnvironment = new DockerComposeEnvironment('../../docker/test/e2e', 'docker-compose.yml')
    .withStartupTimeout(300_000)
    .withEnvironment({
      NODE_ENV: 'test',
      PEOPLE_NETWORK: backendNetwork,
      PEOPLE_RPC_ENDPOINTS: peopleRpcEndpoints,
      ASSET_HUB_RPC_ENDPOINTS: assetHubRpcEndpoints,
      DOTNS_GATEWAY_ENABLED: dotnsGatewayEnabled,
      ...(options.DOTNS_INTAKE_FRESHNESS_MAX_AGE_SECONDS
        ? { DOTNS_INTAKE_FRESHNESS_MAX_AGE_SECONDS: options.DOTNS_INTAKE_FRESHNESS_MAX_AGE_SECONDS }
        : {}),
      ...(options.DOTNS_SIGNED_AT_SAFETY_MARGIN_SECONDS
        ? { DOTNS_SIGNED_AT_SAFETY_MARGIN_SECONDS: options.DOTNS_SIGNED_AT_SAFETY_MARGIN_SECONDS }
        : {}),
      ATTESTER_PUBLIC_KEY,
      DATABASE_URL: connectionString,
      PROXY_PRIVATE_KEY,
      JWT_AUTH_SECRET: 'my-very-strong-random-jwt-secret',
      GOOGLE_CREDENTIALS:
        'ewogICJ0eXBlIjogInNlcnZpY2VfYWNjb3VudCIsCiAgInByb2plY3RfaWQiOiAiZXhhbXBsZSIsCiAgInByaXZhdGVfa2V5X2lk' +
        'IjogImV4YW1wbGUiLAogICJwcml2YXRlX2tleSI6ICItLS0tLUJFR0lOIFBSSVZBVEUgS0VZLS0tLS1cbk1JSUNkd0lCQURBTkJn' +
        'a3Foa2lHOXcwQkFRRUZBQVNDQW1Fd2dnSmRBZ0VBQW9HQkFNQTFoa25lRzlXZHdvcElcbmV3RFpra3RYSmlKL2R6eFR6b0lHK0Jm' +
        'S3JwUWVNMmsrR2dQdDQvcjVPWVFRWGNQcXRMK1JiUWxIVk1GYzIwQnZcbm9MMUdYa3JIbWREeExNSjNua1djbmg1c0FNNmpSYkk3' +
        'VGZiMDRUMUdpdS9kWVdYNjlYSWY1Mk5xVW5LUG1sSzBcbmJNQlV0b3NrOVNzRUwrT2gvellEeVI0MWZnRExBZ01CQUFFQ2dZQXQ3' +
        'OXpqWkprRWFjcm4zOEMrQ0VIRmpkT0lcblpTeHJGNkNBUlFnZ0w0bWZ6c1A4d0NIWmxJNXJHZ3RiKzhsZEhJZ01UTVpoZEZIV1VN' +
        'bjUwWFA2S0lvNkxPNnZcblpsemJ5ZC82WUdzUVUxdCtaeVpLS1pxYytuaE1NaEpDb3ZIUVAwMEJKYmJHT2JIT3JzbmlTNU5kenpw' +
        'RUFGYXBcblVoL0IrOHQ4UWNZL25lM1JtUUpCQU9lcEJlckx4WUM1MkhzUE5odmpWNGI0bTZVcXRsVVh5WlpJcFlVMEwwWnRcbjNl' +
        'Z0t5ZERhVS8xQlExcHd2WHN5b05ZSGgvSXFLd0pXbnd1UGFFNmJlNzBDUVFEVVoyR3JTY0t2YUFhdHlPSjhcbnphQ2xxY21uNUNk' +
        'ejRicUV1Z3lzbW9tSk5wWDg3UFlxYU5UVlFJSndzUzVNb0dwNFZYSGs0TlNZa3VacUw0V05cbmZiTW5Ba0FDamovTmRsQUllb1Jq' +
        'M3lnV3FLeG5oY2laeXQzV0ZId1oxMVZVSWQ0L3BhaWtEYkpxUm01VXhlcUxcblRlRVpRZGE2WmJ6Zk5BM2phYmM1ZG15TktYUDFB' +
        'a0VBaENHZng0K0dGZG9QdFpJdkd0Wk1KbUpkK1J4Y1VxRk1cbmgzNjVuYkl3OXZQSEVHVlVxWU0zUzBYckh6R0pqTStLRER1VE0z' +
        'K05vVEJaT0J0QjZJZ1dwd0pCQUlTK2prSk9cbjBMU2tweFVjVTNlTlR4ZExhQXM1TjAzRk1mR1hqZlFjanIzL0RCQWxnZUJFSXVz' +
        'emdYWEM3eGFGOUUyL3VlaVhcblpTZ3RsS0VSaU9GQ2ozbz1cbi0tLS0tRU5EIFBSSVZBVEUgS0VZLS0tLS0iLAogICJjbGllbnRf' +
        'ZW1haWwiOiAiZXhhbXBsZUBleGFtcGxlLmlhbS5nc2VydmljZWFjY291bnQuY29tIiwKICAiY2xpZW50X2lkIjogIjEwMDAwMDAw' +
        'MDAwMDAwMDAwMDAwMCIsCiAgImF1dGhfdXJpIjogImh0dHBzOi8vYWNjb3VudHMuZ29vZ2xlLmNvbS9vL29hdXRoMi9hdXRoIiwK' +
        'ICAidG9rZW5fdXJpIjogImh0dHBzOi8vb2F1dGgyLmdvb2dsZWFwaXMuY29tL3Rva2VuIiwKICAiYXV0aF9wcm92aWRlcl94NTA5' +
        'X2NlcnRfdXJsIjogImh0dHBzOi8vd3d3Lmdvb2dsZWFwaXMuY29tL29hdXRoMi92MS9jZXJ0cyIsCiAgImNsaWVudF94NTA5X2Nl' +
        'cnRfdXJsIjogImh0dHBzOi8vd3d3Lmdvb2dsZWFwaXMuY29tL3JvYm90L3YxL21ldGFkYXRhL3g1MDkvZXhhbXBsZSU0MGV4YW1w' +
        'bGUuaWFtLmdzZXJ2aWNlYWNjb3VudC5jb20iLAogICJ1bml2ZXJzZV9kb21haW4iOiAiZ29vZ2xlYXBpcy5jb20iCn0K',
      APN_PRIVATE_KEY:
        'LS0tLS1CRUdJTiBQUklWQVRFIEtFWS0tLS0tCk1JR0hBZ0VBTUJNR0J5cUdTTTQ5QWdFR0NDcUdTTTQ5QXdFSEJHMHdhd0lCQVFR' +
        'Z0EwV01Edjd0S3ZNZnVTZkwKZWk0citYNmRzZ1RyVWhrcE9EMWsxMUFkOGc2aFJBTkNBQVFmbHM2Yk11RGR0bFNmTURSa3VHNXFE' +
        'V3dGQWVHRgorUzBtczNjZFhXaGUzZGVleHp6OXlJbndLZWc0VnpkQ2EydHBuRm5tdmNDZW9lRDRlOVR5QzZaQQotLS0tLUVORCBQ' +
        'UklWQVRFIEtFWS0tLS0t',
      APN_KEY_ID: '0000000000',
      APN_TEAM_ID: 'AAAAAAAAAA',
      APN_TOPICS: 'io.example.app',
      ANDROID_PACKAGE_NAMES: 'io.pcf.polkadotapp',
      ANDROID_SIGNING_DIGEST_PLAYSTORE: 'a'.repeat(64),
      ANDROID_SIGNING_DIGEST_WEBSITE: 'b'.repeat(64),
      ANDROID_ATTESTATION_CRL_URL: 'http://127.0.0.1:1/attestation/status',
      ANDROID_ATTESTATION_CRL_CACHE_TTL: '1 hour',
      REQUEST_SAMPLE_RATE: options.REQUEST_SAMPLE_RATE ?? '0.0',
      FINALIZED_BLOCK_DAEMON_ENABLED: 'false',
      ENFORCE_AUTH: 'false',
      AUTH_ENABLED: 'false',
      REGISTER_USERNAME_BATCH_SIZE: options.REGISTER_USERNAME_BATCH_SIZE?.toString() ?? '100',
      ...(options.DB_POOL_MAX ? { DB_POOL_MAX: options.DB_POOL_MAX } : {}),
      // Indexer configuration - required for E2E tests
      USERNAME_INDEXER_ENABLED: options.USERNAME_INDEXER_ENABLED ?? 'false',
      USERNAME_INDEXER_SYNC_INTERVAL_MS: options.USERNAME_INDEXER_SYNC_INTERVAL_MS ?? '300000',
      PUSH_SUBSCRIPTIONS_INDEXER_ENABLED: 'false',
      INVITATION_TICKET_DAEMON_ENABLED: options.INVITATION_TICKET_DAEMON_ENABLED ?? 'false',
      POC_ENABLED: options.POC_ENABLED ?? 'false',
      POC_DIFFICULTY_BITS: options.POC_DIFFICULTY_BITS ?? '4',
      ADMIN_ROUTE_ENABLED: options.ADMIN_ROUTE_ENABLED ?? 'false',
      DEBUG_VOUCHER_ENABLED: options.DEBUG_VOUCHER_ENABLED ?? 'false',
      EXPOSE_BUILD_INFO: options.EXPOSE_BUILD_INFO ?? 'false',
      APP_SERVICE: options.APP_SERVICE ?? '',
      APP_VERSION: options.APP_VERSION ?? '',
      GIT_COMMIT: options.GIT_COMMIT ?? '',
      BUILD_TIME: options.BUILD_TIME ?? '',
      DEPLOYMENT_ENVIRONMENT: options.DEPLOYMENT_ENVIRONMENT ?? '',
      PROXY_DELEGATION_ENABLED: options.PROXY_DELEGATION_ENABLED ?? 'false',
      ATTESTER_PROXY_PRIVATE_KEY: options.PROXY_DELEGATION_ENABLED === 'true' ? ATTESTER_PROXY_PRIVATE_KEY : '',
      OTEL_SERVICE_NAME: 'identity-backend-web',
      OTEL_EXPORTER_OTLP_ENDPOINT: process.env.OTEL_ENABLED === 'true'
        ? `http://${process.env.E2E_OTEL_CONTAINER ?? 'e2e-otel-collector'}:4318`
        : '',
      OTEL_SPAN_PROCESSOR: 'simple',
      TURN_SECRET: 'dGVzdF9zZWNyZXRfZm9yX2UyZV90dXJuX2NvdHVybg==', // base64 of "test_secret_for_e2e_turn_coturn"
      TURN_AUTH_ALGORITHM: 'SHA1',
      TURN_TTL: '30 minutes',
      TURN_REALM: 'test-realm',
      ICE_SERVERS:
        'stun:coturn1:3478,turn:coturn1:3478?transport=udp,stun:coturn2:3478,turn:coturn2:3478?transport=udp,stun:coturn3:3478,turn:coturn3:3478?transport=udp',
    })
    .withWaitStrategy('web-1', Wait.forHealthCheck())
    .withWaitStrategy(`${chopsticksContainerName}-1`, Wait.forListeningPorts())
    .withWaitStrategy('chopsticks_asset_hub-1', Wait.forListeningPorts())

  if (composeProfiles.size > 0) {
    composeEnvironment = composeEnvironment.withProfiles(...composeProfiles)

    if (composeProfiles.has('turn')) {
      for (const coturn of ['coturn1-1', 'coturn2-1', 'coturn3-1']) {
        composeEnvironment = composeEnvironment.withWaitStrategy(
          coturn,
          Wait.forLogMessage(/INFO: Relay ports initialization done/, 1),
        )
      }
    }
  }

  const environment = await composeEnvironment.up()

  const port = environment.getContainer('web-1').getMappedPort(8080)
  const app = hc<T>(`http://127.0.0.1:${port}`)

  const chopsticksPort = environment.getContainer(`${chopsticksContainerName}-1`).getMappedPort(8000)
  const chopsticksAssetHubPort = environment.getContainer('chopsticks_asset_hub-1').getMappedPort(8000)

  return { environment, app, chopsticksPort, chopsticksAssetHubPort }
}

export async function teardownTestEnvironment(environment: StartedDockerComposeEnvironment | undefined) {
  destroySharedClient()
  if (environment) {
    await environment.down()
  }
}
