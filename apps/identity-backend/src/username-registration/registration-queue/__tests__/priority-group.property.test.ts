import { describe, it } from '@effect/vitest'
import { Arbitrary, FastCheck as fc, HashSet as H, Option as O } from 'effect'
import { QueueEntryId } from '../entry.schema.js'
import {
  buildPriorityOrder,
  byPriority,
  priorityUpdatesForBalances,
  queuePositionForEntry,
  selectUsersForPriorityCycle,
} from '../priority-group.js'
import { PriorityGroup, QueuePriorityRules } from '../priority-group.schema.js'

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const arbRulesAndEntries = Arbitrary.make(QueuePriorityRules).chain((rules) => {
  const dequeueableGroups = Array.from(
    new Set(rules.slots.flatMap((s) => [...H.values(s.eligibleGroups)])),
  )
  return fc
    .uniqueArray(fc.integer({ min: 1 }), { minLength: 1 })
    .chain((ids) =>
      fc
        .array(fc.constantFrom(...dequeueableGroups), {
          minLength: ids.length,
          maxLength: ids.length,
        })
        .chain((groups) =>
          fc
            .array(fc.date(), { minLength: ids.length, maxLength: ids.length })
            .map((dates) => ({
              rules,
              entries: ids.map((id, i) => ({
                id: QueueEntryId.make(id),
                priorityGroup: groups[i]!,
                enqueuedAt: dates[i]!,
              })),
            }))
        )
    )
})

const arbRulesAndBalanceInputs = Arbitrary.make(QueuePriorityRules).chain((rules) => {
  const dequeueableGroups = Array.from(
    new Set(rules.slots.flatMap((s) => [...H.values(s.eligibleGroups)])),
  )
  return fc
    .uniqueArray(fc.integer({ min: 1 }), { minLength: 1 })
    .chain((ids) =>
      fc
        .array(fc.constantFrom(...dequeueableGroups), {
          minLength: ids.length,
          maxLength: ids.length,
        })
        .chain((groups) =>
          fc
            .array(fc.bigInt({ min: 0n }), {
              minLength: ids.length,
              maxLength: ids.length,
            })
            .map((balances) => ({
              rules,
              inputs: ids.map((id, i) => ({
                id: QueueEntryId.make(id),
                currentGroup: groups[i]!,
                balance: balances[i] ?? 0n,
              })),
            }))
        )
    )
})

const arbOrderAndTwoEntries = Arbitrary.make(QueuePriorityRules).chain((rules) => {
  const order = buildPriorityOrder(rules.slots)
  const knownGroups = [...order.keys()]
  const maxKnown = knownGroups.length > 0
    ? Math.max(...knownGroups.map(Number))
    : 0
  const unknownGroup = PriorityGroup.make(maxKnown + 1)

  return fc
    .tuple(
      fc.integer({ min: 1 }),
      fc.integer({ min: 1 }),
      fc.constantFrom(...knownGroups),
      fc.oneof(fc.constantFrom(...knownGroups), fc.constant(unknownGroup)),
      fc.date(),
      fc.date(),
    )
    .map(([id1, id2, g1, g2, d1, d2]) => ({
      rules,
      a: { id: QueueEntryId.make(id1), priorityGroup: g1, enqueuedAt: d1 },
      b: { id: QueueEntryId.make(id2), priorityGroup: g2, enqueuedAt: d2 },
    }))
})

const arbRulesAndTargetEntry = Arbitrary.make(QueuePriorityRules).chain((rules) => {
  const dequeueableGroups = Array.from(
    new Set(rules.slots.flatMap((s) => [...H.values(s.eligibleGroups)])),
  )
  return fc
    .uniqueArray(fc.integer({ min: 1 }), { minLength: 1 })
    .chain((ids) => {
      const existingIds = ids
      const absentId = Math.max(...ids, 0) + 1
      return fc
        .array(fc.constantFrom(...dequeueableGroups), {
          minLength: ids.length,
          maxLength: ids.length,
        })
        .chain((groups) =>
          fc
            .array(fc.date(), { minLength: ids.length, maxLength: ids.length })
            .chain((dates) => {
              const entries = ids.map((id, i) => ({
                id: QueueEntryId.make(id),
                priorityGroup: groups[i]!,
                enqueuedAt: dates[i]!,
              }))
              return fc
                .oneof(
                  fc.constantFrom(...existingIds).map((id) => QueueEntryId.make(id)),
                  fc.constant(QueueEntryId.make(absentId)),
                )
                .map((targetId) => ({ rules, entries, targetId }))
            })
        )
    })
})

