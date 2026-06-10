import type { TxFinalized } from 'polkadot-api'

export interface ForceBatchResults {
  readonly completedIndices: readonly number[]
  readonly failedIndices: readonly number[]
  readonly warnings: readonly string[]
}

/**
 * Parses `force_batch` transaction events to determine per-call success/failure.
 *
 * After a `Utility.force_batch` is finalized, the chain emits one `Utility.ItemCompleted`
 * or `Utility.ItemFailed` event per inner call. This function extracts those indices
 * and returns them grouped, along with any warnings about data mismatches.
 *
 * @param events - The events array from a finalized `force_batch` transaction
 * @param callCount - The number of inner calls that were batched
 * @returns Completed indices, failed indices, and any warnings
 */
export const parseForceBatchResults = (
  events: TxFinalized['events'],
  callCount: number,
): ForceBatchResults => {
  const warnings: string[] = []

  /**
   * ASSUMPTION: `force_batch` emits one `Utility.ItemCompleted` or `Utility.ItemFailed`
   * event per inner call, in the same order as the calls array. This is the documented
   * Substrate behavior for `force_batch`. If the chain runtime changes this, indices
   * may be misaligned and the `warnings` array will flag the mismatch.
   */
  const utilityEvents = events.filter(
    (event): event is TxFinalized['events'][number] & {
      value: { type: 'ItemCompleted' | 'ItemFailed' }
    } =>
      event.type === 'Utility' &&
      (event.value.type === 'ItemCompleted' || event.value.type === 'ItemFailed'),
  )

  if (utilityEvents.length === 0) {
    return {
      completedIndices: [],
      failedIndices: Array.from({ length: callCount }, (_, i) => i),
      warnings: ['No utility events found in transaction'],
    }
  }

  const { completedIndices, failedIndices } = utilityEvents.reduce(
    (acc, event, index) => {
      if (event.value.type === 'ItemCompleted') {
        acc.completedIndices.push(index)
      } else {
        acc.failedIndices.push(index)
      }
      return acc
    },
    { completedIndices: [] as number[], failedIndices: [] as number[] },
  )

  if (utilityEvents.length !== callCount) {
    warnings.push(
      `Event count mismatch: expected ${callCount} calls, found ${utilityEvents.length} events`,
    )
  }

  return { completedIndices, failedIndices, warnings }
}
