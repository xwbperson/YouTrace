export interface DependencyEdge {
  taskId: string
  prerequisiteTaskId: string
}

export function wouldCreateDependencyCycle(
  edges: readonly DependencyEdge[],
  taskId: string,
  prerequisiteTaskId: string
): boolean {
  if (taskId === prerequisiteTaskId) return true

  const outgoing = new Map<string, string[]>()
  for (const edge of edges) {
    const targets = outgoing.get(edge.taskId) ?? []
    targets.push(edge.prerequisiteTaskId)
    outgoing.set(edge.taskId, targets)
  }

  const pending = [prerequisiteTaskId]
  const visited = new Set<string>()

  while (pending.length > 0) {
    const current = pending.pop()
    if (!current || visited.has(current)) continue
    if (current === taskId) return true
    visited.add(current)
    pending.push(...(outgoing.get(current) ?? []))
  }

  return false
}
