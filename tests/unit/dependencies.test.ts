import { describe, expect, it } from 'vitest'
import { wouldCreateDependencyCycle } from '../../src/main/modules/planning/domain/dependencies'

describe('task dependency rules', () => {
  it('rejects self dependencies', () => {
    expect(wouldCreateDependencyCycle([], 'A', 'A')).toBe(true)
  })

  it('rejects an edge that closes a dependency cycle', () => {
    const edges = [
      { taskId: 'A', prerequisiteTaskId: 'B' },
      { taskId: 'B', prerequisiteTaskId: 'C' }
    ]

    expect(wouldCreateDependencyCycle(edges, 'C', 'A')).toBe(true)
  })

  it('allows an acyclic edge', () => {
    const edges = [{ taskId: 'A', prerequisiteTaskId: 'B' }]
    expect(wouldCreateDependencyCycle(edges, 'C', 'A')).toBe(false)
  })
})
