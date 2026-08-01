import { randomUUID } from 'node:crypto'
import type {
  AddTaskDependencyInput,
  Area,
  AssignTagInput,
  CreateAreaInput,
  CreateChecklistItemInput,
  CreateGoalInput,
  CreateMilestoneInput,
  CreateProjectInput,
  CreateTagInput,
  CreateTaskInput,
  Goal,
  Milestone,
  Project,
  ProjectHistoryReport,
  MergeTagsInput,
  SavedView,
  SaveViewInput,
  SearchInput,
  SearchResult,
  Tag,
  TagStats,
  Task,
  TaskChecklistItem,
  TaskDependency,
  TaskListInput,
  TaskRecurrence,
  SetTaskRecurrenceInput,
  SetChecklistProgressInput,
  UpdateAreaInput,
  UpdateChecklistItemInput,
  UpdateGoalInput,
  UpdateMilestoneInput,
  UpdateProjectInput,
  UpdateTaskInput
} from '../../../shared/contracts'
import { YouTraceError } from '../../../shared/errors'
import { calculateMastery, calculateProjectProgress, calculateWeightedProgress } from './domain/progress'
import { wouldCreateDependencyCycle } from './domain/dependencies'
import { PlanningRepository, type MilestoneProgressFact } from './planning-repository'
import { searchInputSchema } from '../../../shared/contracts'

export class PlanningService {
  constructor(private readonly repository: PlanningRepository) {}

  listAreas(includeArchived = false): Area[] {
    return this.repository.listAreas(includeArchived)
  }

  createArea(input: CreateAreaInput): Area {
    const id = randomUUID()
    this.repository.insertArea(id, input, new Date().toISOString())
    return this.repository.getArea(id)!
  }

  updateArea(input: UpdateAreaInput): Area {
    const current = this.repository.getArea(input.id)
    if (!current) throw notFound('领域')
    this.repository.updateArea(
      input.id,
      {
        name: input.name ?? current.name,
        color: input.color === undefined ? current.color : input.color,
        icon: input.icon === undefined ? current.icon : input.icon,
        description: input.description ?? current.description
      },
      input.archived ?? current.archived,
      current,
      new Date().toISOString()
    )
    return this.repository.getArea(input.id)!
  }

  trashArea(id: string): void {
    if (!this.repository.trashArea(id, new Date().toISOString())) throw notFound('领域')
  }

  listProjects(includeArchived = false): Project[] {
    return this.repository.listProjects(includeArchived).map((row) => this.mapProject(row))
  }

  createProject(input: CreateProjectInput): Project {
    const id = randomUUID()
    this.repository.insertProject(id, input, new Date().toISOString())
    return this.requireProject(id)
  }

  updateProject(input: UpdateProjectInput): Project {
    const current = this.repository.getProject(input.id)
    if (!current) throw notFound('项目')

    const merged: CreateProjectInput = {
      areaId: input.areaId ?? current.area_id,
      name: input.name ?? current.name,
      description: input.description ?? current.description,
      status: input.status ?? current.status,
      startDate: input.startDate === undefined ? current.start_date : input.startDate,
      targetDate: input.targetDate === undefined ? current.target_date : input.targetDate,
      successCriteria: input.successCriteria ?? current.success_criteria,
      progressMode: input.progressMode ?? current.progress_mode
    }
    this.repository.updateProject(input.id, merged, current, new Date().toISOString())
    return this.requireProject(input.id)
  }

  trashProject(id: string): void {
    if (!this.repository.trashProject(id, new Date().toISOString())) throw notFound('项目')
  }

  listProjectHistory(projectId: string): ProjectHistoryReport {
    this.requireProject(projectId)
    return this.repository.listProjectHistory(projectId)
  }

  listGoals(projectId: string | null): Goal[] {
    return this.repository.listGoals(projectId).map(mapGoal)
  }

  createGoal(input: CreateGoalInput): Goal {
    const id = randomUUID()
    this.repository.insertGoal(id, input, new Date().toISOString())
    return this.requireGoal(id)
  }

  updateGoal(input: UpdateGoalInput): Goal {
    const current = this.repository.getGoal(input.id)
    if (!current) throw notFound('目标')
    const merged: CreateGoalInput = {
      projectId: input.projectId === undefined ? current.project_id : input.projectId,
      title: input.title ?? current.title,
      successCriteria: input.successCriteria ?? current.success_criteria,
      targetDate: input.targetDate === undefined ? current.target_date : input.targetDate,
      measureType: input.measureType ?? current.measure_type,
      status: input.status ?? current.status
    }
    this.repository.updateGoal(input.id, merged, current, new Date().toISOString())
    return this.requireGoal(input.id)
  }

