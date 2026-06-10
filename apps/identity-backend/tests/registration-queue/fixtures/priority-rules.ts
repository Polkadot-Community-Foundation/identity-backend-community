import { dotToPlanck } from '#root/schema/balance.js'
import { QueuePriorityRules } from '#root/username-registration/registration-queue/priority-group.schema.js'
import { Schema as S } from 'effect'

export const specQueuePriorityRules = S.decodeUnknownSync(QueuePriorityRules)({
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
})

export const nonSequentialQueuePriorityRules = S.decodeUnknownSync(QueuePriorityRules)({
  initialGroup: 10,
  balanceThresholds: [
    { group: 40, minBalance: dotToPlanck(1000n) },
    { group: 30, minBalance: dotToPlanck(100n) },
    { group: 20, minBalance: dotToPlanck(10n) },
  ],
  slots: [
    { id: 1, eligibleGroups: [40] },
    { id: 2, eligibleGroups: [40, 30] },
    { id: 3, eligibleGroups: [40, 30, 20] },
    { id: 4, eligibleGroups: [40, 30, 20, 10] },
  ],
})
