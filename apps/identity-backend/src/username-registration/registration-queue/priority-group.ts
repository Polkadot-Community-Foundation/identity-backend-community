import { HashSet as H, Option as O } from 'effect'
import type { QueueEntryId } from './entry.schema.js'
import type { PriorityGroup, PrioritySlotId, PriorityThreshold, QueuePriorityRules } from './priority-group.schema.js'

type PriorityGroupInput = {
  readonly id: QueueEntryId
  readonly currentGroup: PriorityGroup
  readonly balance: bigint
}

type PriorityGroupUpdate = {
  readonly id: QueueEntryId
  readonly priorityGroup: PriorityGroup
}

type QueuedEntryPriorityInput = {
  readonly id: QueueEntryId
  readonly priorityGroup: PriorityGroup
  readonly enqueuedAt: Date
}

const priorityGroupForBalance = (
  balance: bigint,
  sortedThresholds: ReadonlyArray<PriorityThreshold>,
  fallback: PriorityGroup,
): PriorityGroup => {
  for (const threshold of sortedThresholds) {
    if (balance >= threshold.minBalance) return threshold.group
  }
  return fallback
}

export const buildPriorityOrder = (slots: QueuePriorityRules['slots']): Map<PriorityGroup, number> => {
  const order = new Map<PriorityGroup, number>()
  for (const { eligibleGroups } of slots) {
    for (const group of H.values(eligibleGroups)) {
      if (!order.has(group)) {
        order.set(group, order.size)
      }
    }
  }
  return order
}

const byPriorityImpl = (
  order: Map<PriorityGroup, number>,
  left: QueuedEntryPriorityInput,
  right: QueuedEntryPriorityInput,
): number => {
  const lp = order.get(left.priorityGroup) ?? Number.MAX_SAFE_INTEGER
  const rp = order.get(right.priorityGroup) ?? Number.MAX_SAFE_INTEGER
  if (lp !== rp) return lp - rp
  return left.enqueuedAt.getTime() - right.enqueuedAt.getTime()
}

export const byPriority: {
  (order: Map<PriorityGroup, number>): (left: QueuedEntryPriorityInput, right: QueuedEntryPriorityInput) => number
  (order: Map<PriorityGroup, number>, left: QueuedEntryPriorityInput, right: QueuedEntryPriorityInput): number
} = ((
  order: Map<PriorityGroup, number>,
  left?: QueuedEntryPriorityInput,
  right?: QueuedEntryPriorityInput,
): number | ((left: QueuedEntryPriorityInput, right: QueuedEntryPriorityInput) => number) => {
  if (left !== undefined && right !== undefined) {
    return byPriorityImpl(order, left, right)
  }
  return (l: QueuedEntryPriorityInput, r: QueuedEntryPriorityInput) => byPriorityImpl(order, l, r)
}) as {
  (order: Map<PriorityGroup, number>): (left: QueuedEntryPriorityInput, right: QueuedEntryPriorityInput) => number
  (order: Map<PriorityGroup, number>, left: QueuedEntryPriorityInput, right: QueuedEntryPriorityInput): number
}

export const priorityUpdatesForBalances = (
  inputs: ReadonlyArray<PriorityGroupInput>,
  rules: QueuePriorityRules,
): ReadonlyArray<PriorityGroupUpdate> => {
  const thresholds = rules.balanceThresholds.toSorted((a, b) =>
    a.minBalance === b.minBalance ? 0 : a.minBalance > b.minBalance ? -1 : 1
  )
  return inputs.flatMap((input) => {
    const nextGroup = priorityGroupForBalance(input.balance, thresholds, rules.initialGroup)
    return nextGroup === input.currentGroup ? [] : [{ id: input.id, priorityGroup: nextGroup }]
  })
}

export const queuePositionForEntry = (
  entries: ReadonlyArray<QueuedEntryPriorityInput>,
  entryId: QueueEntryId,
  rules: QueuePriorityRules,
): O.Option<number> => {
  const sorted = entries.toSorted(byPriority(buildPriorityOrder(rules.slots)))
  const index = sorted.findIndex((entry) => entry.id === entryId)
  return index === -1 ? O.none() : O.some(index + 1)
}

type SelectedPrioritySlot<T extends QueuedEntryPriorityInput> = {
  readonly entry: T
  readonly slot: PrioritySlotId
}

export const estimatedIterationsRemaining = (position: number, slotCount: number): number =>
  Math.ceil(position / slotCount)

export const computeQueueMetrics = (
  position: number,
  pollIntervalSeconds: number,
  slotCount: number,
): { queuePosition: number; estimatedWaitSeconds: number; estimatedIterationsRemaining: number } => {
  return {
    queuePosition: position,
    estimatedWaitSeconds: Math.ceil(position / slotCount) * pollIntervalSeconds,
    estimatedIterationsRemaining: Math.ceil(position / slotCount),
  }
}

export const selectUsersForPriorityCycle = <T extends QueuedEntryPriorityInput>(
  entries: ReadonlyArray<T>,
  rules: QueuePriorityRules,
): ReadonlyArray<SelectedPrioritySlot<T>> => {
  const orderedEntries = entries.toSorted(byPriority(buildPriorityOrder(rules.slots)))
  const usedIds = new Set<number>()
  const selected: Array<SelectedPrioritySlot<T>> = []

  for (const { id: slotId, eligibleGroups } of rules.slots) {
    const entry = orderedEntries.find(
      (candidate) => !usedIds.has(candidate.id) && H.has(eligibleGroups, candidate.priorityGroup),
    )
    if (entry) {
      usedIds.add(entry.id)
      selected.push({ entry, slot: slotId })
    }
  }

  return selected
}
