import dotenv from 'dotenv'
import fs from 'node:fs'
import path from 'node:path'

const packageRoot = path.resolve(__dirname, '..')
const configTsPath = path.resolve(packageRoot, 'src/config.ts')
const envExamplePath = path.resolve(packageRoot, '.env.example')
const relativeEnvExamplePath = path.relative(packageRoot, envExamplePath) // Should just be '.env.example'

console.log(`Checking sync between ${relativeEnvExamplePath} and config.ts keys...`)

let envExampleContent: string
try {
  if (!fs.existsSync(envExamplePath)) {
    console.error(`❌ Error: ${relativeEnvExamplePath} not found in ${packageRoot}.`)
    process.exit(1)
  }
  envExampleContent = fs.readFileSync(envExamplePath, 'utf-8')
} catch (error: any) { // oxlint-disable-line typescript/no-explicit-any
  console.error(`❌ Error reading ${relativeEnvExamplePath}:`, error.message)
  process.exit(1)
}

const envKeys = new Set(Object.keys(dotenv.parse(envExampleContent)).filter(key => !key.startsWith('#')))

let configTsContent: string
try {
  if (!fs.existsSync(configTsPath)) {
    console.error(`❌ Error: src/config.ts not found in ${packageRoot}.`)
    process.exit(1)
  }
  configTsContent = fs.readFileSync(configTsPath, 'utf-8')
} catch (error: any) { // oxlint-disable-line typescript/no-explicit-any
  console.error(`❌ Error reading config.ts:`, error.message)
  process.exit(1)
}

const configEnvVars = new Set<string>()
const envVarPattern = [
  /Config\.(?:nonEmptyString|boolean|integer|number|string|duration|url)\s*\(\s*'([^']+)'\s*\)/g,
  /Config\.literal\([^)]*\)\s*\(\s*'([^']+)'\s*\)/g,
  /Config\.array\([^,]+,\s*'([^']+)'\s*\)/g,
]
let match: RegExpExecArray | null
for (const pattern of envVarPattern) {
  while ((match = pattern.exec(configTsContent)) !== null) {
    configEnvVars.add(match[1]!)
  }
}

const missingInEnv: string[] = []
const missingInConfig: string[] = []

for (const key of configEnvVars) {
  if (!envKeys.has(key)) {
    missingInEnv.push(key)
  }
}

for (const key of envKeys) {
  if (!configEnvVars.has(key)) {
    missingInConfig.push(key)
  }
}

let errorsFound = false

if (missingInEnv.length > 0) {
  console.error(`\n❌ Keys missing in ${relativeEnvExamplePath} (expected from config.ts):`)
  missingInEnv.forEach(key => console.error(`  - ${key}`))
  errorsFound = true
}

if (missingInConfig.length > 0) {
  console.error(`\n❌ Keys present in ${relativeEnvExamplePath} but not defined in config.ts:`)
  missingInConfig.forEach(key => console.error(`  - ${key}`))
  errorsFound = true
}

if (errorsFound) {
  console.error('\nPlease update the files to be in sync.')
  process.exit(1)
} else {
  console.log(`\n✅ ${relativeEnvExamplePath} and config.ts keys appear to be in sync.`)
  process.exit(0)
}