// ---------------------------------------------------------------------------
// Tests: buildPriorityOrder
// ---------------------------------------------------------------------------

describe('buildPriorityOrder', () => {
  it.prop(
    '∀x_CoverAllGroups_⊆x',
    [Arbitrary.make(QueuePriorityRules)],
    ([rules]) => {
      const order = buildPriorityOrder(rules.slots)
      const allSlotGroups = new Set(
        rules.slots.flatMap((s) => [...H.values(s.eligibleGroups)].map(Number)),
      )
      const orderedGroups = new Set([...order.keys()].map(Number))
      return [...allSlotGroups].every((g) => orderedGroups.has(g))
    },
  )

  it.prop(
    '∀x_HaveContiguousOrdinals_≡x',
    [Arbitrary.make(QueuePriorityRules)],
    ([rules]) => {
      const order = buildPriorityOrder(rules.slots)
      const ordinals = [...order.values()].toSorted((a, b) => a - b)
      return (
        ordinals.length === 0 ||
        (ordinals[0] === 0 &&
          ordinals[ordinals.length - 1] === ordinals.length - 1)
      )
    },
  )

  it.prop(
    '→x_FirstAppearanceWins_=x',
    [Arbitrary.make(QueuePriorityRules)],
    ([rules]) => {
      const order = buildPriorityOrder(rules.slots)
      const seen = new Set<number>()
      let distinctCount = 0

      for (const slot of rules.slots) {
        for (const group of H.values(slot.eligibleGroups)) {
          const g = Number(group)
          if (!seen.has(g)) {
            seen.add(g)
            if (order.get(group) !== distinctCount) return false
            distinctCount++
          } else {
            const ordinal = order.get(group)
            if (ordinal === undefined || ordinal >= distinctCount) return false
          }
        }
      }

      return order.size === distinctCount
    },
  )
})

// ---------------------------------------------------------------------------
// Tests: byPriority
// ---------------------------------------------------------------------------

describe('byPriority', () => {
  it.prop(
    '∀x_BeReflexive_=x',
    [arbOrderAndTwoEntries],
    ([{ rules, a }]) => {
      const order = buildPriorityOrder(rules.slots)
      return byPriority(order, a, a) === 0
    },
  )

  it.prop(
    '∀x_BeAntiSymmetric_≠x',
    [arbOrderAndTwoEntries],
    ([{ rules, a, b }]) => {
      const order = buildPriorityOrder(rules.slots)
      return byPriority(order, a, b) === -byPriority(order, b, a)
    },
  )

  it.prop(
    '∀x_PrioritizeLowerOrdinal_≤x',
    [arbOrderAndTwoEntries],
    ([{ rules, a, b }]) => {
      const order = buildPriorityOrder(rules.slots)
      const oa = order.get(a.priorityGroup)
      const ob = order.get(b.priorityGroup)
      if (oa === undefined || ob === undefined || oa === ob) return true
      const cmp = byPriority(order, a, b)
      // sign of cmp matches ordinal difference: a before b (cmp < 0) iff oa < ob
      return oa < ob ? cmp < 0 : cmp > 0
    },
  )

  it.prop(
    '∀x_BreakTieByTimestamp_≤x',
    [arbOrderAndTwoEntries],
    ([{ rules, a, b }]) => {
      const order = buildPriorityOrder(rules.slots)
      if (a.priorityGroup !== b.priorityGroup) return true
      const cmp = byPriority(order, a, b)
      const dt = a.enqueuedAt.getTime() - b.enqueuedAt.getTime()
      // sign of cmp matches sign of timestamp delta
      return dt < 0 ? cmp < 0 : dt > 0 ? cmp > 0 : cmp === 0
    },
  )

  it.prop(
    '→x_SortUnknownGroupLast_⊥',
    [arbOrderAndTwoEntries],
    ([{ rules, a, b }]) => {
      const order = buildPriorityOrder(rules.slots)
      const aKnown = order.has(a.priorityGroup)
      const bKnown = order.has(b.priorityGroup)

      if (aKnown && bKnown) return true
      if (!aKnown && !bKnown) return true

      if (!aKnown && bKnown) return byPriority(order, a, b) > 0
      return byPriority(order, a, b) < 0
    },
  )
})

// ---------------------------------------------------------------------------
// Tests: priorityUpdatesForBalances
// ---------------------------------------------------------------------------

