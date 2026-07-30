import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ExecutionRepository } from '../../src/main/modules/execution/execution-repository'
import { ExecutionService } from '../../src/main/modules/execution/execution-service'
import { PlanningRepository } from '../../src/main/modules/planning/planning-repository'
import { PlanningService } from '../../src/main/modules/planning/planning-service'
import { TemporalRepository } from '../../src/main/modules/temporal/temporal-repository'
import { TemporalService } from '../../src/main/modules/temporal/temporal-service'
import { DataRepository } from '../../src/main/modules/data/data-repository'
import { WorkflowRepository } from '../../src/main/modules/workflow/workflow-repository'
import { WorkflowService } from '../../src/main/modules/workflow/workflow-service'
import { WorkspaceManager } from '../../src/main/workspace/workspace-manager'

let workspaceManager: WorkspaceManager
let planning: PlanningService
let temporal: TemporalService
let execution: ExecutionService
let workflow: WorkflowService

beforeEach(async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'youtrace-workflow-test-'))
  workspaceManager = new WorkspaceManager(join(fixtureRoot, 'app-data'))
  await workspaceManager.create(join(fixtureRoot, 'workspace'), '复盘模板测试')
  const planningRepository = new PlanningRepository(() => workspaceManager.getDatabase())
  planning = new PlanningService(planningRepository)
  temporal = new TemporalService(
    new TemporalRepository(() => workspaceManager.getDatabase()),
    planningRepository
  )
  execution = new ExecutionService(
    new ExecutionRepository(() => workspaceManager.getDatabase()),
    planningRepository,
    planning
  )
  workflow = new WorkflowService(
    new WorkflowRepository(() => workspaceManager.getDatabase()),
    planning
  )
})

afterEach(async () => {
  await workspaceManager.close()
})

describe('review snapshots and project templates', () => {
  it('keeps the original weekly snapshot while applying future task adjustments', () => {
    const project = planning.createProject({
      areaId: null,
      name: '周复盘项目',
      description: '',
      status: 'active',
      startDate: '2026-07-27',
      targetDate: null,
      successCriteria: '',
      progressMode: 'equal'
    })
    const task = planning.createTask({
      parentTaskId: null,
      projectId: project.id,
      goalId: null,
      milestoneId: null,
      title: '本周未完成任务',
      description: '',
      status: 'ready',
      difficulty: 3,
      priority: 'high',
      estimatedMinutes: 90,
      progressWeight: null,
      startDate: '2026-07-27',
      dueAt: '2026-08-02T12:00:00.000Z',
      verificationCriteria: '',
      includeInProgress: true,
      tagIds: []
    })
    temporal.createPlan({
      periodType: 'week',
      startDate: '2026-07-27',
      endDate: '2026-08-02',
      title: '第 31 周计划',
      focusResult: '交付一项成果',
      capacityMinutes: 300,
      items: [{ entityType: 'task', entityId: task.id, titleSnapshot: task.title }]
    })
    execution.createManualEffort({
      entityType: 'task',
      entityId: task.id,
      startedAt: '2026-07-30T01:00:00.000Z',
      endedAt: '2026-07-30T02:00:00.000Z',
      effectiveMinutes: 60,
      result: '完成一半',
      interruptions: '',
      obstacles: '',
      nextStep: '',
      energy: null,
      perceivedDifficulty: null,
      tagIds: []
    })
    const review = workflow.createReview({
      reviewType: 'weekly',
      startDate: '2026-07-27',
      endDate: '2026-08-02',
      title: '第 31 周复盘'
    })
    expect(review.snapshot.tasks[0]).toMatchObject({
      id: task.id,
      status: 'ready',
      dueAt: '2026-08-02T12:00:00.000Z',
      actualMinutes: 60
    })

    workflow.updateReview({
      id: review.id,
      importantOutcomes: '确认了下一步',
      blockers: '时间估计偏低',
      nextFirstStep: '先补充验证',
      status: 'completed'
    })
    const adjusted = workflow.applyReviewAdjustments({
      reviewId: review.id,
      reason: '容量不足，顺延到下周',
      adjustments: [
        {
          taskId: task.id,
          action: 'reschedule',
          newDueAt: '2026-08-09T12:00:00.000Z'
        }
      ]
    })
    expect(adjusted.adjustmentCount).toBe(1)
    expect(adjusted.snapshot.tasks[0]).toMatchObject({
      status: 'ready',
      dueAt: '2026-08-02T12:00:00.000Z'
    })
    expect(planning.listTasks({
      projectId: project.id,
      statuses: [],
      tagIds: [],
      includeDeleted: false,
      limit: 100,
      offset: 0
    })[0]).toMatchObject({
      status: 'scheduled',
      dueAt: '2026-08-09T12:00:00.000Z'
    })
  })

  it('moves a completed review to recoverable trash without changing its snapshot', () => {
    const review = workflow.createReview({
      reviewType: 'weekly',
      startDate: '2026-07-27',
      endDate: '2026-08-02',
      title: '可删除复盘'
    })
    workflow.updateReview({
      id: review.id,
      importantOutcomes: '保留这段复盘正文',
      status: 'completed'
    })

    workflow.trashReview(review.id)

    expect(workflow.listReviews()).toHaveLength(0)
    const dataRepository = new DataRepository(() => workspaceManager.getDatabase())
    const trash = dataRepository.listTrash()
    expect(trash).toEqual([
      expect.objectContaining({
        entityType: 'review',
        entityId: review.id,
        title: '可删除复盘'
      })
    ])

    dataRepository.restoreTrash(trash[0]!.id, new Date().toISOString())

    expect(workflow.listReviews()[0]).toMatchObject({
      id: review.id,
      status: 'completed',
      importantOutcomes: '保留这段复盘正文',
      snapshot: review.snapshot
    })
  })

  it('previews five built-in templates and applies or saves structure without history', () => {
    const templates = workflow.listTemplates()
    expect(templates.filter((template) => template.builtIn)).toHaveLength(5)
    const preview = workflow.previewTemplate({
      templateId: 'builtin:course',
      projectName: '计算机网络'
    })
    expect(preview.template).toMatchObject({ milestoneCount: 5, taskCount: 25 })
    expect(preview.milestones[0]?.tasks.map((task) => task.title)).toEqual([
      '阅读教材',
      '整理笔记',
      '完成习题',
      '章节测试',
      '章节复盘'
    ])

    const applied = workflow.applyTemplate({
      templateId: 'builtin:course',
      projectName: '计算机网络'
    })
    expect(applied.milestoneIds).toHaveLength(5)
    expect(applied.taskIds).toHaveLength(25)
    expect(
      workspaceManager.getDatabase().prepare('SELECT COUNT(*) AS count FROM effort_entries').get()
    ).toEqual({ count: 0 })

    const custom = workflow.saveProjectTemplate({
      projectId: applied.project.id,
      name: '我的课程结构',
      description: '从当前项目保存'
    })
    expect(custom).toMatchObject({ builtIn: false, milestoneCount: 5, taskCount: 25 })
    expect(workflow.previewTemplate({
      templateId: custom.id,
      projectName: '新课程'
    }).milestones).toHaveLength(5)
  })
})
