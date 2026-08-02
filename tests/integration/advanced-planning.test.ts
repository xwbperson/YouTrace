import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DataRepository } from '../../src/main/modules/data/data-repository'
import { PlanningRepository } from '../../src/main/modules/planning/planning-repository'
import { PlanningService } from '../../src/main/modules/planning/planning-service'
import { WorkspaceManager } from '../../src/main/workspace/workspace-manager'

let workspaceManager: WorkspaceManager
let planning: PlanningService
let dataRepository: DataRepository

beforeEach(async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'youtrace-advanced-planning-'))
  workspaceManager = new WorkspaceManager(join(fixtureRoot, 'app-data'))
  await workspaceManager.create(join(fixtureRoot, 'workspace'), '高级规划测试')
  planning = new PlanningService(new PlanningRepository(() => workspaceManager.getDatabase()))
  dataRepository = new DataRepository(() => workspaceManager.getDatabase())
})

afterEach(async () => {
  await workspaceManager.close()
})

function createTask(
  projectId: string,
  title: string,
  options: { tagIds?: string[]; dueAt?: string | null; difficulty?: number | null } = {}
) {
  return planning.createTask({
    parentTaskId: null,
    projectId,
    goalId: null,
    milestoneId: null,
    title,
    description: '',
    status: 'ready',
    difficulty: options.difficulty ?? 3,
    priority: 'high',
    estimatedMinutes: 45,
    progressWeight: null,
    startDate: '2026-07-30',
    dueAt: options.dueAt ?? '2026-08-02T10:00:00.000Z',
    verificationCriteria: '',
    includeInProgress: true,
    tagIds: options.tagIds ?? []
  })
}

