import { randomUUID } from 'node:crypto'
import type {
  AssignTagInput,
  CreateProjectInput,
  CreateTagInput,
  CreateTaskInput,
  Project,
  SearchInput,
  SearchResult,
  Tag,
  Task,
  TaskListInput,
  UpdateProjectInput,
  UpdateTaskInput
} from '../../../shared/contracts'
import { YouTraceError } from '../../../shared/errors'
import { calculateMastery, calculateProjectProgress, calculateWeightedProgress } from './domain/progress'
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

function notFound(label: string): YouTraceError {
  return new YouTraceError({
    code: 'ENTITY_NOT_FOUND',
    message: `${label}不存在或已进入回收站。`,
    recovery: '请刷新当前页面后重试。'
  })
}