describe('priorityUpdatesForBalances', () => {
  it.prop(
    '∀x_ReturnOnlyChangedEntries_∈x',
    [arbRulesAndBalanceInputs],
    ([{ rules, inputs }]) => {
      const updates = priorityUpdatesForBalances(inputs, rules)
      const inputIds = new Set(inputs.map((i) => i.id))
      for (const update of updates) {
        if (!inputIds.has(update.id)) return false
        const original = inputs.find((i) => i.id === update.id)!
        if (update.priorityGroup === original.currentGroup) return false
      }
      return true
    },
  )

  it.prop(
    '∀x_IncludeAllChangedEntries_⊆x',
    [arbRulesAndBalanceInputs],
    ([{ rules, inputs }]) => {
      const updates = priorityUpdatesForBalances(inputs, rules)
      const updatedIds = new Set(updates.map((u) => u.id))

      const sortedThresholds = [...rules.balanceThresholds].sort((a, b) =>
        a.minBalance === b.minBalance
          ? 0
          : a.minBalance > b.minBalance
          ? -1
          : 1
      )

      for (const input of inputs) {
        const highestMet = sortedThresholds.find(
          (t) => input.balance >= t.minBalance,
        )
        const expectedGroup = highestMet?.group ?? rules.initialGroup
        if (expectedGroup !== input.currentGroup && !updatedIds.has(input.id)) {
          return false
        }
      }
      return true
    },
  )

  it.prop(
    '∀x_AssignHighestThresholdMet_∈x',
    [arbRulesAndBalanceInputs],
    ([{ rules, inputs }]) => {
      const sortedThresholds = [...rules.balanceThresholds].sort((a, b) =>
        a.minBalance === b.minBalance
          ? 0
          : a.minBalance > b.minBalance
          ? -1
          : 1
      )

      for (const input of inputs) {
        const updates = priorityUpdatesForBalances([input], rules)
        const assignedGroup = updates.length > 0
          ? updates[0]!.priorityGroup
          : input.currentGroup

        const highestMet = sortedThresholds.find(
          (t) => input.balance >= t.minBalance,
        )
        const expectedGroup = highestMet?.group ?? rules.initialGroup
        if (assignedGroup !== expectedGroup) return false
      }
      return true
    },
  )

  it.prop(
    '→x_FallbackToInitialGroup_=x',
    [arbRulesAndBalanceInputs],
    ([{ rules, inputs }]) => {
      for (const input of inputs) {
        const meetsAny = rules.balanceThresholds.some(
          (t) => input.balance >= t.minBalance,
        )
        if (meetsAny) continue

        const updates = priorityUpdatesForBalances([input], rules)
        if (updates.length > 0) {
          if (updates[0]!.priorityGroup !== rules.initialGroup) return false
        } else {
          if (input.currentGroup !== rules.initialGroup) return false
        }
      }
      return true
    },
  )

  it.prop(
    '→x_BalanceMonotonic_≠x',
    [arbRulesAndBalanceInputs],
    ([{ rules, inputs }]) => {
      for (const input of inputs) {
        const baseUpdates = priorityUpdatesForBalances([input], rules)
        const baseGroup = baseUpdates.length > 0
          ? baseUpdates[0]!.priorityGroup
          : input.currentGroup

        const higherInput = { ...input, balance: input.balance + 1n }
        const higherUpdates = priorityUpdatesForBalances([higherInput], rules)
        const higherGroup = higherUpdates.length > 0
          ? higherUpdates[0]!.priorityGroup
          : input.currentGroup

        if (
          baseGroup !== rules.initialGroup &&
          higherGroup === rules.initialGroup
        ) {
          return false
        }
      }
      return true
    },
  )
})

// ---------------------------------------------------------------------------
// Tests: queuePositionForEntry
// ---------------------------------------------------------------------------

