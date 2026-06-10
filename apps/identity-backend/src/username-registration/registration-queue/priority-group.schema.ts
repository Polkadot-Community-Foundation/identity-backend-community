import { PlanckBalance } from '#root/schema/balance.js'
import { FastCheck, HashSet as H, Schema as S } from 'effect'
import type { NonEmptyArray } from 'effect/Array'

export const PriorityGroup = S.NonNegativeInt.pipe(S.brand('PriorityGroup'))
export type PriorityGroup = typeof PriorityGroup.Type

export const PrioritySlotId = S.NonNegativeInt.pipe(S.brand('PrioritySlotId'))
export type PrioritySlotId = typeof PrioritySlotId.Type

export const PriorityThreshold = S.Struct({
  group: PriorityGroup,
  minBalance: PlanckBalance,
})
export type PriorityThreshold = typeof PriorityThreshold.Type

const SlotEligibleGroups = S.HashSet(PriorityGroup).pipe(
  S.filter((set) => H.size(set) > 0, { message: () => 'Slot must have at least one eligible group' }),
  S.annotations({
    arbitrary: () => (fc: typeof FastCheck) =>
      fc
        .uniqueArray(fc.integer({ min: 0 }).map((n) => PriorityGroup.make(n)), { minLength: 1 })
        .map((groups) => H.fromIterable(groups)),
  }),
)

const PrioritySlot = S.Struct({
  id: PrioritySlotId,
  eligibleGroups: SlotEligibleGroups,
})

type PrioritySlotShape = {
  readonly id: typeof PrioritySlotId.Type
  readonly eligibleGroups: H.HashSet<PriorityGroup>
}

const arbSingleSlot = (fc: typeof FastCheck, id: typeof PrioritySlotId.Type): FastCheck.Arbitrary<PrioritySlotShape> =>
  fc
    .uniqueArray(
      fc.integer({ min: 0 })
        .map((n) => PriorityGroup.make(n)),
      { minLength: 1 },
    )
    .map((groups) => ({
      id,
      eligibleGroups: H.fromIterable(groups),
    }))

const arbPrioritySlots = (fc: typeof FastCheck): FastCheck.Arbitrary<NonEmptyArray<PrioritySlotShape>> =>
  fc
    .uniqueArray(fc.integer({ min: 0 }), { minLength: 1 })
    .map((ids) => ids.toSorted((a, b) => a - b).map((id) => PrioritySlotId.make(id)))
    .chain((sortedIds) => {
      const [firstId, ...restIds] = sortedIds
      if (firstId === undefined) {
        throw new Error('uniqueArray with minLength: 1 produced empty array')
      }
      return fc.tuple(arbSingleSlot(fc, firstId), ...restIds.map((id) => arbSingleSlot(fc, id)))
    })

const PrioritySlots = S.NonEmptyArray(PrioritySlot).pipe(
  S.annotations({
    arbitrary: () => arbPrioritySlots,
  }),
)

const QueuePriorityRulesTypeId: unique symbol = Symbol.for(
  '@identity-backend/registration-queue/QueuePriorityRules',
)
type QueuePriorityRulesTypeId = typeof QueuePriorityRulesTypeId

const slotsAreUniqueAndSorted = (slots: ReadonlyArray<typeof PrioritySlot.Type>): boolean => {
  const ids = slots.map((s) => s.id)
  return new Set(ids).size === ids.length && ids.every((id, i) => i === 0 || id > ids[i - 1]!)
}

const groupsAreDequeueable = (
  rules: {
    readonly initialGroup: typeof PriorityGroup.Type
    readonly balanceThresholds: ReadonlyArray<typeof PriorityThreshold.Type>
    readonly slots: ReadonlyArray<typeof PrioritySlot.Type>
  },
): boolean => {
  const dequeueable = H.fromIterable(rules.slots.flatMap((s) => [...H.values(s.eligibleGroups)]))
  return (
    H.has(dequeueable, rules.initialGroup) &&
    rules.balanceThresholds.every((t) => H.has(dequeueable, t.group))
  )
}

const initialGroupNotInThresholds = (
  rules: {
    readonly initialGroup: typeof PriorityGroup.Type
    readonly balanceThresholds: ReadonlyArray<typeof PriorityThreshold.Type>
  },
): boolean => rules.balanceThresholds.every((t) => t.group !== rules.initialGroup)

