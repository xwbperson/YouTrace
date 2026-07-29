export interface ProgressItem {
  completion: number
  includeInProgress?: boolean
  estimatedMinutes?: number | null
  manualWeight?: number | null
}

export interface DualProgress {
  equal: number
  workload: number
}

export interface MasterySummary {
  average: number | null
  assessed: number
  total: number
  coverage: number
}

export function calculateWeightedProgress(items: readonly ProgressItem[]): number {
  const included = items.filter((item) => item.includeInProgress !== false)
  if (included.length === 0) return 0

  let weightedCompletion = 0
  let totalWeight = 0

  for (const item of included) {
    const weight = resolveWeight(item)
    weightedCompletion += clamp(item.completion, 0, 1) * weight
    totalWeight += weight
  }

  return totalWeight === 0 ? 0 : weightedCompletion / totalWeight
}

export function calculateProjectProgress(milestones: readonly ProgressItem[]): DualProgress {
  const included = milestones.filter((item) => item.includeInProgress !== false)
  if (included.length === 0) return { equal: 0, workload: 0 }

  const equal =
    included.reduce((sum, milestone) => sum + clamp(milestone.completion, 0, 1), 0) /
    included.length

  return {
    equal,
    workload: calculateWeightedProgress(included)
  }
}

export function calculateMastery(values: readonly (number | null)[]): MasterySummary {
  const assessedValues = values.filter((value): value is number => value !== null)
  const assessed = assessedValues.length
  const total = values.length

  return {
    average:
      assessed === 0
        ? null
        : assessedValues.reduce((sum, value) => sum + clamp(value, 0, 100), 0) / assessed,
    assessed,
    total,
    coverage: total === 0 ? 0 : assessed / total
  }
}

function resolveWeight(item: ProgressItem): number {
  if (item.manualWeight !== null && item.manualWeight !== undefined && item.manualWeight > 0) {
    return item.manualWeight
  }
  if (
    item.estimatedMinutes !== null &&
    item.estimatedMinutes !== undefined &&
    item.estimatedMinutes > 0
  ) {
    return item.estimatedMinutes
  }
  return 1
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}
