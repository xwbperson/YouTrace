import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DataRepository } from '../../src/main/modules/data/data-repository'
import { ExecutionRepository } from '../../src/main/modules/execution/execution-repository'
import { ExecutionService } from '../../src/main/modules/execution/execution-service'
import { PlanningRepository } from '../../src/main/modules/planning/planning-repository'
import { PlanningService } from '../../src/main/modules/planning/planning-service'
import { SettingsRepository } from '../../src/main/modules/settings/settings-repository'
import { SettingsService } from '../../src/main/modules/settings/settings-service'
import { TemporalRepository } from '../../src/main/modules/temporal/temporal-repository'
import { TemporalService } from '../../src/main/modules/temporal/temporal-service'
import { WorkspaceManager } from '../../src/main/workspace/workspace-manager'

let workspaceManager: WorkspaceManager
let planning: PlanningService
let temporal: TemporalService
let execution: ExecutionService
let settings: SettingsService
let dataRepository: DataRepository

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
  dataRepository = new DataRepository(() => workspaceManager.getDatabase())
  execution = new ExecutionService(
    new ExecutionRepository(() => workspaceManager.getDatabase()),
    planningRepository,
    planning
  )
  settings = new SettingsService(
    new SettingsRepository(() => workspaceManager.getDatabase())
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

  it('keeps calendar dates and instants stable across a daylight-saving transition', () => {
    const plan = temporal.createPlan({
      periodType: 'day',
      startDate: '2026-03-08',
      endDate: '2026-03-08',
      title: '夏令时当天计划',
      focusResult: '',
      capacityMinutes: 60,
      items: []
    })
    expect(plan).toMatchObject({
      startDate: '2026-03-08',
      endDate: '2026-03-08'
    })

    const block = temporal.createTimeBlock({
      taskId: null,
      title: '跨越夏令时跳时',
      note: '',
      startsAt: '2026-03-08T06:30:00.000Z',
      endsAt: '2026-03-08T07:30:00.000Z',
      timezone: 'America/New_York'
    })
    expect(Date.parse(block.endsAt) - Date.parse(block.startsAt)).toBe(60 * 60 * 1_000)

    temporal.createCountdown({
      title: '夏令时后的目标',
      targetAt: '2026-03-09T04:00:00.000Z',
      timezone: 'America/New_York',
      workingDays: [0, 1, 2, 3, 4, 5, 6],
      bufferDays: 0,
      importance: 'normal',
      entityType: null,
      entityId: null,
      remainingMinutes: 120,
      tagIds: []
    })
    expect(temporal.listCountdowns('2026-03-07T17:00:00.000Z')[0]).toMatchObject({
      naturalDays: 2,
      effectiveWorkdays: 2,
      suggestedDailyMinutes: 60
    })
  })

  it('does not rewrite completed task or effort instants when the workspace timezone changes', () => {
    const project = planning.createProject({
      areaId: null,
      name: '时区变更项目',
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
      title: '已完成记录',
      description: '',
      status: 'ready',
      difficulty: null,
      priority: 'medium',
      estimatedMinutes: 60,
      progressWeight: null,
      startDate: '2026-03-08',
      dueAt: null,
      verificationCriteria: '',
      includeInProgress: true,
      tagIds: []
    })
    const completed = planning.updateTask({ id: task.id, status: 'completed' })
    const effort = execution.createManualEffort({
      entityType: 'task',
      entityId: task.id,
      startedAt: '2026-03-08T06:30:00.000Z',
      endedAt: '2026-03-08T07:30:00.000Z',
      effectiveMinutes: 60,
      result: '保留原始时刻',
      interruptions: '',
      obstacles: '',
      nextStep: '',
      energy: null,
      perceivedDifficulty: null,
      tagIds: []
    })

    settings.updatePreferences({
      ...settings.getPreferences(),
      timezone: 'America/New_York'
    })

    const storedTask = planning.listTasks({
      projectId: project.id,
      statuses: [],
      tagIds: [],
      includeDeleted: false,
      limit: 100,
      offset: 0
    })[0]!
    const storedEffort = execution.listEfforts({
      entityType: 'task',
      entityId: task.id,
      from: null,
      to: null,
      limit: 100,
      offset: 0
    })[0]!
    expect(storedTask).toMatchObject({
      startDate: '2026-03-08',
      completedAt: completed.completedAt
    })
    expect(storedEffort).toMatchObject({
      startedAt: effort.startedAt,
      endedAt: effort.endedAt
    })
  })

  it('edits plans, time blocks and countdowns through the trash lifecycle', () => {
    const plan = temporal.createPlan({
      periodType: 'week',
      startDate: '2026-07-27',
      endDate: '2026-08-02',
      title: '原计划',
      focusResult: '',
      capacityMinutes: 300,
      items: []
    })
    const block = temporal.createTimeBlock({
      taskId: null,
      title: '原时间块',
      note: '',
      startsAt: '2026-07-30T01:00:00.000Z',
      endsAt: '2026-07-30T02:00:00.000Z',
      timezone: 'Asia/Shanghai'
    })
    const countdown = temporal.createCountdown({
      title: '原倒计时',
      targetAt: '2026-08-06T12:00:00.000Z',
      timezone: 'Asia/Shanghai',
      workingDays: [1, 2, 3, 4, 5],
      bufferDays: 1,
      importance: 'normal',
      entityType: null,
      entityId: null,
      remainingMinutes: 120,
      tagIds: []
    })

    expect(temporal.updatePlan({ id: plan.id, title: '修改后的计划', capacityMinutes: 480 })).toMatchObject({
      title: '修改后的计划',
      capacityMinutes: 480
    })
    expect(temporal.updateTimeBlock({ id: block.id, title: '修改后的时间块', note: '保留上下文' })).toMatchObject({
      title: '修改后的时间块',
      note: '保留上下文'
    })
    expect(temporal.updateCountdown({ id: countdown.id, title: '修改后的倒计时', bufferDays: 2 })).toMatchObject({
      title: '修改后的倒计时',
      bufferDays: 2
    })

    temporal.trashPlan(plan.id)
    temporal.trashTimeBlock(block.id)
    temporal.trashCountdown(countdown.id)
    const trash = dataRepository.listTrash()
    expect(trash.map((item) => item.entityType).sort()).toEqual(['countdown', 'plan', 'time_block'])

    for (const item of trash) expect(dataRepository.restoreTrash(item.id, new Date().toISOString())).not.toBeNull()
    expect(temporal.listPlans('2026-07-27', '2026-08-02')).toHaveLength(1)
    expect(temporal.listTimeBlocks({ start: '2026-07-30T00:00:00.000Z', end: '2026-07-31T00:00:00.000Z' })).toHaveLength(1)
    expect(temporal.listCountdowns('2026-07-30T12:00:00.000Z')).toHaveLength(1)

    temporal.trashPlan(plan.id)
    temporal.trashTimeBlock(block.id)
    temporal.trashCountdown(countdown.id)
    for (const item of dataRepository.listTrash()) expect(dataRepository.purgeTrash(item.id, new Date().toISOString())).not.toBeNull()
    expect(temporal.listPlans('2026-07-27', '2026-08-02')).toHaveLength(0)
    expect(temporal.listTimeBlocks({ start: '2026-07-30T00:00:00.000Z', end: '2026-07-31T00:00:00.000Z' })).toHaveLength(0)
    expect(temporal.listCountdowns('2026-07-30T12:00:00.000Z')).toHaveLength(0)
  })
})
