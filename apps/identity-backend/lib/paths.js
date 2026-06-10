// @ts-check
import * as path from 'path'
import * as url from 'url'

/**
 * @type {string}
 */
export const migrationsFolder = path.join(url.fileURLToPath(import.meta.url), '../../drizzle/')