export class QueuePriorityRules extends S.Class<QueuePriorityRules>('QueuePriorityRules')(
  S.Struct({
    initialGroup: PriorityGroup,
    balanceThresholds: S.Array(PriorityThreshold),
    slots: PrioritySlots.pipe(
      S.filter(slotsAreUniqueAndSorted, {
        message: () => 'Slot IDs must be unique and monotonically increasing',
      }),
    ),
  }).pipe(
    S.filter(groupsAreDequeueable, {
      message: () =>
        'Every referenced priority group (initialGroup, balanceThresholds[].group) must be eligible for at least one slot',
    }),
    S.filter(initialGroupNotInThresholds, {
      message: () =>
        'initialGroup must not appear in balanceThresholds[].group — initialGroup is the fallback for balances below all thresholds, not a target threshold group',
    }),
    S.annotations({
      arbitrary: () => (fc: typeof FastCheck) =>
        arbPrioritySlots(fc).chain((slots) => {
          const dequeueableArr = [...new Set(slots.flatMap((s) => [...H.values(s.eligibleGroups)]))]
          return fc.constantFrom(...dequeueableArr).chain((initialGroup) => {
            const otherGroups = dequeueableArr.filter((g) => g !== initialGroup)
            return fc
              .tuple(
                fc.constant(initialGroup),
                otherGroups.length > 0
                  ? fc.array(
                    fc
                      .tuple(
                        fc.constantFrom(...otherGroups),
                        fc.bigInt({ min: 0n }).map((b) => PlanckBalance.make(b)),
                      )
                      .map(([group, minBalance]) => ({ group, minBalance })),
                  )
                  : fc.constant([] as const),
              )
              .map(([initialGroup, balanceThresholds]) => ({
                initialGroup,
                balanceThresholds,
                slots,
              }))
          })
        }),
    }),
  ),
) {
  readonly [QueuePriorityRulesTypeId] = QueuePriorityRulesTypeId
}

// Stryker disable all
if (import.meta.vitest) {
  const { describe, it } = await import('@effect/vitest')

  describe('slotsAreUniqueAndSorted', () => {
    it.prop(
      '∀x_SlotsUniqueAndSorted_≡x',
      [PrioritySlots],
      ([slots]) => slotsAreUniqueAndSorted(slots),
    )

    it.prop('→x_SlotsNotSorted_⊥', [PrioritySlots], ([slots]) => {
      const a = slots[0]
      const b = slots[1]
      if (b === undefined) return true
      return !slotsAreUniqueAndSorted([b, a])
    })

    it.prop('→x_SlotsDuplicated_⊥', [PrioritySlots], ([slots]) => {
      const first = slots[0]
      return !slotsAreUniqueAndSorted([first, first])
    })
  })

  describe('initialGroupNotInThresholds', () => {
    it.prop(
      '∀x_InitialGroupNotInThresholds_≡x',
      [QueuePriorityRules],
      ([rules]) => initialGroupNotInThresholds(rules),
    )

    it.prop(
      '→x_InitialGroupInThresholds_⊥',
      [QueuePriorityRules],
      ([rules]) => {
        const firstThreshold = rules.balanceThresholds[0]
        if (firstThreshold === undefined) return true
        return !initialGroupNotInThresholds({
          initialGroup: firstThreshold.group,
          balanceThresholds: rules.balanceThresholds,
        })
      },
    )

    it.prop(
      '∀x_EmptyThresholds_≡x',
      [QueuePriorityRules],
      ([rules]) =>
        initialGroupNotInThresholds({
          initialGroup: rules.initialGroup,
          balanceThresholds: [],
        }),
    )
  })

  describe('groupsAreDequeueable', () => {
    it.prop('∀x_AllGroupsDequeueable_≡x', [QueuePriorityRules], ([rules]) => groupsAreDequeueable(rules))

    it.prop(
      '→x_InitialGroupNotDequeueable_⊥',
      [QueuePriorityRules],
      ([rules]) => {
        const dequeueable = new Set(rules.slots.flatMap((s) => [...s.eligibleGroups]))
        const unmatched = [...dequeueable].reduce((max, g) => (g > max ? g : max), 0) + 1
        return !groupsAreDequeueable({
          initialGroup: PriorityGroup.make(unmatched),
          balanceThresholds: rules.balanceThresholds,
          slots: rules.slots,
        })
      },
    )

    it.prop(
      '→x_ThresholdGroupNotDequeueable_⊥',
      [QueuePriorityRules],
      ([rules]) => {
        const dequeueable = new Set(rules.slots.flatMap((s) => [...s.eligibleGroups]))
        const unmatched = [...dequeueable].reduce((max, g) => (g > max ? g : max), 0) + 1
        return !groupsAreDequeueable({
          initialGroup: rules.initialGroup,
          balanceThresholds: [
            {
              group: PriorityGroup.make(unmatched),
              minBalance: rules.balanceThresholds[0]?.minBalance ?? PlanckBalance.make(0n),
            },
          ],
          slots: rules.slots,
        })
      },
    )
  })
}
