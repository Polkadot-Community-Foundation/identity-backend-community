import { FastCheck as fc } from 'effect'

const isCi = typeof process !== 'undefined' && process.env['CI'] === 'true'

fc.configureGlobal({ numRuns: isCi ? 1000 : 100 })
