import { randomUUID } from 'node:crypto'
import type {
  ConvertMemoToTaskInput,
  ConvertMemoToLearningInput,
  CorrectEffortInput,
  CreateEvidenceInput,
  CreateManualEffortInput,
  CreateMemoInput,
  EffortEntry,
  EffortRevision,
  EffortSummary,
  EffortListInput,
  Evidence,
  Memo,
  KnowledgeItem,
  Mistake,
  StartEffortInput,
  StopEffortInput,
  UpdateMemoInput,
  Task,
  UpdateEvidenceInput,
  UpdateEvidenceStatusInput
} from '../../../shared/contracts'
import { YouTraceError } from '../../../shared/errors'
import type { PlanningRepository } from '../planning/planning-repository'
import type { PlanningService } from '../planning/planning-service'
import type { PracticeService } from '../practice/practice-service'
import { ExecutionRepository } from './execution-repository'

export class ExecutionService {
  constructor(
    private readonly repository: ExecutionRepository,
    private readonly planningRepository: PlanningRepository,
    private readonly planningService: PlanningService,
    private readonly practiceService?: PracticeService
  ) {}

  getActiveEffort(): EffortEntry | null {
    return this.repository.getActiveEffort()
  }

  summarizeEfforts(from: string | null, to: string | null): EffortSummary {
    return this.repository.summarizeEfforts(from, to)
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
    if (input.entityType === 'task') {
      const blocking = this.planningService
        .listTaskDependencies(input.entityId)
        .filter(
          (dependency) =>
            !dependency.prerequisiteAvailable || dependency.prerequisiteStatus !== 'completed'
        )
      if (blocking.length > 0 && !input.dependencyOverrideReason) {
        throw new YouTraceError({
          code: 'TASK_DEPENDENCY_BLOCKED',
          message: `任务仍被 ${blocking.length} 项前置任务阻塞。`,
          details: {
            blockers: blocking.map((dependency) => ({
              id: dependency.prerequisiteTaskId,
              title: dependency.prerequisiteTitle,
              reason: dependency.blockedReason
            }))
          },
          recovery: '请先完成前置任务，或填写强制开始原因。'
        })
      }
      if (blocking.length > 0 && input.dependencyOverrideReason) {
        this.planningRepository.recordDependencyOverride(
          input.entityId,
          input.dependencyOverrideReason,
          new Date().toISOString()
        )
      }
    }
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

  suspendEffort(id: string): EffortEntry {
    return this.suspendEffortAt(id, new Date().toISOString())
  }

  suspendEffortAt(id: string, suspendedAt: string): EffortEntry {
    const current = this.repository.getEffort(id)
    if (!current || current.endedAt) {
      throw new YouTraceError({
        code: 'EFFORT_NOT_ACTIVE',
        message: '这段计时已经停止或不存在。'
      })
    }
    if (Date.parse(suspendedAt) < Date.parse(current.startedAt)) {
      throw new YouTraceError({
        code: 'EFFORT_TIME_INVALID',
        message: '暂停时间不能早于计时开始时间。'
      })
    }
    if (!current.suspendedAt) {
      this.repository.suspendEffort(id, suspendedAt)
    }
    return this.requireEffort(id)
  }

  resumeEffort(id: string): EffortEntry {
    const current = this.repository.getEffort(id)
    if (!current || current.endedAt) {
      throw new YouTraceError({
        code: 'EFFORT_NOT_ACTIVE',
        message: '这段计时已经停止或不存在。'
      })
    }
    if (current.suspendedAt) {
      this.repository.resumeEffort(id, new Date().toISOString())
    }
    return this.requireEffort(id)
  }

  stopEffort(input: StopEffortInput): EffortEntry {
    return this.stopEffortAt(input, new Date().toISOString())
  }

  stopEffortAt(input: StopEffortInput, endedAt: string): EffortEntry {
    const current = this.repository.getEffort(input.id)
    if (!current || current.endedAt) {
      throw new YouTraceError({
        code: 'EFFORT_NOT_ACTIVE',
        message: '这段计时已经停止或不存在。'
      })
    }
    if (Date.parse(endedAt) < Date.parse(current.startedAt)) {
      throw new YouTraceError({
        code: 'EFFORT_TIME_INVALID',
        message: '结束时间不能早于计时开始时间。'
      })
    }
    const pausedMilliseconds = this.repository.pausedMilliseconds(input.id, endedAt)
    const effectiveMinutes = Math.max(
      0,
      Math.round(
        (Date.parse(endedAt) - Date.parse(current.startedAt) - pausedMilliseconds) / 60_000
      )
    )
    if (!this.repository.stopEffort(input.id, input, endedAt, effectiveMinutes)) {
      throw new YouTraceError({
        code: 'EFFORT_STOP_CONFLICT',
        message: '计时状态已经发生变化，没有重复写入。'
      })
    }
    return this.requireEffort(input.id)
  }

  closeOpenSuspensionAt(id: string, at: string): EffortEntry {
    const current = this.repository.getEffort(id)
    if (!current || current.endedAt || !current.suspendedAt) {
      throw new YouTraceError({
        code: 'EFFORT_NOT_SUSPENDED',
        message: '这段计时当前没有等待确认的暂停状态。'
      })
    }
    this.repository.closeOpenSuspensionAt(id, at)
    return this.requireEffort(id)
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

  correctEffort(input: CorrectEffortInput): EffortEntry {
    const current = this.repository.getEffort(input.id)
    if (!current) throw entityNotFound('努力记录')
    if (!current.endedAt) {
      throw new YouTraceError({
        code: 'EFFORT_ACTIVE_CORRECTION_DENIED',
        message: '活动计时必须先停止，才能更正时间。'
      })
    }
    if (Date.parse(input.endedAt) < Date.parse(input.startedAt)) {
      throw new YouTraceError({
        code: 'EFFORT_TIME_INVALID',
        message: '结束时间不能早于开始时间。'
      })
    }
    if (!this.repository.correctEffort(current, input, new Date().toISOString())) {
      throw entityNotFound('努力记录')
    }
    return this.requireEffort(input.id)
  }

  listEffortHistory(id: string): EffortRevision[] {
    if (!this.repository.getEffort(id)) throw entityNotFound('努力记录')
    return this.repository.listEffortHistory(id)
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

  updateEvidence(input: UpdateEvidenceInput): Evidence {
    if ((input.entityType === null) !== (input.entityId === null)) {
      throw new YouTraceError({
        code: 'EVIDENCE_RELATION_INCOMPLETE',
        message: '成果关联类型和对象需要同时设置。'
      })
    }
    if (!this.repository.updateEvidence(input.id, input, new Date().toISOString())) {
      throw entityNotFound('成果证据')
    }
    return this.requireEvidence(input.id)
  }

  trashEvidence(id: string): void {
    if (!this.repository.trashEvidence(id, new Date().toISOString())) {
      throw entityNotFound('成果证据')
    }
  }

  createMemo(input: CreateMemoInput): Memo {
    if (input.projectId && !this.planningRepository.getProject(input.projectId)) {
      throw entityNotFound('关联项目')
    }
    const id = randomUUID()
    this.repository.insertMemo(id, input, new Date().toISOString())
    if (input.sourceLink) {
      this.createEvidence({
        kind: 'link',
        title: input.title || input.body.slice(0, 80),
        note: '由备忘保存的来源链接',
        source: input.sourceLink,
        verificationStatus: 'prepared',
        entityType: 'memo',
        entityId: id,
        tagIds: input.tagIds
      })
    }
    return this.requireMemo(id)
  }

  updateMemo(input: UpdateMemoInput): Memo {
    const current = this.requireMemo(input.id)
    const projectId = input.projectId === undefined ? current.projectId : input.projectId
    if (projectId && !this.planningRepository.getProject(projectId)) {
      throw entityNotFound('关联项目')
    }
    this.repository.updateMemo(
      input.id,
      {
        kind: input.kind ?? current.kind,
        title: input.title ?? current.title,
        body: input.body ?? current.body,
        projectId,
        tagIds: input.tagIds ?? current.tagIds
      },
      new Date().toISOString()
    )
    return this.requireMemo(input.id)
  }

  listMemos(inboxOnly: boolean, includeArchived = false): Memo[] {
    return this.repository.listMemos(inboxOnly, includeArchived)
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
    this.repository.markMemoConverted(memo.id, 'task', task.id, new Date().toISOString())
    return task
  }

  convertMemoToLearning(input: ConvertMemoToLearningInput): KnowledgeItem | Mistake {
    const memo = this.repository.getMemo(input.memoId)
    if (!memo) throw entityNotFound('备忘')
    if (!this.practiceService) {
      throw new YouTraceError({
        code: 'LEARNING_SERVICE_UNAVAILABLE',
        message: '学习模块当前不可用。'
      })
    }
    if (input.target === 'knowledge') {
      const item = this.practiceService.createKnowledge({
        projectId: input.projectId,
        milestoneId: null,
        title: input.title,
        content: memo.body,
        mastery: null,
        nextReviewDate: null
      })
      this.repository.markMemoConverted(memo.id, 'knowledge', item.id, new Date().toISOString())
      return item
    }
    const item = this.practiceService.createMistake({
      projectId: input.projectId,
      knowledgeItemId: null,
      question: input.title,
      wrongAnswer: '',
      correctAnswer: '',
      analysis: memo.body,
      mastery: null,
      nextReviewDate: null
    })
    this.repository.markMemoConverted(memo.id, 'mistake', item.id, new Date().toISOString())
    return item
  }

  archiveMemo(id: string, archived: boolean): Memo {
    if (!this.repository.archiveMemo(id, archived, new Date().toISOString())) {
      throw entityNotFound('备忘')
    }
    return this.requireMemo(id)
  }

  deleteArchivedMemo(id: string): void {
    const memo = this.requireMemo(id)
    if (!memo.archived) {
      throw new YouTraceError({
        code: 'MEMO_NOT_ARCHIVED',
        message: '请先归档备忘，再执行永久删除。'
      })
    }
    if (!this.repository.deleteArchivedMemo(id, new Date().toISOString())) {
      throw entityNotFound('备忘')
    }
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