describe('advanced planning lifecycle', () => {
  it('manages editable areas and archived projects', () => {
    expect(planning.listAreas()).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: '学习', archived: false })])
    )
    const area = planning.createArea({
      name: '研究',
      color: '#334455',
      icon: 'flask-conical',
      description: '可验证实验'
    })
    const project = planning.createProject({
      areaId: area.id,
      name: '无线安全实验',
      description: '',
      status: 'active',
      startDate: null,
      targetDate: null,
      successCriteria: '完成最小复现',
      progressMode: 'equal'
    })
    planning.updateProject({ id: project.id, status: 'archived' })
    expect(planning.listProjects()).toHaveLength(0)
    expect(planning.listProjects(true)).toMatchObject([{ id: project.id, status: 'archived' }])

    planning.updateArea({ id: area.id, archived: true })
    expect(planning.listAreas()).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: area.id })])
    )
    expect(planning.listAreas(true)).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: area.id, archived: true })])
    )
  })

  it('preserves checklist history and creates one independent recurring instance', () => {
    const project = planning.createProject({
      areaId: null,
      name: '周期执行',
      description: '',
      status: 'active',
      startDate: null,
      targetDate: null,
      successCriteria: '',
      progressMode: 'equal'
    })
    const task = createTask(project.id, '每日复习')
    const item = planning.createChecklistItem({ taskId: task.id, text: '回顾错题' })
    expect(planning.updateChecklistItem({ id: item.id, checked: true })).toMatchObject({
      checked: true,
      text: '回顾错题'
    })
    expect(planning.setChecklistProgress({ taskId: task.id, enabled: true })).toMatchObject({
      progress: 1,
      status: 'ready'
    })

    planning.setTaskRecurrence({
      taskId: task.id,
      rule: {
        frequency: 'daily',
        intervalValue: 1,
        weekdays: [],
        nextOccurrence: '2026-08-03'
      }
    })
    planning.updateTask({ id: task.id, status: 'completed' })
    planning.updateTask({ id: task.id, status: 'completed' })

    const tasks = planning.listTasks({
      projectId: project.id,
      statuses: [],
      tagIds: [],
      includeDeleted: false,
      limit: 20,
      offset: 0
    })
    expect(tasks).toHaveLength(2)
    const next = tasks.find((candidate) => candidate.id !== task.id)!
    expect(next).toMatchObject({
      title: task.title,
      status: 'scheduled',
      startDate: '2026-08-03'
    })
    expect(planning.getTaskRecurrence(task.id)?.active).toBe(false)
    expect(planning.getTaskRecurrence(next.id)).toMatchObject({
      active: true,
      nextOccurrence: '2026-08-04'
    })
    expect(planning.listChecklist(task.id)).toMatchObject([{ checked: true }])
    expect(planning.listChecklist(next.id)).toHaveLength(0)
  })

  it('calculates parent progress from included direct children', () => {
    const project = planning.createProject({
      areaId: null,
      name: '子任务进度',
      description: '',
      status: 'active',
      startDate: null,
      targetDate: null,
      successCriteria: '',
      progressMode: 'equal'
    })
    const parent = createTask(project.id, '完成章节')
    const child = planning.createTask({
      parentTaskId: parent.id,
      projectId: project.id,
      goalId: null,
      milestoneId: null,
      title: '阅读章节',
      description: '',
      status: 'completed',
      difficulty: 2,
      priority: 'medium',
      estimatedMinutes: 30,
      progressWeight: null,
      startDate: null,
      dueAt: null,
      verificationCriteria: '',
      includeInProgress: true,
      tagIds: []
    })
    planning.createTask({
      parentTaskId: parent.id,
      projectId: project.id,
      goalId: null,
      milestoneId: null,
      title: '补充阅读',
      description: '',
      status: 'ready',
      difficulty: 2,
      priority: 'low',
      estimatedMinutes: 90,
      progressWeight: null,
      startDate: null,
      dueAt: null,
      verificationCriteria: '',
      includeInProgress: false,
      tagIds: []
    })
    const tasks = planning.listTasks({
      projectId: project.id,
      statuses: [],
      tagIds: [],
      includeDeleted: false,
      limit: 20,
      offset: 0
    })
    expect(tasks.find((task) => task.id === parent.id)?.progress).toBe(1)
    expect(tasks.find((task) => task.id === child.id)?.progress).toBe(1)
  })

  it('combines filters, saves views, and merges tag relations without deleting objects', () => {
    const project = planning.createProject({
      areaId: null,
      name: '筛选项目',
      description: '',
      status: 'active',
      startDate: null,
      targetDate: null,
      successCriteria: '',
      progressMode: 'equal'
    })
    const source = planning.createTag({
      name: '网络',
      color: '#216E65',
      icon: null,
      description: ''
    })
    const target = planning.createTag({
      name: '计算机网络',
      color: '#1F5F58',
      icon: null,
      description: ''
    })
    const task = createTask(project.id, '完成协议分析', {
      tagIds: [source.id, target.id],
      difficulty: 5,
      dueAt: '2020-01-01T10:00:00.000Z'
    })
    planning.assignTag({ tagId: source.id, entityType: 'project', entityId: project.id })

    const filtered = planning.search({
      query: '',
      entityTypes: ['task'],
      statuses: ['ready'],
      tagIds: [source.id, target.id],
      projectId: project.id,
      difficulties: [5],
      priorities: ['high'],
      overdueOnly: true,
      limit: 20
    })
    expect(filtered).toMatchObject([{ entityId: task.id }])

    const custom = planning.saveView({
      name: '网络危险任务',
      filters: {
        query: '',
        entityTypes: ['task'],
        statuses: [],
        tagIds: [target.id],
        projectId: null,
        dueFrom: null,
        dueTo: null,
        difficulties: [],
        priorities: [],
        overdueOnly: true,
        untaggedOnly: false,
        hasEvidence: null,
        limit: 20
      }
    })
    expect(planning.listSavedViews()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: custom.id, isPreset: false }),
        expect.objectContaining({ isPreset: true })
      ])
    )
    const renamed = planning.updateSavedView({ id: custom.id, name: '网络高风险任务' })
    expect(renamed).toMatchObject({ id: custom.id, name: '网络高风险任务', isPreset: false })

    const statsBefore = planning.getTagStats(source.id)
    expect(statsBefore.entityCounts).toMatchObject({ project: 1, task: 1 })
    planning.mergeTags({ sourceTagId: source.id, targetTagId: target.id })
    expect(planning.listTags()).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: source.id })])
    )
    expect(planning.getTagStats(target.id).entityCounts).toMatchObject({ project: 1, task: 1 })
    expect(
      planning.listTasks({
        projectId: project.id,
        statuses: [],
        tagIds: [target.id],
        includeDeleted: false,
        limit: 20,
        offset: 0
      })
    ).toMatchObject([{ id: task.id }])

    planning.deleteSavedView(custom.id)
    const savedViewTrash = dataRepository.listTrash().find((item) => item.entityType === 'saved_view')!
    expect(savedViewTrash.title).toBe('网络高风险任务')
    expect(dataRepository.restoreTrash(savedViewTrash.id, new Date().toISOString())).not.toBeNull()
    expect(planning.listSavedViews()).toEqual(expect.arrayContaining([expect.objectContaining({ id: custom.id })]))
    planning.deleteSavedView(custom.id)
    const restoredViewTrash = dataRepository.listTrash().find((item) => item.entityType === 'saved_view')!
    expect(dataRepository.purgeTrash(restoredViewTrash.id, new Date().toISOString())).not.toBeNull()
    expect(planning.listSavedViews()).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: custom.id })]))
  })

  it('edits tags and moves archived tags through the trash lifecycle', () => {
    const tag = planning.createTag({
      name: '原标签',
      color: '#216E65',
      icon: null,
      description: ''
    })
    expect(planning.updateTag({ id: tag.id, name: '修改后的标签', color: '#334455' })).toMatchObject({
      name: '修改后的标签',
      color: '#334455'
    })
    expect(planning.archiveTag(tag.id, true).archived).toBe(true)
    expect(planning.listTags()).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: tag.id })]))
    expect(planning.listTags(true)).toEqual(expect.arrayContaining([expect.objectContaining({ id: tag.id, archived: true })]))

    planning.trashTag(tag.id)
    const trash = dataRepository.listTrash().find((item) => item.entityType === 'tag')!
    expect(trash.title).toBe('修改后的标签')
    expect(dataRepository.restoreTrash(trash.id, new Date().toISOString())).not.toBeNull()
    expect(planning.listTags(true)).toEqual(expect.arrayContaining([expect.objectContaining({ id: tag.id })]))

    planning.trashTag(tag.id)
    const restoredTrash = dataRepository.listTrash().find((item) => item.entityType === 'tag')!
    expect(dataRepository.purgeTrash(restoredTrash.id, new Date().toISOString())).not.toBeNull()
    expect(planning.listTags(true)).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: tag.id })]))
  })
})
