import { describe, expect, it } from 'vitest'
import {
  calculateMastery,
  calculateProjectProgress,
  calculateWeightedProgress
} from '../../src/main/modules/planning/domain/progress'

describe('progress domain rules', () => {
  it('matches the v1 acceptance fixture for equal and workload progress', () => {
    const progress = calculateProjectProgress([
      { completion: 1, manualWeight: 1 },
      { completion: 0.5, manualWeight: 2 },
      { completion: 0, manualWeight: 7 }
    ])

    expect(progress.equal).toBeCloseTo(0.5)
    expect(progress.workload).toBeCloseTo(0.2)
  })

  it('uses estimated time before the default weight', () => {
    expect(
      calculateWeightedProgress([
        { completion: 1, estimatedMinutes: 30 },
        { completion: 0, estimatedMinutes: 90 },
        { completion: 1 }
      ])
    ).toBeCloseTo(31 / 121)
  })

  it('excludes reference items from the denominator', () => {
    expect(
      calculateWeightedProgress([
        { completion: 1, manualWeight: 1 },
        { completion: 0, manualWeight: 99, includeInProgress: false }
      ])
    ).toBe(1)
  })

  it('does not treat unassessed mastery as zero', () => {
    expect(calculateMastery([80, null, 60, null])).toEqual({
      average: 70,
      assessed: 2,
      total: 4,
      coverage: 0.5
    })
  })
})
