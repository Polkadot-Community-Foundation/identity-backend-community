import { configureGlobal } from 'fast-check'

if (process.env.CI) {
  configureGlobal({ numRuns: 1000 })
} else {
  configureGlobal({ numRuns: 100 })
}