  trashGoal(id: string): void {
    if (!this.repository.trashGoal(id, new Date().toISOString())) throw notFound('目标')
  }

  listMilestones(projectId: string): Milestone[] {
    return this.repository
      .listMilestones(projectId)
      .map((row) => this.mapMilestone(row, projectId))
  }

  createMilestone(input: CreateMilestoneInput): Milestone {
    if (!input.projectId) {
      throw new YouTraceError({
        code: 'MILESTONE_PROJECT_REQUIRED',
        message: '里程碑必须属于一个项目。'
      })
    }
    const id = randomUUID()
    this.repository.insertMilestone(id, input, new Date().toISOString())
    return this.requireMilestone(id)
  }

  updateMilestone(input: UpdateMilestoneInput): Milestone {
    const current = this.repository.getMilestone(input.id)
    if (!current) throw notFound('里程碑')
    const merged: CreateMilestoneInput = {
      projectId: input.projectId === undefined ? current.project_id : input.projectId,
      goalId: input.goalId === undefined ? current.goal_id : input.goalId,
      title: input.title ?? current.title,
      description: input.description ?? current.description,
      plannedDate: input.plannedDate === undefined ? current.planned_date : input.plannedDate,
      estimatedMinutes:
        input.estimatedMinutes === undefined ? current.estimated_minutes : input.estimatedMinutes,
      manualWeight: input.manualWeight === undefined ? current.manual_weight : input.manualWeight,
      mastery: input.mastery === undefined ? current.mastery : input.mastery,
      verificationCriteria:
        input.verificationCriteria ?? current.verification_criteria,
      status: input.status ?? current.status,
      includeInProgress: input.includeInProgress ?? current.include_in_progress === 1
    }
    if (!merged.projectId) {
      throw new YouTraceError({
        code: 'MILESTONE_PROJECT_REQUIRED',
        message: '里程碑必须属于一个项目。'
      })
    }
    this.repository.updateMilestone(input.id, merged, current, new Date().toISOString())
    return this.requireMilestone(input.id)
  }

  trashMilestone(id: string): void {
    if (!this.repository.trashMilestone(id, new Date().toISOString())) throw notFound('里程碑')
  }

  listTasks(input: TaskListInput): Task[] {
    return applyTaskProgress(this.repository.listTasks(input))
  }

  createTask(input: CreateTaskInput): Task {
    const id = randomUUID()
    this.repository.insertTask(id, input, new Date().toISOString())
    return this.requireTask(id)
  }

  updateTask(input: UpdateTaskInput): Task {
    const current = this.repository.getTask(input.id)
    if (!current) throw notFound('任务')

    const merged: CreateTaskInput = {
      parentTaskId: input.parentTaskId === undefined ? current.parentTaskId : input.parentTaskId,
      projectId: input.projectId === undefined ? current.projectId : input.projectId,
      goalId: input.goalId === undefined ? current.goalId : input.goalId,
      milestoneId: input.milestoneId === undefined ? current.milestoneId : input.milestoneId,
      title: input.title ?? current.title,
      description: input.description ?? current.description,
      status: input.status ?? current.status,
      difficulty: input.difficulty === undefined ? current.difficulty : input.difficulty,
      priority: input.priority ?? current.priority,
      estimatedMinutes:
        input.estimatedMinutes === undefined ? current.estimatedMinutes : input.estimatedMinutes,
      progressWeight:
        input.progressWeight === undefined ? current.progressWeight : input.progressWeight,
      startDate: input.startDate === undefined ? current.startDate : input.startDate,
      dueAt: input.dueAt === undefined ? current.dueAt : input.dueAt,
      verificationCriteria: input.verificationCriteria ?? current.verificationCriteria,
      includeInProgress: input.includeInProgress ?? current.includeInProgress,
      tagIds: input.tagIds ?? current.tagIds
    }
    const now = new Date().toISOString()
    const recurrence = this.repository.getTaskRecurrence(input.id)
    this.repository.updateTask(input.id, merged, current, now)
    if (
      recurrence?.active &&
      current.status !== 'completed' &&
      merged.status === 'completed'
    ) {
      this.createNextRecurrence(current, recurrence, now)
    }
    return this.requireTask(input.id)
  }

