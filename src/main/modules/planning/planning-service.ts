import { randomUUID } from 'node:crypto'
import type {
  AddTaskDependencyInput,
  AssignTagInput,
  CreateGoalInput,
  CreateMilestoneInput,
  CreateProjectInput,
  CreateTagInput,
  CreateTaskInput,
  Goal,
  Milestone,
  Project,
  SearchInput,
  SearchResult,
  Tag,
  Task,
  TaskDependency,
  TaskListInput,
  UpdateGoalInput,
  UpdateMilestoneInput,
  UpdateProjectInput,
  UpdateTaskInput
} from '../../../shared/contracts'
import { YouTraceError } from '../../../shared/errors'
import { calculateMastery, calculateProjectProgress, calculateWeightedProgress } from './domain/progress'
import { wouldCreateDependencyCycle } from './domain/dependencies'
import { PlanningRepository, type MilestoneProgressFact } from './planning-repository'

export class PlanningService {
  constructor(private readonly repository: PlanningRepository) {}

  listProjects(): Project[] {
    return this.repository.listProjects().map((row) => this.mapProject(row))
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

  listTasks(input: TaskListInput): Task[] {
    return this.repository.listTasks(input)
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
    this.repository.updateTask(input.id, merged, current, new Date().toISOString())
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

  search(input: SearchInput): SearchResult[] {
    return this.repository.search(input)
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
    const completion =
      taskRows.length === 0
        ? ['completed', 'verified', 'accepted'].includes(milestone.status)
          ? 1
          : 0
        : calculateWeightedProgress(
            taskRows.map((task) => ({
              completion: task.taskStatus === 'completed' ? 1 : 0,
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
  return calculateWeightedProgress(
    taskRows.map((task) => ({
      completion: task.taskStatus === 'completed' ? 1 : 0,
      includeInProgress: task.taskIncludeInProgress ?? true,
      estimatedMinutes: task.taskEstimatedMinutes,
      manualWeight: task.taskProgressWeight
    }))
  )
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
