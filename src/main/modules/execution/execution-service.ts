import { randomUUID } from 'node:crypto'
import type {
  ConvertMemoToTaskInput,
  CreateEvidenceInput,
  CreateManualEffortInput,
  CreateMemoInput,
  EffortEntry,
  EffortListInput,
  Evidence,
  Memo,
  StartEffortInput,
  StopEffortInput,
  Task,
  UpdateEvidenceStatusInput
} from '../../../shared/contracts'
import { YouTraceError } from '../../../shared/errors'
import type { PlanningRepository } from '../planning/planning-repository'
import type { PlanningService } from '../planning/planning-service'
import { ExecutionRepository } from './execution-repository'

export class ExecutionService {
  constructor(
    private readonly repository: ExecutionRepository,
    private readonly planningRepository: PlanningRepository,
    private readonly planningService: PlanningService
  ) {}

  getActiveEffort(): EffortEntry | null {
    return this.repository.getActiveEffort()
  }

  startEffort(input: StartEffortInput): EffortEntry {
    const existing = this.repository.getActiveEffort()
    if (existing) {
      throw new YouTraceError({
        code: 'EFFORT_ALREADY_ACTIVE',
        message: `“${existing.entityTitle ?? '当前事项'}”正在计时。`,
        recovery: '请先停止当前计时，再开始新的投入。'
      })
    }
    const entity = this.resolveEntity(input.entityType, input.entityId)
    const id = randomUUID()
    this.repository.insertStartedEffort(
      id,
      input,
      entity.title,
      entity.projectId,
      new Date().toISOString()
    )
    if (input.entityType === 'task') {
      const task = this.planningRepository.getTask(input.entityId)
      if (task && ['inbox', 'ready', 'scheduled'].includes(task.status)) {
        this.planningService.updateTask({ id: task.id, status: 'in_progress' })
      }
    }
    return this.requireEffort(id)
  }

  stopEffort(input: StopEffortInput): EffortEntry {
    const current = this.repository.getEffort(input.id)
    if (!current || current.endedAt) {
      throw new YouTraceError({
        code: 'EFFORT_NOT_ACTIVE',
        message: '这段计时已经停止或不存在。'
      })
    }
    const endedAt = new Date().toISOString()
    const effectiveMinutes = Math.max(
      0,
      Math.round((Date.parse(endedAt) - Date.parse(current.startedAt)) / 60_000)
    )
    if (!this.repository.stopEffort(input.id, input, endedAt, effectiveMinutes)) {
      throw new YouTraceError({
        code: 'EFFORT_STOP_CONFLICT',
        message: '计时状态已经发生变化，没有重复写入。'
      })
    }
    return this.requireEffort(input.id)
  }

  createManualEffort(input: CreateManualEffortInput): EffortEntry {
    if (Date.parse(input.endedAt) < Date.parse(input.startedAt)) {
      throw new YouTraceError({
        code: 'EFFORT_TIME_INVALID',
        message: '结束时间不能早于开始时间。'
      })
    }
    const entity = this.resolveEntity(input.entityType, input.entityId)
    const id = randomUUID()
    this.repository.insertManualEffort(
      id,
      input,
      entity.title,
      entity.projectId,
      new Date().toISOString()
    )
    return this.requireEffort(id)
  }

  listEfforts(input: EffortListInput): EffortEntry[] {
    return this.repository.listEfforts(input)
  }

  createEvidence(input: CreateEvidenceInput): Evidence {
    if (input.kind === 'file' || input.kind === 'image') {
      throw new YouTraceError({
        code: 'EVIDENCE_FILE_REQUIRES_IMPORT',
        message: '文件和图片证据必须通过工作区文件导入流程添加。',
        recovery: '请选择“导入文件”并从系统对话框选择文件。'
      })
    }
    const id = randomUUID()
    this.repository.insertEvidence(id, input, new Date().toISOString())
    return this.requireEvidence(id)
  }

  listEvidence(entityType: string | null, entityId: string | null): Evidence[] {
    return this.repository.listEvidence(entityType, entityId)
  }

  updateEvidenceStatus(input: UpdateEvidenceStatusInput): Evidence {
    if (
      !this.repository.updateEvidenceStatus(
        input.id,
        input.status,
        input.reason,
        new Date().toISOString()
      )
    ) {
      throw entityNotFound('成果证据')
    }
    return this.requireEvidence(input.id)
  }

  createMemo(input: CreateMemoInput): Memo {
    const id = randomUUID()
    this.repository.insertMemo(id, input, new Date().toISOString())
    return this.requireMemo(id)
  }

  listMemos(inboxOnly: boolean): Memo[] {
    return this.repository.listMemos(inboxOnly)
  }

  convertMemoToTask(input: ConvertMemoToTaskInput): Task {
    const memo = this.repository.getMemo(input.memoId)
    if (!memo) throw entityNotFound('备忘')
    const task = this.planningService.createTask({
      parentTaskId: null,
      projectId: input.projectId,
      goalId: null,
      milestoneId: null,
      title: input.title,
      description: memo.body,
      status: 'ready',
      difficulty: null,
      priority: 'medium',
      estimatedMinutes: input.estimatedMinutes,
      progressWeight: null,
      startDate: null,
      dueAt: null,
      verificationCriteria: '',
      includeInProgress: true,
      tagIds: memo.tagIds
    })
    this.repository.markMemoConverted(memo.id, task.id, new Date().toISOString())
    return task
  }

  private requireEffort(id: string): EffortEntry {
    const effort = this.repository.getEffort(id)
    if (!effort) throw entityNotFound('努力记录')
    return effort
  }

  private requireEvidence(id: string): Evidence {
    const evidence = this.repository.getEvidence(id)
    if (!evidence) throw entityNotFound('成果证据')
    return evidence
  }

  private requireMemo(id: string): Memo {
    const memo = this.repository.getMemo(id)
    if (!memo) throw entityNotFound('备忘')
    return memo
  }

  private resolveEntity(
    entityType: StartEffortInput['entityType'],
    entityId: string
  ): { title: string; projectId: string | null } {
    if (entityType === 'task') {
      const task = this.planningRepository.getTask(entityId)
      if (!task) throw entityNotFound('任务')
      return { title: task.title, projectId: task.projectId }
    }
    if (entityType === 'project') {
      const project = this.planningRepository.getProject(entityId)
      if (!project) throw entityNotFound('项目')
      return { title: project.name, projectId: project.id }
    }
    if (entityType === 'milestone') {
      const milestone = this.planningRepository.getMilestone(entityId)
      if (!milestone) throw entityNotFound('里程碑')
      return { title: milestone.title, projectId: milestone.project_id }
    }
    if (entityType === 'goal') {
      const goal = this.planningRepository.getGoal(entityId)
      if (!goal) throw entityNotFound('目标')
      return { title: goal.title, projectId: goal.project_id }
    }
    if (entityType === 'memo') {
      const memo = this.repository.getMemo(entityId)
      if (!memo) throw entityNotFound('备忘')
      return { title: memo.title || memo.body.slice(0, 80), projectId: null }
    }
    throw new YouTraceError({
      code: 'ENTITY_TYPE_NOT_READY',
      message: '当前对象类型暂时不能记录投入。'
    })
  }
}

function entityNotFound(label: string): YouTraceError {
  return new YouTraceError({
    code: 'ENTITY_NOT_FOUND',
    message: `${label}不存在或已进入回收站。`
  })
}