  trashTask(id: string): void {
    if (!this.repository.trashTask(id, new Date().toISOString())) throw notFound('任务')
  }

  addTaskDependency(input: AddTaskDependencyInput): void {
    if (!this.repository.getTask(input.taskId) || !this.repository.getTask(input.prerequisiteTaskId)) {
      throw notFound('任务')
    }
    if (
      wouldCreateDependencyCycle(
        this.repository.listDependencyEdges(),
        input.taskId,
        input.prerequisiteTaskId
      )
    ) {
      throw new YouTraceError({
        code: 'TASK_DEPENDENCY_CYCLE',
        message: '不能添加这项依赖，它会形成任务依赖环。',
        recovery: '请调整前置任务关系后重试。'
      })
    }
    this.repository.addTaskDependency(
      input.taskId,
      input.prerequisiteTaskId,
      input.overrideReason,
      new Date().toISOString()
    )
  }

  listTaskDependencies(taskId: string): TaskDependency[] {
    if (!this.repository.getTask(taskId)) throw notFound('任务')
    return this.repository.listTaskDependencies(taskId)
  }

  listChecklist(taskId: string): TaskChecklistItem[] {
    if (!this.repository.getTask(taskId)) throw notFound('任务')
    return this.repository.listChecklist(taskId)
  }

  createChecklistItem(input: CreateChecklistItemInput): TaskChecklistItem {
    if (!this.repository.getTask(input.taskId)) throw notFound('任务')
    return this.repository.insertChecklistItem(randomUUID(), input, new Date().toISOString())
  }

  updateChecklistItem(input: UpdateChecklistItemInput): TaskChecklistItem {
    const current = this.repository.getChecklistItem(input.id)
    if (!current) throw notFound('检查项')
    return this.repository.updateChecklistItem(
      input.id,
      input.text ?? current.text,
      input.checked ?? current.checked,
      new Date().toISOString()
    )!
  }

  deleteChecklistItem(id: string): void {
    if (!this.repository.deleteChecklistItem(id)) throw notFound('检查项')
  }

  setChecklistProgress(input: SetChecklistProgressInput): Task {
    if (!this.repository.getTask(input.taskId)) throw notFound('任务')
    this.repository.setChecklistProgress(input.taskId, input.enabled, new Date().toISOString())
    return this.requireTask(input.taskId)
  }

  getTaskRecurrence(taskId: string): TaskRecurrence | null {
    if (!this.repository.getTask(taskId)) throw notFound('任务')
    return this.repository.getTaskRecurrence(taskId)
  }

  setTaskRecurrence(input: SetTaskRecurrenceInput): TaskRecurrence | null {
    if (!this.repository.getTask(input.taskId)) throw notFound('任务')
    if (!input.rule) {
      this.repository.removeTaskRecurrence(input.taskId)
      return null
    }
    const existing = this.repository.getTaskRecurrence(input.taskId)
    return this.repository.setTaskRecurrence(
      input.taskId,
      {
        seriesId: existing?.seriesId ?? randomUUID(),
        frequency: input.rule.frequency,
        intervalValue: input.rule.intervalValue,
        weekdays: input.rule.weekdays,
        nextOccurrence: input.rule.nextOccurrence,
        active: true
      },
      new Date().toISOString()
    )
  }

  listTags(): Tag[] {
    return this.repository.listTags()
  }

