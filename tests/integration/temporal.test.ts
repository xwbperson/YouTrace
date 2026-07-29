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
import { WorkspaceManager } from '../../src/main/workspace/workspace-manager'

let workspaceManager: WorkspaceManager
let planning: PlanningService
let temporal: TemporalService
let execution: ExecutionService

beforeEach(async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'youtrace-temporal-test-'))
  workspaceManager = new WorkspaceManager(join(fixtureRoot, 'app-data'))
  await workspaceManager.create(join(fixtureRoot, 'workspace'), '时间测试')
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
})

afterEach(async () => {
  await workspaceManager.close()
})

describe('plans, calendar and countdowns', () => {
  it('references one task from a plan, detects time conflicts and moves only the arrangement', () => {
    const project = planning.createProject({
      areaId: null,
      name: '期限项目',
      description: '',
      status: 'active',
      startDate: '2026-07-30',
      targetDate: '2026-08-06',
      successCriteria: '',
      progressMode: 'equal'
    })
    const task = planning.createTask({
      parentTaskId: null,
      projectId: project.id,
      goalId: null,
      milestoneId: null,
      title: '完成阶段报告',
      description: '',
      status: 'ready',
      difficulty: 4,
      priority: 'high',
      estimatedMinutes: 120,
      progressWeight: null,
      startDate: '2026-07-30',
      dueAt: '2026-08-06T12:00:00.000Z',
      verificationCriteria: '',
      includeInProgress: true,
      tagIds: []
    })
    const plan = temporal.createPlan({
      periodType: 'week',
      startDate: '2026-07-27',
      endDate: '2026-08-02',
      title: '本周计划',
      focusResult: '形成阶段报告',
      capacityMinutes: 60,
      items: [{ entityType: 'task', entityId: task.id, titleSnapshot: task.title }]
    })
    expect(plan).toMatchObject({ plannedMinutes: 120, capacityMinutes: 60, overloaded: true })
    expect(plan.items[0]?.entityId).toBe(task.id)

    const first = temporal.createTimeBlock({
      taskId: task.id,
      title: '阶段报告',
      note: '',
      startsAt: '2026-07-30T01:00:00.000Z',
      endsAt: '2026-07-30T02:00:00.000Z',
      timezone: 'Asia/Shanghai'
    })
    const second = temporal.createTimeBlock({
      taskId: task.id,
      title: '补充资料',
      note: '',
      startsAt: '2026-07-30T01:30:00.000Z',
      endsAt: '2026-07-30T02:30:00.000Z',
      timezone: 'Asia/Shanghai'
    })
    expect(first.conflicts).toEqual([])
    expect(second.conflicts).toEqual([first.id])

    const moved = temporal.moveTimeBlock({
      id: second.id,
      startsAt: '2026-07-30T02:00:00.000Z',
      endsAt: '2026-07-30T03:00:00.000Z'
    })
    expect(moved.conflicts).toEqual([])
    expect(planning.listTasks({
      projectId: project.id,
      statuses: [],
      tagIds: [],
      includeDeleted: false,
      limit: 100,
      offset: 0
    })[0]?.dueAt).toBe('2026-08-06T12:00:00.000Z')
  })

  it('calculates natural days, effective workdays, required speed and evidence-based risk', () => {
    const project = planning.createProject({
      areaId: null,
      name: '倒计时项目',
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
      title: '备考',
      description: '',
      status: 'ready',
      difficulty: 3,
      priority: 'high',
      estimatedMinutes: 240,
      progressWeight: null,
      startDate: null,
      dueAt: null,
      verificationCriteria: '',
      includeInProgress: true,
      tagIds: []
    })
    for (const [startedAt, endedAt] of [
      ['2026-07-28T01:00:00.000Z', '2026-07-28T02:00:00.000Z'],
      ['2026-07-29T01:00:00.000Z', '2026-07-29T02:00:00.000Z']
    ] as const) {
      execution.createManualEffort({
        entityType: 'task',
        entityId: task.id,
        startedAt,
        endedAt,
        effectiveMinutes: 60,
        result: '',
        interruptions: '',
        obstacles: '',
        nextStep: '',
        energy: null,
        perceivedDifficulty: null,
        tagIds: []
      })
    }
    temporal.createCountdown({
      title: '阶段考试',
      targetAt: '2026-08-06T12:00:00.000Z',
      timezone: 'UTC',
      workingDays: [1, 2, 3, 4, 5],
      bufferDays: 1,
      importance: 'high',
      entityType: 'task',
      entityId: task.id,
      remainingMinutes: 240,
      tagIds: []
    })
    const countdown = temporal.listCountdowns('2026-07-30T12:00:00.000Z')[0]!
    expect(countdown).toMatchObject({
      naturalDays: 7,
      effectiveWorkdays: 5,
      suggestedDailyMinutes: 60,
      recentDailyMinutes: 60,
      risk: 'normal'
    })
    expect(countdown.expectedCompletionAt).toBe('2026-08-03')
  })
})
