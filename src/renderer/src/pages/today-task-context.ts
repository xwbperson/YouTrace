export function formatTaskContext(task: {
  projectName: string | null
  milestoneTitle: string | null
}): string {
  if (task.projectName && task.milestoneTitle) {
    return `${task.projectName} · ${task.milestoneTitle}`
  }
  if (task.projectName) return task.projectName
  if (task.milestoneTitle) return `里程碑：${task.milestoneTitle}`
  return '未关联项目'
}