  createTag(input: CreateTagInput): Tag {
    const id = randomUUID()
    try {
      this.repository.insertTag(id, input, new Date().toISOString())
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
        throw new YouTraceError({
          code: 'TAG_NAME_EXISTS',
          message: '已有同名标签。',
          recovery: '请直接使用现有标签，或换一个名称。'
        })
      }
      throw error
    }
    const tag = this.repository.getTag(id)
    if (!tag) throw notFound('标签')
    return tag
  }

  assignTag(input: AssignTagInput): void {
    if (!this.repository.getTag(input.tagId)) throw notFound('标签')
    this.repository.assignTag(input.tagId, input.entityType, input.entityId, new Date().toISOString())
  }

  getTagStats(id: string): TagStats {
    if (!this.repository.getTag(id)) throw notFound('标签')
    return this.repository.getTagStats(id)
  }

  mergeTags(input: MergeTagsInput): Tag {
    if (!this.repository.getTag(input.sourceTagId) || !this.repository.getTag(input.targetTagId)) {
      throw notFound('标签')
    }
    this.repository.mergeTags(input.sourceTagId, input.targetTagId, new Date().toISOString())
    return this.repository.getTag(input.targetTagId)!
  }

  search(input: SearchInput): SearchResult[] {
    return this.repository.search(searchInputSchema.parse(input))
  }

  listSavedViews(): SavedView[] {
    this.ensurePresetViews()
    return this.repository.listSavedViews()
  }

  saveView(input: SaveViewInput): SavedView {
    return this.repository.insertSavedView(randomUUID(), input, false, new Date().toISOString())
  }

  deleteSavedView(id: string): void {
    if (!this.repository.deleteSavedView(id, new Date().toISOString())) {
      throw new YouTraceError({
        code: 'SAVED_VIEW_DELETE_DENIED',
        message: '预设视图不能删除，或该视图已经不存在。'
      })
    }
  }

  private createNextRecurrence(current: Task, recurrence: TaskRecurrence, now: string): void {
    const nextDate = recurrence.nextOccurrence
    const nextDueAt = current.dueAt ? moveInstantToDate(current.dueAt, nextDate) : null
    const nextTask = this.createTask({
      parentTaskId: current.parentTaskId,
      projectId: current.projectId,
      goalId: current.goalId,
      milestoneId: current.milestoneId,
      title: current.title,
      description: current.description,
      status: nextDueAt ? 'scheduled' : 'ready',
      difficulty: current.difficulty,
      priority: current.priority,
      estimatedMinutes: current.estimatedMinutes,
      progressWeight: current.progressWeight,
      startDate: nextDate,
      dueAt: nextDueAt,
      verificationCriteria: current.verificationCriteria,
      includeInProgress: current.includeInProgress,
      tagIds: current.tagIds
    })
    const following = nextRecurrenceDate(recurrence, nextDate)
    this.repository.disableTaskRecurrence(current.id, now)
    this.repository.setTaskRecurrence(
      nextTask.id,
      {
        seriesId: recurrence.seriesId,
        frequency: recurrence.frequency,
        intervalValue: recurrence.intervalValue,
        weekdays: recurrence.weekdays,
        nextOccurrence: following,
        active: true
      },
      now
    )
  }

  private ensurePresetViews(): void {
    const existing = new Set(this.repository.listSavedViews().map((view) => view.name))
    for (const preset of presetViews()) {
      if (!existing.has(preset.name)) {
        this.repository.insertSavedView(preset.id, preset, true, new Date().toISOString())
      }
    }
  }

  private requireProject(id: string): Project {
    const row = this.repository.getProject(id)
    if (!row) throw notFound('项目')
    return this.mapProject(row)
  }

  private requireTask(id: string): Task {
    const task = this.repository.getTask(id)
    if (!task) throw notFound('任务')
    return task
  }

  private requireGoal(id: string): Goal {
    const row = this.repository.getGoal(id)
    if (!row) throw notFound('目标')
    return mapGoal(row)
  }

  private requireMilestone(id: string): Milestone {
    const row = this.repository.getMilestone(id)
    if (!row) throw notFound('里程碑')
    if (!row.project_id) throw notFound('里程碑项目')
    return this.mapMilestone(row, row.project_id)
  }

  private mapMilestone(
    row: NonNullable<ReturnType<PlanningRepository['getMilestone']>>,
    projectId: string
  ): Milestone {
    const facts = this.repository
      .getMilestoneProgressFacts(projectId)
      .filter((fact) => fact.milestoneId === row.id)
    return {
      id: row.id,
      projectId: row.project_id,
      goalId: row.goal_id,
      title: row.title,
      description: row.description,
      plannedDate: row.planned_date,
      completedDate: row.completed_date,
      estimatedMinutes: row.estimated_minutes,
      manualWeight: row.manual_weight,
      mastery: row.mastery,
      verificationCriteria: row.verification_criteria,
      status: row.status,
      includeInProgress: row.include_in_progress === 1,
      progress: calculateMilestoneCompletion(facts, row.status),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }

  private mapProject(row: ReturnType<PlanningRepository['getProject']> & {}): Project {
    if (!row) throw notFound('项目')
    const facts = this.repository.getMilestoneProgressFacts(row.id)
    const milestones = groupMilestones(facts)
    const progress = calculateProjectProgress(
      milestones.map((milestone) => ({
        completion: milestone.completion,
        includeInProgress: milestone.includeInProgress,
        estimatedMinutes: milestone.estimatedMinutes,
        manualWeight: milestone.manualWeight
      }))
    )
    const mastery = calculateMastery(milestones.map((milestone) => milestone.mastery))

    return {
      id: row.id,
      areaId: row.area_id,
      name: row.name,
      description: row.description,
      status: row.status,
      startDate: row.start_date,
      targetDate: row.target_date,
      successCriteria: row.success_criteria,
      progressMode: row.progress_mode,
      equalProgress: progress.equal,
      workloadProgress: progress.workload,
      masteryAverage: mastery.average,
      masteryAssessed: mastery.assessed,
      masteryTotal: mastery.total,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }
}

function groupMilestones(facts: MilestoneProgressFact[]): Array<{
  completion: number
  estimatedMinutes: number | null
  manualWeight: number | null
  mastery: number | null
  includeInProgress: boolean
}> {
  const grouped = new Map<string, MilestoneProgressFact[]>()
  for (const fact of facts) {
    const rows = grouped.get(fact.milestoneId) ?? []
    rows.push(fact)
    grouped.set(fact.milestoneId, rows)
  }

  return [...grouped.values()].map((rows) => {
    const milestone = rows[0]!
    const taskRows = rows.filter((row) => row.taskId !== null)
    const taskIds = new Set(taskRows.map((row) => row.taskId))
    const topLevelTasks = taskRows.filter(
      (row) => row.taskParentTaskId === null || !taskIds.has(row.taskParentTaskId)
    )
    const completion =
      taskRows.length === 0
        ? ['completed', 'verified', 'accepted'].includes(milestone.status)
          ? 1
          : 0
        : calculateWeightedProgress(
            topLevelTasks.map((task) => ({
              completion: taskFactCompletion(task, taskRows),
              includeInProgress: task.taskIncludeInProgress ?? true,
              estimatedMinutes: task.taskEstimatedMinutes,
              manualWeight: task.taskProgressWeight
            }))
          )
    return {
      completion,
      estimatedMinutes: milestone.estimatedMinutes,
      manualWeight: milestone.manualWeight,
      mastery: milestone.mastery,
      includeInProgress: milestone.includeInProgress
    }
  })
}

function calculateMilestoneCompletion(
  facts: MilestoneProgressFact[],
  status: string
): number {
  const taskRows = facts.filter((row) => row.taskId !== null)
  if (taskRows.length === 0) {
    return ['completed', 'verified', 'accepted'].includes(status) ? 1 : 0
  }
  const taskIds = new Set(taskRows.map((row) => row.taskId))
  const topLevelTasks = taskRows.filter(
    (row) => row.taskParentTaskId === null || !taskIds.has(row.taskParentTaskId)
  )
  return calculateWeightedProgress(
    topLevelTasks.map((task) => ({
      completion: taskFactCompletion(task, taskRows),
      includeInProgress: task.taskIncludeInProgress ?? true,
      estimatedMinutes: task.taskEstimatedMinutes,
      manualWeight: task.taskProgressWeight
    }))
  )
}

function taskFactCompletion(
  task: MilestoneProgressFact,
  allTasks: MilestoneProgressFact[],
  visited = new Set<string>()
): number {
  if (!task.taskId || visited.has(task.taskId)) return 0
  const nextVisited = new Set(visited).add(task.taskId)
  const children = allTasks.filter(
    (candidate) => candidate.taskParentTaskId === task.taskId && candidate.taskId !== null
  )
  if (children.length > 0) {
    return calculateWeightedProgress(
      children.map((child) => ({
        completion: taskFactCompletion(child, allTasks, nextVisited),
        includeInProgress: child.taskIncludeInProgress ?? true,
        estimatedMinutes: child.taskEstimatedMinutes,
        manualWeight: child.taskProgressWeight
      }))
    )
  }
  if (task.checklistProgressEnabled && task.checklistCount > 0) {
    return task.checklistChecked / task.checklistCount
  }
  return task.taskStatus === 'completed' ? 1 : 0
}

function applyTaskProgress(tasks: Task[]): Task[] {
  const byParent = new Map<string, Task[]>()
  for (const task of tasks) {
    if (!task.parentTaskId) continue
    const children = byParent.get(task.parentTaskId) ?? []
    children.push(task)
    byParent.set(task.parentTaskId, children)
  }
  const calculate = (task: Task, visited = new Set<string>()): number => {
    if (visited.has(task.id)) return 0
    const children = byParent.get(task.id) ?? []
    if (children.length === 0) return task.progress
    const nextVisited = new Set(visited).add(task.id)
    return calculateWeightedProgress(
      children.map((child) => ({
        completion: calculate(child, nextVisited),
        includeInProgress: child.includeInProgress,
        estimatedMinutes: child.estimatedMinutes,
        manualWeight: child.progressWeight
      }))
    )
  }
  return tasks.map((task) => ({ ...task, progress: calculate(task) }))
}

function mapGoal(row: NonNullable<ReturnType<PlanningRepository['getGoal']>>): Goal {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    successCriteria: row.success_criteria,
    targetDate: row.target_date,
    measureType: row.measure_type,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function notFound(label: string): YouTraceError {
  return new YouTraceError({
    code: 'ENTITY_NOT_FOUND',
    message: `${label}不存在或已进入回收站。`,
    recovery: '请刷新当前页面后重试。'
  })
}

function nextRecurrenceDate(recurrence: TaskRecurrence, fromDate: string): string {
  if (recurrence.frequency === 'monthly') {
    const [year, month, day] = fromDate.split('-').map(Number) as [number, number, number]
    const targetMonth = month - 1 + recurrence.intervalValue
    const targetYear = year + Math.floor(targetMonth / 12)
    const normalizedMonth = ((targetMonth % 12) + 12) % 12
    const lastDay = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate()
    return formatUtcDate(new Date(Date.UTC(targetYear, normalizedMonth, Math.min(day, lastDay))))
  }
  if (recurrence.frequency === 'weekdays') {
    let cursor = addUtcDays(fromDate, 1)
    while ([0, 6].includes(new Date(`${cursor}T12:00:00.000Z`).getUTCDay())) {
      cursor = addUtcDays(cursor, 1)
    }
    return cursor
  }
  if (recurrence.frequency === 'weekly' && recurrence.weekdays.length > 0) {
    let cursor = addUtcDays(fromDate, 1)
    const allowed = new Set(recurrence.weekdays)
    for (let offset = 0; offset < 7 * Math.max(1, recurrence.intervalValue); offset += 1) {
      if (allowed.has(new Date(`${cursor}T12:00:00.000Z`).getUTCDay())) return cursor
      cursor = addUtcDays(cursor, 1)
    }
  }
  const interval =
    recurrence.frequency === 'weekly'
      ? 7 * recurrence.intervalValue
      : recurrence.intervalValue
  return addUtcDays(fromDate, interval)
}

function addUtcDays(value: string, amount: number): string {
  const date = new Date(`${value}T12:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + amount)
  return formatUtcDate(date)
}

function formatUtcDate(value: Date): string {
  return value.toISOString().slice(0, 10)
}

function moveInstantToDate(instant: string, localDate: string): string {
  const time = new Date(instant)
  const [year, month, day] = localDate.split('-').map(Number) as [number, number, number]
  time.setUTCFullYear(year, month - 1, day)
  return time.toISOString()
}

function presetViews(): Array<SaveViewInput & { id: string }> {
  const base = searchInputSchema.parse({
    query: '',
    entityTypes: ['task'],
    statuses: [],
    tagIds: [],
    projectId: null,
    dueFrom: null,
    dueTo: null,
    difficulties: [],
    priorities: [],
    overdueOnly: false,
    untaggedOnly: false,
    hasEvidence: null,
    limit: 100
  })
  return [
    {
      id: '15000000-0000-4000-8000-000000000001',
      name: '高优先级且逾期',
      filters: { ...base, priorities: ['high', 'critical'], overdueOnly: true }
    },
    {
      id: '15000000-0000-4000-8000-000000000002',
      name: '高难度待办',
      filters: {
        ...base,
        statuses: ['ready', 'scheduled', 'in_progress'],
        difficulties: [4, 5]
      }
    },
    {
      id: '15000000-0000-4000-8000-000000000003',
      name: '没有标签的内容',
      filters: { ...base, untaggedOnly: true }
    },
    {
      id: '15000000-0000-4000-8000-000000000004',
      name: '没有证据的任务',
      filters: { ...base, hasEvidence: false }
    },
    {
      id: '15000000-0000-4000-8000-000000000005',
      name: '待处理与阻塞',
      filters: { ...base, statuses: ['inbox', 'blocked'] }
    }
  ]
}
