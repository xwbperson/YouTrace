import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PlanningRepository } from '../../src/main/modules/planning/planning-repository'
import { PlanningService } from '../../src/main/modules/planning/planning-service'
import { WorkspaceManager } from '../../src/main/workspace/workspace-manager'

let workspaceManager: WorkspaceManager
let planning: PlanningService

beforeEach(async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'youtrace-planning-test-'))
  workspaceManager = new WorkspaceManager(join(fixtureRoot, 'app-data'))
  await workspaceManager.create(join(fixtureRoot, 'workspace'), '规划测试')
  planning = new PlanningService(new PlanningRepository(() => workspaceManager.getDatabase()))
})

afterEach(async () => {
  await workspaceManager.close()
})

describe('planning application service', () => {
  it('creates, updates, searches and soft-deletes projects and tasks', () => {
    const project = planning.createProject({
      areaId: null,
      name: '计算机网络课程',
      description: '围绕教材章节建立真实学习轨迹',
      status: 'active',
      startDate: '2026-07-30',
      targetDate: '2026-12-20',
      successCriteria: '完成章节测试并形成证据',
      progressMode: 'workload'
    })
    const tag = planning.createTag({
      name: '计算机网络',
      color: '#216E65',
      icon: null,
      description: '课程相关内容'
    })
    const task = planning.createTask({
      parentTaskId: null,
      projectId: project.id,
      goalId: null,
      milestoneId: null,
      title: '阅读网络体系结构',
      description: '阅读教材第一章并整理分层模型',
      status: 'ready',
      difficulty: 3,
      priority: 'high',
      estimatedMinutes: 90,
      progressWeight: null,
      startDate: '2026-07-30',
      dueAt: '2026-08-01T12:00:00.000Z',
      verificationCriteria: '形成一页结构笔记',
      includeInProgress: true,
      tagIds: [tag.id]
    })

    expect(planning.listProjects()).toHaveLength(1)
    expect(planning.listTasks({ projectId: project.id, statuses: [], tagIds: [], includeDeleted: false, limit: 100, offset: 0 })).toMatchObject([
      {
        id: task.id,
        difficulty: 3,
        priority: 'high',
        estimatedMinutes: 90,
        actualMinutes: 0,
        tagIds: [tag.id]
      }
    ])

    const completed = planning.updateTask({ id: task.id, status: 'completed' })
    expect(completed.status).toBe('completed')
    expect(completed.completedAt).not.toBeNull()
    expect(completed.projectId).toBe(project.id)
    expect(completed.title).toBe(task.title)

    expect(
      planning.search({ query: '网络', entityTypes: [], limit: 20 }).map((result) => result.title)
    ).toEqual(expect.arrayContaining(['计算机网络课程', '阅读网络体系结构']))
    expect(
      planning
        .search({ query: '体系结构', entityTypes: ['task'], limit: 20 })
        .map((result) => result.entityId)
    ).toEqual([task.id])

    planning.trashTask(task.id)
    expect(
      planning.listTasks({
        projectId: project.id,
        statuses: [],
        tagIds: [],
        includeDeleted: false,
        limit: 100,
        offset: 0
      })
    ).toHaveLength(0)
    expect(planning.search({ query: '体系结构', entityTypes: [], limit: 20 })).toHaveLength(0)

    const auditCount = workspaceManager
      .getDatabase()
      .prepare('SELECT COUNT(*) AS count FROM audit_events')
      .get() as { count: number }
    expect(auditCount.count).toBeGreaterThanOrEqual(5)
  })
})
