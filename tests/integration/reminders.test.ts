import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PlanningRepository } from '../../src/main/modules/planning/planning-repository'
import { PlanningService } from '../../src/main/modules/planning/planning-service'
import { ReminderRepository } from '../../src/main/modules/reminders/reminder-repository'
import { ReminderService } from '../../src/main/modules/reminders/reminder-service'
import { TemporalRepository } from '../../src/main/modules/temporal/temporal-repository'
import { TemporalService } from '../../src/main/modules/temporal/temporal-service'
import { WorkspaceManager } from '../../src/main/workspace/workspace-manager'

let workspaceManager: WorkspaceManager
let planning: PlanningService
let temporal: TemporalService
let reminders: ReminderService

beforeEach(async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'youtrace-reminder-test-'))
  workspaceManager = new WorkspaceManager(join(fixtureRoot, 'app-data'))
  await workspaceManager.create(join(fixtureRoot, 'workspace'), '提醒测试')
  const planningRepository = new PlanningRepository(() => workspaceManager.getDatabase())
  planning = new PlanningService(planningRepository)
  temporal = new TemporalService(
    new TemporalRepository(() => workspaceManager.getDatabase()),
    planningRepository
  )
  reminders = new ReminderService(
    new ReminderRepository(() => workspaceManager.getDatabase())
  )
})

afterEach(async () => {
  await workspaceManager.close()
})

describe('background reminders', () => {
  it('deduplicates due reminders and summarizes bursts instead of firing every item', () => {
    const now = new Date('2026-07-30T04:00:00.000Z')
    const project = planning.createProject({
      areaId: null,
      name: '提醒项目',
      description: '',
      status: 'active',
      startDate: null,
      targetDate: null,
      successCriteria: '',
      progressMode: 'equal'
    })
    for (let index = 0; index < 4; index += 1) {
      planning.createTask({
        parentTaskId: null,
        projectId: project.id,
        goalId: null,
        milestoneId: null,
        title: `即将到期任务 ${index + 1}`,
        description: '',
        status: 'ready',
        difficulty: null,
        priority: 'medium',
        estimatedMinutes: 30,
        progressWeight: null,
        startDate: null,
        dueAt: new Date(now.getTime() + 20 * 60_000).toISOString(),
        verificationCriteria: '',
        includeInProgress: true,
        tagIds: []
      })
    }
    temporal.createTimeBlock({
      taskId: null,
      title: '即将开始的时间块',
      note: '',
      startsAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
      endsAt: new Date(now.getTime() + 65 * 60_000).toISOString(),
      timezone: 'UTC'
    })
    reminders.updateSettings({
      enabled: true,
      quietStart: '22:00',
      quietEnd: '07:00',
      taskDue: true,
      timeBlocks: true,
      countdowns: false,
      reviews: false,
      stagnation: false,
      overload: false
    })

    const notices = reminders.refreshAndProcess(now.toISOString())
    expect(notices).toHaveLength(1)
    expect(notices[0]).toMatchObject({
      title: '有 5 项提醒',
      sourceType: 'summary',
      aggregatedCount: 5
    })
    expect(reminders.refreshAndProcess(now.toISOString())).toEqual([])
    expect(reminders.listUpcoming()).toEqual([])
  })

  it('keeps due reminders pending during quiet time', () => {
    const now = new Date()
    const currentMinutes = now.getHours() * 60 + now.getMinutes()
    const startMinutes = (currentMinutes + 1_439) % 1_440
    const endMinutes = (currentMinutes + 1) % 1_440
    const clock = (value: number): string =>
      `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
    const project = planning.createProject({
      areaId: null,
      name: '静默提醒项目',
      description: '',
      status: 'active',
      startDate: null,
      targetDate: null,
      successCriteria: '',
      progressMode: 'equal'
    })
    planning.createTask({
      parentTaskId: null,
      projectId: project.id,
      goalId: null,
      milestoneId: null,
      title: '静默时间到期任务',
      description: '',
      status: 'ready',
      difficulty: null,
      priority: 'medium',
      estimatedMinutes: 30,
      progressWeight: null,
      startDate: null,
      dueAt: new Date(now.getTime() + 10 * 60_000).toISOString(),
      verificationCriteria: '',
      includeInProgress: true,
      tagIds: []
    })
    reminders.updateSettings({
      enabled: true,
      quietStart: clock(startMinutes),
      quietEnd: clock(endMinutes),
      taskDue: true,
      timeBlocks: false,
      countdowns: false,
      reviews: false,
      stagnation: false,
      overload: false
    })
    expect(reminders.refreshAndProcess(now.toISOString())).toEqual([])
    expect(reminders.listUpcoming()).toHaveLength(1)
  })
})
