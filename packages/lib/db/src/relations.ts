import { defineRelations } from 'drizzle-orm'

import * as schema from './schema.js'

export const relations = defineRelations(schema, (r) => ({
  pushSubscription: {
    subscriptionRules: r.many.subscriptionRule({
      from: r.pushSubscription.id,
      to: r.subscriptionRule.subscriptionId,
    }),
    pushRecords: r.many.pushRecord({
      from: r.pushSubscription.id,
      to: r.pushRecord.subscriptionId,
    }),
    failedPushRecords: r.many.failedPushRecord({
      from: r.pushSubscription.id,
      to: r.failedPushRecord.subscriptionId,
    }),
  },
  subscriptionRule: {
    subscription: r.one.pushSubscription({
      from: r.subscriptionRule.subscriptionId,
      to: r.pushSubscription.id,
    }),
  },
  pushRecord: {
    subscription: r.one.pushSubscription({
      from: r.pushRecord.subscriptionId,
      to: r.pushSubscription.id,
    }),
  },
  failedPushRecord: {
    subscription: r.one.pushSubscription({
      from: r.failedPushRecord.subscriptionId,
      to: r.pushSubscription.id,
    }),
  },
}))

export type Relations = typeof relations
