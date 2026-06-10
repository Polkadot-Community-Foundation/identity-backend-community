import { dotToPlanck } from '#root/schema/balance.js'
import { Context, Schema as S } from 'effect'
import { QueuePriorityRules } from './priority-group.schema.js'

export class QueuePriorityConfig extends Context.Reference<QueuePriorityConfig>()('QueuePriorityConfig', {
  defaultValue: () =>
    S.decodeSync(QueuePriorityRules)({
      initialGroup: 1,
      balanceThresholds: [
        { group: 4, minBalance: dotToPlanck(1000n) },
        { group: 3, minBalance: dotToPlanck(100n) },
        { group: 2, minBalance: dotToPlanck(10n) },
      ],
      slots: [
        { id: 1, eligibleGroups: [4] },
        { id: 2, eligibleGroups: [4, 3] },
        { id: 3, eligibleGroups: [4, 3, 2] },
        { id: 4, eligibleGroups: [4, 3, 2, 1] },
      ],
    }),
}) {}
