import { execFileSync, execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createConnection } from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

function isPortOpen(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port, timeout: 1000 })
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
    socket.once('timeout', () => {
      socket.destroy()
      resolve(false)
    })
  })
}

function findMonorepoRoot(): string {
  let current = dirname(fileURLToPath(import.meta.url))
  while (current !== '/') {
    if (existsSync(join(current, 'pnpm-workspace.yaml')) || existsSync(join(current, '.git'))) {
      return current
    }
    current = dirname(current)
  }
  throw new Error('Could not find monorepo root')
}

async function ensureImagesBuilt(monorepoRoot: string) {
  const requiredImages = [
    process.env.TAG_APP_IDENTITY ?? 'identity-backend:e2e-latest',
    process.env.TAG_APP_E2E ?? 'identity-backend-startup:e2e-latest',
    process.env.TAG_CHOPSTICKS ?? 'chopsticks:e2e-latest',
  ]
  const missingImages = requiredImages.filter((image) => {
    try {
      execSync(`docker image inspect ${image}`, { stdio: 'ignore' })
      return false
    } catch {
      return true
    }
  })

  if (missingImages.length === 0) return

  console.log(`\n⚠️  Missing E2E Docker images: ${missingImages.join(', ')}`)
  console.log('Building images via build-local.sh (takes a few minutes on first run)...\n')

  execSync(`bash "${join(monorepoRoot, 'docker/test/e2e/build-local.sh')}"`, {
    stdio: 'inherit',
    cwd: monorepoRoot,
  })
}

const OTEL_COLLECTOR_CONTAINER = process.env.E2E_OTEL_CONTAINER ?? 'e2e-otel-collector'

function dumpOtelCollectorLogs() {
  try {
    const logs = execSync(`docker logs ${OTEL_COLLECTOR_CONTAINER} 2>&1 | tail -60`, { encoding: 'utf8' })
    console.error(`=== ${OTEL_COLLECTOR_CONTAINER} logs ===\n${logs}=== end ===`)
  } catch {
    console.error(`failed to read ${OTEL_COLLECTOR_CONTAINER} logs`)
  }
}

const OTEL_TRACES_VOLUME = process.env.E2E_OTEL_VOLUME ?? 'e2e-traces'
const TEST_NETWORK = process.env.E2E_TEST_NETWORK ?? 'test-network'

function isCollectorRunning(): boolean {
  try {
    const status = execSync(`docker inspect --format '{{.State.Status}}' ${OTEL_COLLECTOR_CONTAINER}`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return status === 'running'
  } catch {
    return false
  }
}

async function ensureOtelCollectorRunning(monorepoRoot: string) {
  if (process.env.OTEL_ENABLED !== 'true') return
  const hostPort = process.env.OTEL_COLLECTOR_HOST_PORT ?? '43188'

  if (isCollectorRunning() && (await isPortOpen('localhost', Number(hostPort)))) return

  const configPath = join(monorepoRoot, 'docker/test/e2e/otelcol-config.yml')
  const lockFile = process.env.E2E_OTEL_LOCKFILE ?? `/tmp/${OTEL_COLLECTOR_CONTAINER}.lock`
  const setupScript = [
    'set -eu',
    `if [ "$(docker inspect --format '{{.State.Status}}' ${OTEL_COLLECTOR_CONTAINER} 2>/dev/null)" = "running" ]; then exit 0; fi`,
    `docker rm -f ${OTEL_COLLECTOR_CONTAINER} >/dev/null 2>&1 || true`,
    `docker volume create ${OTEL_TRACES_VOLUME} >/dev/null`,
    // Under userns-remap, volume root is owned by 0:0; collector runs as uid 10001 and would EACCES. Pre-chown.
    `docker run --rm -v ${OTEL_TRACES_VOLUME}:/traces alpine chown 10001:10001 /traces`,
    `docker network inspect ${TEST_NETWORK} >/dev/null 2>&1 || docker network create ${TEST_NETWORK} >/dev/null`,
    `docker run -d --name ${OTEL_COLLECTOR_CONTAINER} ` +
    `--network ${TEST_NETWORK} ` +
    `-v "${configPath}:/etc/otelcol/config.yaml:ro" ` +
    `-v ${OTEL_TRACES_VOLUME}:/traces ` +
    `-p ${hostPort}:4318 ` +
    `otel/opentelemetry-collector-contrib:0.150.1 --config=/etc/otelcol/config.yaml`,
  ].join('\n')
  execFileSync('flock', [lockFile, 'bash', '-c', setupScript], { stdio: 'inherit' })
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (await isPortOpen('localhost', Number(hostPort))) {
      const status = execSync(`docker inspect --format '{{.State.Status}}' ${OTEL_COLLECTOR_CONTAINER}`, {
        encoding: 'utf8',
      }).trim()
      if (status !== 'running') {
        dumpOtelCollectorLogs()
        throw new Error(`OTEL collector exited before readiness (status=${status})`)
      }
      return
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  dumpOtelCollectorLogs()
  throw new Error(`OTEL collector did not bind :${hostPort} within 15s`)
}

async function ensureIntegreSQLRunning(monorepoRoot: string) {
  console.log('Starting IntegreSQL (postgres + integresql)...\n')
  const composeFile = join(monorepoRoot, 'docker/test/integration/docker-compose.yml')
  const projectFlag = process.env.E2E_INTEGRATION_PROJECT ? `-p "${process.env.E2E_INTEGRATION_PROJECT}"` : ''
  execSync(`docker compose ${projectFlag} -f "${composeFile}" up -d`, { stdio: 'inherit' })

  const integresqlPort = Number(process.env.E2E_INTEGRESQL_HOST_PORT ?? '5000')
  console.log(`Waiting for IntegreSQL to be ready on :${integresqlPort}...`)
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if (await isPortOpen('localhost', integresqlPort)) {
      console.log('✓ IntegreSQL is ready\n')
      return
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error(`IntegreSQL did not become ready within 60s on :${integresqlPort}`)
}

export async function setup() {
  const monorepoRoot = findMonorepoRoot()
  try {
    await Promise.all([
      ensureImagesBuilt(monorepoRoot),
      ensureIntegreSQLRunning(monorepoRoot),
      ensureOtelCollectorRunning(monorepoRoot),
    ])
  } catch (err) {
    throw new Error(
      `E2E global setup failed: ${(err as Error).message}\n` +
        `Make sure Docker is running, 'pnpm install' has been run, and docker buildx is available.`,
    )
  }
}
