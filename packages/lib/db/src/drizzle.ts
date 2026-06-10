import { Context } from 'effect'

import type { PgAsyncDatabase } from 'drizzle-orm/pg-core/async/db'
import type { Relations } from './relations.js'
import * as schema from './schema.js'

export namespace DB {
  // oxlint-disable-next-line typescript/no-explicit-any
  export type DB = PgAsyncDatabase<any, typeof schema, Relations>
}

export class DB extends Context.Tag('DB')<DB, DB.DB>() {}