describe('queuePositionForEntry', () => {
  it.prop(
    '∃x_ReturnNone_∈x',
    [arbRulesAndTargetEntry],
    ([{ rules, entries, targetId }]) => {
      const present = entries.some((e) => e.id === targetId)
      if (present) return true
      return O.isNone(queuePositionForEntry(entries, targetId, rules))
    },
  )

  it.prop(
    '∀x_ReturnOneIndexed_≥x',
    [arbRulesAndTargetEntry],
    ([{ rules, entries, targetId }]) => {
      const pos = queuePositionForEntry(entries, targetId, rules)
      if (O.isSome(pos)) return pos.value >= 1
      return entries.some((e) => e.id === targetId)
        ? false
        : true
    },
  )

  it.prop(
    '∀x_BeConsistentWithSortOrder_=x',
    [arbRulesAndTargetEntry],
    ([{ rules, entries, targetId }]) => {
      const pos = queuePositionForEntry(entries, targetId, rules)
      if (O.isNone(pos)) return true

      const order = buildPriorityOrder(rules.slots)
      const sorted = [...entries].sort(byPriority(order))
      const sortedIndex = sorted.findIndex((e) => e.id === targetId)
      return sortedIndex + 1 === pos.value
    },
  )

  it.prop(
    '∀x_HaveUniquePositions_⊆x',
    [arbRulesAndTargetEntry],
    ([{ rules, entries }]) => {
      const positions = entries.map((e) => queuePositionForEntry(entries, e.id, rules))
      const values = positions
        .filter(O.isSome)
        .map((o) => o.value)
      return new Set(values).size === values.length
    },
  )

  it.prop(
    '∀x_PositionOneForHighestPriority_=x',
    [arbRulesAndTargetEntry],
    ([{ rules, entries }]) => {
      if (entries.length === 0) return true
      const order = buildPriorityOrder(rules.slots)
      const sorted = [...entries].sort(byPriority(order))
      const topEntry = sorted[0]!
      const pos = queuePositionForEntry(entries, topEntry.id, rules)
      return O.isSome(pos) && pos.value === 1
    },
  )
})

// ---------------------------------------------------------------------------
// Tests: selectUsersForPriorityCycle
// ---------------------------------------------------------------------------

describe('selectUsersForPriorityCycle', () => {
  it.prop(
    '∀x_AssignOnlyEligibleEntries_⊆x',
    [arbRulesAndEntries],
    ([{ rules, entries }]) => {
      const selected = selectUsersForPriorityCycle(entries, rules)
      for (const s of selected) {
        const slot = rules.slots.find((sl) => sl.id === s.slot)
        if (!slot) return false
        if (!H.has(slot.eligibleGroups, s.entry.priorityGroup)) return false
      }
      return true
    },
  )

  it.prop(
    '∀x_UseEachEntryAtMostOnce_≠x',
    [arbRulesAndEntries],
    ([{ rules, entries }]) => {
      const selected = selectUsersForPriorityCycle(entries, rules)
      const ids = selected.map((s) => s.entry.id)
      return new Set(ids).size === ids.length
    },
  )

  it.prop(
    '∀x_UseEachSlotAtMostOnce_≠x',
    [arbRulesAndEntries],
    ([{ rules, entries }]) => {
      const selected = selectUsersForPriorityCycle(entries, rules)
      const slotIds = selected.map((s) => s.slot)
      return new Set(slotIds).size === slotIds.length
    },
  )

  it.prop(
    '∀x_RespectUpperBound_≤x',
    [arbRulesAndEntries],
    ([{ rules, entries }]) => {
      const selected = selectUsersForPriorityCycle(entries, rules)
      return selected.length <= Math.min(entries.length, rules.slots.length)
    },
  )

  it.prop(
    '∀x_SelectFirstEligibleInSortOrder_=x',
    [arbRulesAndEntries],
    ([{ rules, entries }]) => {
      const selected = selectUsersForPriorityCycle(entries, rules)
      const order = buildPriorityOrder(rules.slots)
      const sortedEntries = [...entries].sort(byPriority(order))
      const usedIds = new Set<number>()

      for (const slot of rules.slots) {
        const algorithmResult = selected.find((s) => s.slot === slot.id)

        if (algorithmResult) {
          const firstEligible = sortedEntries.find(
            (e) =>
              !usedIds.has(e.id) &&
              H.has(slot.eligibleGroups, e.priorityGroup),
          )
          if (!firstEligible) return false
          if (algorithmResult.entry.id !== firstEligible.id) return false
          usedIds.add(firstEligible.id)
        } else {
          const anyEligible = sortedEntries.some(
            (e) =>
              !usedIds.has(e.id) &&
              H.has(slot.eligibleGroups, e.priorityGroup),
          )
          if (anyEligible) return false
        }
      }

      return true
    },
  )

  it.prop(
    '∀x_PreserveSelection_⊆x',
    [arbRulesAndEntries],
    ([{ rules, entries }]) => {
      const selected = selectUsersForPriorityCycle(entries, rules)
      const selectedEntries = selected.map((s) => s.entry)
      const reSelected = selectUsersForPriorityCycle(selectedEntries, rules)

      if (reSelected.length !== selected.length) return false
      for (const s of selected) {
        const match = reSelected.find((r) => r.entry.id === s.entry.id)
        if (!match) return false
        if (match.slot !== s.slot) return false
      }
      return true
    },
  )
})
