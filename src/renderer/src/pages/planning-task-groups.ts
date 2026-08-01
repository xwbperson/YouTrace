export interface GroupablePlanningTask {
  id: string
  milestoneId: string | null
}

export interface GroupablePlanningMilestone {
  id: string
  title: string
}

export interface PlanningTaskGroup<
  TTask extends GroupablePlanningTask,
  TMilestone extends GroupablePlanningMilestone
> {
  key: string
  kind: 'milestone' | 'unavailable' | 'unassigned'
  label: string
  milestone: TMilestone | null
  tasks: TTask[]
}

export function groupTasksByMilestone<
  TTask extends GroupablePlanningTask,
  TMilestone extends GroupablePlanningMilestone
>(tasks: readonly TTask[], milestones: readonly TMilestone[]): Array<PlanningTaskGroup<TTask, TMilestone>> {
  const milestoneGroups = milestones.map<PlanningTaskGroup<TTask, TMilestone>>((milestone) => ({
    key: `milestone:${milestone.id}`,
    kind: 'milestone',
    label: milestone.title,
    milestone,
    tasks: []
  }))
  const groupsByMilestoneId = new Map(
    milestoneGroups.map((group) => [group.milestone!.id, group] as const)
  )
  const unavailable: TTask[] = []
  const unassigned: TTask[] = []

  for (const task of tasks) {
    if (task.milestoneId === null) {
      unassigned.push(task)
      continue
    }
    const group = groupsByMilestoneId.get(task.milestoneId)
    if (group) group.tasks.push(task)
    else unavailable.push(task)
  }

  if (unavailable.length > 0) {
    milestoneGroups.push({
      key: 'unavailable',
      kind: 'unavailable',
      label: '里程碑不可用',
      milestone: null,
      tasks: unavailable
    })
  }
  if (unassigned.length > 0) {
    milestoneGroups.push({
      key: 'unassigned',
      kind: 'unassigned',
      label: '未关联里程碑',
      milestone: null,
      tasks: unassigned
    })
  }
  return milestoneGroups
}
