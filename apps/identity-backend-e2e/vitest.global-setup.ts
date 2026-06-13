import { execSync } from 'node:child_process'
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

async function ensureOtelCollectorRunning(monorepoRoot: string) {
  if (process.env.OTEL_ENABLED !== 'true') return
  if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) return

  const script = join(monorepoRoot, 'docker/test/e2e/otel-collector-up.sh')
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT = execSync(`bash "${script}"`, { encoding: 'utf8' }).trim()
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
