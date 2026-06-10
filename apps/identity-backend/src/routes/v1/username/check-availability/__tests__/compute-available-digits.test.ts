import { UsernameDigits } from '#root/schema/mod.js'
import { HashSet } from 'effect'
import { describe, expect, it } from 'vitest'
import { computeAvailableDigits } from '../compute-available-digits.js'

describe('computeAvailableDigits', () => {
  it('Should_ReturnAllNinetyNineDigits_When_NoneAllocated', () => {
    // Arrange
    const allocated = HashSet.empty<UsernameDigits>()

    // Act
    const result = computeAvailableDigits(allocated)

    // Assert
    expect.soft(result, 'all 99 digits available').toHaveLength(99)
    expect.soft(result, 'digit 0 excluded').not.toContain(0)
    expect.soft(Math.min(...result), 'starts at 1').toBe(1)
    expect.soft(Math.max(...result), 'ends at 99').toBe(99)
  })

  it('Should_ExcludeAllocatedDigits_When_SomeAllocated', () => {
    // Arrange
    const allocated = HashSet.make(
      UsernameDigits.make('01'),
      UsernameDigits.make('50'),
      UsernameDigits.make('99'),
    )

    // Act
    const result = computeAvailableDigits(allocated)

    // Assert
    expect.soft(result, '99 - 3 = 96 available').toHaveLength(96)
    expect.soft(result, 'excludes allocated digits').toEqual(
      expect.not.arrayContaining([1, 50, 99]),
    )
  })

  it('Should_ReturnEmptyArray_When_AllDigitsAllocated', () => {
    // Arrange
    const allDigits = Array.from(
      { length: 99 },
      (_, i) => UsernameDigits.make(String(i + 1).padStart(2, '0')),
    )
    const allocated = HashSet.fromIterable(allDigits)

    // Act
    const result = computeAvailableDigits(allocated)

    // Assert
    expect.soft(result, 'no digits available').toHaveLength(0)
  })

  it('Should_Ignore00Digit_When_AllocatedAsZeroPadded', () => {
    // Arrange
    const allocated = HashSet.make(UsernameDigits.make('00'))

    // Act
    const result = computeAvailableDigits(allocated)

    // Assert
    expect.soft(result, '00 is always excluded so allocating it changes nothing').toHaveLength(99)
  })

  it('Should_ReturnDigitsInAscendingOrder_When_AnyAllocation', () => {
    // Arrange
    const allocated = HashSet.make(
      UsernameDigits.make('25'),
      UsernameDigits.make('75'),
    )

    // Act
    const result = computeAvailableDigits(allocated)

    // Assert
    const sorted = [...result].sort((a, b) => a - b)
    expect.soft(result, 'digits are in ascending order').toEqual(sorted)
  })
})
