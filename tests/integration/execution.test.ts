import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ExecutionRepository } from '../../src/main/modules/execution/execution-repository'
import { EffortRecoveryService } from '../../src/main/modules/execution/effort-recovery-service'
import { ExecutionService } from '../../src/main/modules/execution/execution-service'
import { PlanningRepository } from '../../src/main/modules/planning/planning-repository'
import { PlanningService } from '../../src/main/modules/planning/planning-service'
import { PracticeRepository } from '../../src/main/modules/practice/practice-repository'
import { PracticeService } from '../../src/main/modules/practice/practice-service'
import { WorkspaceManager } from '../../src/main/workspace/workspace-manager'

let workspaceManager: WorkspaceManager
let planning: PlanningService
let execution: ExecutionService
let fixtureRoot: string

beforeEach(async () => {
  fixtureRoot = await mkdtemp(join(tmpdir(), 'youtrace-execution-test-'))
  workspaceManager = new WorkspaceManager(join(fixtureRoot, 'app-data'))
  await workspaceManager.create(join(fixtureRoot, 'workspace'), '执行测试')
  const planningRepository = new PlanningRepository(() => workspaceManager.getDatabase())
  planning = new PlanningService(planningRepository)
  const practice = new PracticeService(
    new PracticeRepository(() => workspaceManager.getDatabase()),
    planningRepository
  )
  execution = new ExecutionService(
    new ExecutionRepository(() => workspaceManager.getDatabase()),
    planningRepository,
    planning,
    practice
  )
})

afterEach(async () => {
  await workspaceManager.close()
})

