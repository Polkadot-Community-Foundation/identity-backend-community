import fs from 'node:fs'
import path from 'node:path'

const packageRoot = path.resolve(__dirname, '..')
const repoRoot = path.resolve(packageRoot, '..', '..')
const composePath = path.resolve(repoRoot, 'docker/test/e2e/docker-compose.yml')
const envScriptPath = path.resolve(repoRoot, 'scripts/write-load-test-env.sh')

const rel = (p: string): string => path.relative(repoRoot, p)

function read(filePath: string): string {
  if (!fs.existsSync(filePath)) {
    console.error(`❌ Error: ${rel(filePath)} not found.`)
    process.exit(1)
  }
  return fs.readFileSync(filePath, 'utf-8')
}

console.log(`Checking that ${rel(envScriptPath)} provides every no-default compose boot var...`)

const compose = read(composePath)
const envScript = read(envScriptPath)

const COMPOSE_REF_WITHOUT_DEFAULT = /\$\{([A-Z_][A-Z0-9_]*)\}/g
const ENV_ASSIGNMENT = /^([A-Z_][A-Z0-9_]*)=/gm

const refsThatResolveToEmptyWhenUnset = new Set<string>()
for (const occurrence of compose.matchAll(COMPOSE_REF_WITHOUT_DEFAULT)) {
  refsThatResolveToEmptyWhenUnset.add(occurrence[1]!)
}

const providedByEnvScript = new Set<string>()
for (const assignment of envScript.matchAll(ENV_ASSIGNMENT)) {
  providedByEnvScript.add(assignment[1]!)
}

const unprovided = [...refsThatResolveToEmptyWhenUnset].filter((key) => !providedByEnvScript.has(key)).sort()

if (unprovided.length > 0) {
  console.error(
    `\n❌ ${rel(composePath)} passes these vars to the app with no compose default, but ${
      rel(envScriptPath)
    } never sets them. They reach the container empty and crash boot when a mandatory Config rejects them:`,
  )
  unprovided.forEach((key) => console.error(`  - ${key}`))
  console.error(
    `\nFix: set each in ${rel(envScriptPath)}, or give the compose reference a \${VAR:-default}.`,
  )
  process.exit(1)
}

console.log(
  `\n✅ All ${refsThatResolveToEmptyWhenUnset.size} no-default compose boot vars are provided by ${
    rel(envScriptPath)
  }.`,
)
process.exit(0)