describe('execution and evidence application service', () => {
  it('keeps project effort history visible after its task enters the trash', () => {
    const project = planning.createProject({
      areaId: null,
      name: '永久努力验收',
      description: '',
      status: 'active',
      startDate: null,
      targetDate: null,
      successCriteria: '',
      progressMode: 'equal'
    })
    const task = planning.createTask({
      parentTaskId: null,
      projectId: project.id,
      goalId: null,
      milestoneId: null,
      title: '整理章节笔记',
      description: '',
      status: 'ready',
      difficulty: 3,
      priority: 'medium',
      estimatedMinutes: 45,
      progressWeight: null,
      startDate: null,
      dueAt: null,
      verificationCriteria: '',
      includeInProgress: true,
      tagIds: []
    })
    const effort = execution.createManualEffort({
      entityType: 'task',
      entityId: task.id,
      startedAt: '2026-07-30T01:00:00.000Z',
      endedAt: '2026-07-30T01:45:00.000Z',
      effectiveMinutes: 45,
      result: '完成第一版笔记',
      interruptions: '',
      obstacles: '',
      nextStep: '补充示意图',
      energy: 4,
      perceivedDifficulty: 3,
      tagIds: []
    })

    planning.trashTask(task.id)

    const history = planning.listProjectHistory(project.id)
    expect(history).toMatchObject({
      projectId: project.id,
      effortCount: 1,
      totalMinutes: 45
    })
    expect(history.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: effort.id,
          kind: 'effort',
          entityType: 'task',
          entityId: task.id,
          title: task.title,
          action: 'manual',
          summary: '完成第一版笔记',
          minutes: 45
        }),
        expect.objectContaining({
          kind: 'change',
          entityType: 'task',
          entityId: task.id,
          title: task.title,
          action: 'trashed'
        })
      ])
    )
  })

  it('bounds project history rendering while keeping complete effort totals', () => {
    const project = planning.createProject({
      areaId: null,
      name: '大规模项目历史',
      description: '',
      status: 'active',
      startDate: null,
      targetDate: null,
      successCriteria: '',
      progressMode: 'equal'
    })
    const task = planning.createTask({
      parentTaskId: null,
      projectId: project.id,
      goalId: null,
      milestoneId: null,
      title: '批量投入任务',
      description: '',
      status: 'ready',
      difficulty: 3,
      priority: 'medium',
      estimatedMinutes: null,
      progressWeight: null,
      startDate: null,
      dueAt: null,
      verificationCriteria: '',
      includeInProgress: true,
      tagIds: []
    })
    for (let index = 0; index < 205; index += 1) {
      execution.createManualEffort({
        entityType: 'task',
        entityId: task.id,
        startedAt: new Date(Date.UTC(2099, 6, 30, 0, index)).toISOString(),
        endedAt: new Date(Date.UTC(2099, 6, 30, 0, index + 1)).toISOString(),
        effectiveMinutes: 1,
        result: `投入 ${index + 1}`,
        interruptions: '',
        obstacles: '',
        nextStep: '',
        energy: null,
        perceivedDifficulty: null,
        tagIds: []
      })
    }

    const history = planning.listProjectHistory(project.id)
    expect(history).toMatchObject({
      effortCount: 205,
      totalMinutes: 205,
      hasMore: true
    })
    expect(history.entries).toHaveLength(200)
    expect(history.entries[0]).toMatchObject({ kind: 'effort', summary: '投入 205' })
  })

  it('keeps effort, evidence and memo conversion as independent traceable facts', () => {
    const project = planning.createProject({
      areaId: null,
      name: '执行闭环',
      description: '',
      status: 'active',
      startDate: null,
      targetDate: null,
      successCriteria: '',
      progressMode: 'equal'
    })
    const task = planning.createTask({
      parentTaskId: null,
      projectId: project.id,
      goalId: null,
      milestoneId: null,
      title: '完成最小复现',
      description: '',
      status: 'ready',
      difficulty: 4,
      priority: 'high',
      estimatedMinutes: 120,
      progressWeight: null,
      startDate: null,
      dueAt: null,
      verificationCriteria: '测试通过',
      includeInProgress: true,
      tagIds: []
    })

    const active = execution.startEffort({
      entityType: 'task',
      entityId: task.id,
      tagIds: []
    })
    expect(active.endedAt).toBeNull()
    expect(planning.listTasks({ projectId: project.id, statuses: [], tagIds: [], includeDeleted: false, limit: 100, offset: 0 })[0]?.status).toBe('in_progress')
    expect(() =>
      execution.startEffort({ entityType: 'task', entityId: task.id, tagIds: [] })
    ).toThrow(/正在计时/)

    const stopped = execution.stopEffort({
      id: active.id,
      result: '找到环境问题',
      interruptions: '',
      obstacles: '依赖版本不一致',
      nextStep: '固定版本后重试',
      energy: 3,
      perceivedDifficulty: 4
    })
    expect(stopped.endedAt).not.toBeNull()
    expect(stopped.result).toBe('找到环境问题')
    const corrected = execution.correctEffort({
      id: stopped.id,
      startedAt: stopped.startedAt,
      endedAt: stopped.endedAt!,
      effectiveMinutes: 25,
      reason: '暂停期间忘记停止计时'
    })
    expect(corrected.effectiveMinutes).toBe(25)
    expect(execution.listEffortHistory(stopped.id)).toMatchObject([
      {
        reason: '暂停期间忘记停止计时',
        before: { effectiveMinutes: stopped.effectiveMinutes },
        after: { effectiveMinutes: 25 }
      }
    ])

    const startedAt = '2026-07-30T01:00:00.000Z'
    const manual = execution.createManualEffort({
      entityType: 'task',
      entityId: task.id,
      startedAt,
      endedAt: '2026-07-30T02:00:00.000Z',
      effectiveMinutes: 60,
      result: '完成复现',
      interruptions: '',
      obstacles: '',
      nextStep: '整理结果',
      energy: 4,
      perceivedDifficulty: 3,
      tagIds: []
    })
    expect(manual.source).toBe('manual')
    expect(
      planning.listTasks({ projectId: project.id, statuses: [], tagIds: [], includeDeleted: false, limit: 100, offset: 0 })[0]?.actualMinutes
    ).toBeGreaterThanOrEqual(60)
    expect(execution.summarizeEfforts(null, null)).toMatchObject({
      entryCount: 2,
      totalMinutes: 85
    })

    const evidence = execution.createEvidence({
      kind: 'note',
      title: '复现结果',
      note: '测试在固定版本后通过',
      source: null,
      verificationStatus: 'completed',
      entityType: 'task',
      entityId: task.id,
      tagIds: []
    })
    expect(planning.listTasks({ projectId: project.id, statuses: [], tagIds: [], includeDeleted: false, limit: 100, offset: 0 })[0]?.status).toBe('in_progress')
    expect(execution.updateEvidenceStatus({ id: evidence.id, status: 'verified', reason: '已重新运行' }).verificationStatus).toBe('verified')

    const memo = execution.createMemo({
      kind: 'idea',
      title: '',
      body: '把失败环境整理成可复用检查表',
      projectId: project.id,
      sourceLink: null,
      tagIds: []
    })
    const converted = execution.convertMemoToTask({
      memoId: memo.id,
      projectId: project.id,
      title: '整理环境检查表',
      estimatedMinutes: 30
    })
    expect(converted.description).toBe(memo.body)
    expect(execution.listMemos(false).find((item) => item.id === memo.id)?.processedAt).not.toBeNull()

    const relation = workspaceManager
      .getDatabase()
      .prepare(
        `SELECT relation_type FROM entity_relations
          WHERE source_id = ? AND target_id = ?`
      )
      .get(memo.id, converted.id) as { relation_type: string }
    expect(relation.relation_type).toBe('CONVERTED_TO')

    const knowledgeMemo = execution.createMemo({
      kind: 'knowledge',
      title: '认证状态机',
      body: '记录认证失败分支和状态跳转。',
      projectId: project.id,
      sourceLink: 'https://example.com/reference',
      tagIds: []
    })
    const knowledge = execution.convertMemoToLearning({
      memoId: knowledgeMemo.id,
      projectId: project.id,
      target: 'knowledge',
      title: '认证状态机'
    })
    expect(knowledge).toMatchObject({
      title: '认证状态机',
      content: knowledgeMemo.body
    })
    expect(execution.listEvidence('memo', knowledgeMemo.id)).toHaveLength(1)
    expect(execution.archiveMemo(knowledgeMemo.id, true).archived).toBe(true)
    expect(execution.listMemos(false)).not.toContainEqual(
      expect.objectContaining({ id: knowledgeMemo.id })
    )
    expect(execution.listMemos(false, true)).toContainEqual(
      expect.objectContaining({
        id: knowledgeMemo.id,
        archived: true,
        convertedTo: { entityType: 'knowledge', entityId: knowledge.id }
      })
    )
  })

  it('requires an auditable reason to start through an incomplete dependency', () => {
    const project = planning.createProject({
      areaId: null,
      name: '依赖执行',
      description: '',
      status: 'active',
      startDate: null,
      targetDate: null,
      successCriteria: '',
      progressMode: 'equal'
    })
    const createTask = (title: string) =>
      planning.createTask({
        parentTaskId: null,
        projectId: project.id,
        goalId: null,
        milestoneId: null,
        title,
        description: '',
        status: 'ready',
        difficulty: null,
        priority: 'medium',
        estimatedMinutes: 20,
        progressWeight: null,
        startDate: null,
        dueAt: null,
        verificationCriteria: '',
        includeInProgress: true,
        tagIds: []
      })
    const prerequisite = createTask('先完成环境配置')
    const dependent = createTask('运行实验')
    planning.addTaskDependency({
      taskId: dependent.id,
      prerequisiteTaskId: prerequisite.id,
      overrideReason: null
    })
    expect(() =>
      execution.startEffort({
        entityType: 'task',
        entityId: dependent.id,
        tagIds: []
      })
    ).toThrow(/阻塞/)
    const active = execution.startEffort({
      entityType: 'task',
      entityId: dependent.id,
      dependencyOverrideReason: '先验证无环境依赖的子步骤',
      tagIds: []
    })
    expect(active.entityId).toBe(dependent.id)
    const audit = workspaceManager
      .getDatabase()
      .prepare(
        `SELECT after_json FROM audit_events
          WHERE entity_type = 'task' AND entity_id = ? AND action = 'dependency_overridden'`
      )
      .get(dependent.id) as { after_json: string }
    expect(JSON.parse(audit.after_json)).toMatchObject({
      reason: '先验证无环境依赖的子步骤'
    })
  })

  it('suspends and resumes an unfinished timer without creating a second effort', () => {
    const project = planning.createProject({
      areaId: null,
      name: '暂停计时',
      description: '',
      status: 'active',
      startDate: null,
      targetDate: null,
      successCriteria: '',
      progressMode: 'equal'
    })
    const task = planning.createTask({
      parentTaskId: null,
      projectId: project.id,
      goalId: null,
      milestoneId: null,
      title: '离线前暂停',
      description: '',
      status: 'ready',
      difficulty: null,
      priority: 'medium',
      estimatedMinutes: 30,
      progressWeight: null,
      startDate: null,
      dueAt: null,
      verificationCriteria: '',
      includeInProgress: true,
      tagIds: []
    })
    const started = execution.startEffort({
      entityType: 'task',
      entityId: task.id,
      tagIds: []
    })

    expect(execution.suspendEffort(started.id).suspendedAt).not.toBeNull()
    expect(execution.suspendEffort(started.id).id).toBe(started.id)
    expect(execution.resumeEffort(started.id)).toMatchObject({
      id: started.id,
      suspendedAt: null
    })
    expect(
      execution.listEfforts({
        entityType: null,
        entityId: null,
        from: null,
        to: null,
        limit: 100,
        offset: 0
      })
    ).toHaveLength(1)
  })

  it('freezes an interrupted effort at its last heartbeat and waits for confirmation', async () => {
    const project = planning.createProject({
      areaId: null,
      name: '异常恢复',
      description: '',
      status: 'active',
      startDate: null,
      targetDate: null,
      successCriteria: '',
      progressMode: 'equal'
    })
    const task = planning.createTask({
      parentTaskId: null,
      projectId: project.id,
      goalId: null,
      milestoneId: null,
      title: '恢复未完成计时',
      description: '',
      status: 'ready',
      difficulty: null,
      priority: 'medium',
      estimatedMinutes: 30,
      progressWeight: null,
      startDate: null,
      dueAt: null,
      verificationCriteria: '',
      includeInProgress: true,
      tagIds: []
    })
    const started = execution.startEffort({
      entityType: 'task',
      entityId: task.id,
      tagIds: []
    })
    const heartbeatAt = new Date(Date.parse(started.startedAt) + 5 * 60_000).toISOString()
    const detectedAt = new Date(Date.parse(heartbeatAt) + 60 * 60_000).toISOString()
    const confirmedEndAt = new Date(Date.parse(heartbeatAt) + 2 * 60_000).toISOString()
    const recovery = new EffortRecoveryService(workspaceManager, execution)
    await recovery.recordHeartbeat(heartbeatAt)

    await workspaceManager.close()
    workspaceManager = new WorkspaceManager(join(fixtureRoot, 'app-data'))
    expect((await workspaceManager.bootstrap()).status).toBe('ready')
    const planningRepository = new PlanningRepository(() => workspaceManager.getDatabase())
    planning = new PlanningService(planningRepository)
    execution = new ExecutionService(
      new ExecutionRepository(() => workspaceManager.getDatabase()),
      planningRepository,
      planning
    )
    const restartedRecovery = new EffortRecoveryService(workspaceManager, execution)

    expect(await restartedRecovery.recoverInterruptedEffort(detectedAt)).toMatchObject({
      effortId: started.id,
      entityTitle: '恢复未完成计时',
      lastHeartbeatAt: heartbeatAt,
      detectedAt
    })
    expect(execution.getActiveEffort()).toMatchObject({
      id: started.id,
      suspendedAt: heartbeatAt
    })
    expect(await restartedRecovery.getPendingRecovery()).toMatchObject({
      effortId: started.id,
      lastHeartbeatAt: heartbeatAt
    })

    const stopped = await restartedRecovery.resolvePendingRecovery({
      action: 'stop',
      endedAt: confirmedEndAt
    })
    expect(stopped).toMatchObject({
      id: started.id,
      endedAt: confirmedEndAt,
      effectiveMinutes: 7,
      suspendedAt: null
    })
    expect(await restartedRecovery.getPendingRecovery()).toBeNull()
  })
})
