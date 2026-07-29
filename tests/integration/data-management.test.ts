import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DataRepository } from '../../src/main/modules/data/data-repository'
import { DataService } from '../../src/main/modules/data/data-service'
import { PlanningRepository } from '../../src/main/modules/planning/planning-repository'
import { PlanningService } from '../../src/main/modules/planning/planning-service'
import { WorkspaceManager } from '../../src/main/workspace/workspace-manager'

let fixtureRoot: string
let sourceRoot: string
let workspaceManager: WorkspaceManager
let planning: PlanningService
let data: DataService

beforeEach(async () => {
  fixtureRoot = await mkdtemp(join(tmpdir(), 'youtrace-data-test-'))
  sourceRoot = join(fixtureRoot, 'workspace')
  workspaceManager = new WorkspaceManager(join(fixtureRoot, 'app-data'))
  await workspaceManager.create(sourceRoot, '数据安全测试')
  planning = new PlanningService(
    new PlanningRepository(() => workspaceManager.getDatabase())
  )
  data = new DataService(
    workspaceManager,
    new DataRepository(() => workspaceManager.getDatabase())
  )
})

afterEach(async () => {
  await workspaceManager.close()
})

function createProjectAndTask(taskTitle: string): { projectId: string; taskId: string } {
  const project = planning.createProject({
    areaId: null,
    name: '备份项目',
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
    title: taskTitle,
    description: '',
    status: 'ready',
    difficulty: 3,
    priority: 'high',
    estimatedMinutes: 60,
    progressWeight: null,
    startDate: null,
    dueAt: null,
    verificationCriteria: '',
    includeInProgress: true,
    tagIds: []
  })
  return { projectId: project.id, taskId: task.id }
}

describe('workspace backup, restore and portable files', () => {
  it('round-trips a WAL database and evidence file without mixing later writes', async () => {
    const first = createProjectAndTask('备份时间点任务')
    const sourceFile = join(fixtureRoot, 'evidence.txt')
    await writeFile(sourceFile, 'verified evidence bytes', 'utf8')
    const imported = await data.importEvidenceFile(sourceFile, {
      kind: 'file',
      title: '备份证据',
      note: '应随工作区恢复',
      verificationStatus: 'verified',
      entityType: 'task',
      entityId: first.taskId,
      tagIds: []
    })
    const duplicated = await data.importEvidenceFile(sourceFile, {
      kind: 'image',
      title: '重复文件证据',
      note: '',
      verificationStatus: 'prepared',
      entityType: 'task',
      entityId: first.taskId,
      tagIds: []
    })
    expect(duplicated.attachment).toMatchObject({
      id: imported.attachment.id,
      reused: true
    })

    const backup = await data.createBackup('往返测试')
    const verification = await data.verifyBackup(backup.id)
    expect(verification).toMatchObject({
      valid: true,
      workspaceId: workspaceManager.getCurrent()!.id,
      schemaVersion: 9
    })
    planning.createTask({
      parentTaskId: null,
      projectId: first.projectId,
      goalId: null,
      milestoneId: null,
      title: '备份后新增任务',
      description: '',
      status: 'ready',
      difficulty: null,
      priority: 'medium',
      estimatedMinutes: null,
      progressWeight: null,
      startDate: null,
      dueAt: null,
      verificationCriteria: '',
      includeInProgress: true,
      tagIds: []
    })

    const restoredRoot = join(fixtureRoot, 'restored-workspace')
    const restored = await data.restoreBackup(backup.id, restoredRoot)
    expect(restored.workspace.path).toBe(restoredRoot)
    const restoredTasks = workspaceManager
      .getDatabase()
      .prepare('SELECT title FROM tasks ORDER BY created_at')
      .all() as Array<{ title: string }>
    expect(restoredTasks.map((task) => task.title)).toEqual(['备份时间点任务'])
    const restoredAttachment = join(restoredRoot, imported.attachment.relativePath)
    expect(await readFile(restoredAttachment, 'utf8')).toBe('verified evidence bytes')

    const sourceDatabase = new Database(join(sourceRoot, 'database', 'youtrace.sqlite3'), {
      readonly: true
    })
    const sourceTasks = sourceDatabase
      .prepare('SELECT title FROM tasks ORDER BY created_at')
      .all() as Array<{ title: string }>
    sourceDatabase.close()
    expect(sourceTasks.map((task) => task.title)).toEqual([
      '备份时间点任务',
      '备份后新增任务'
    ])
    expect((await stat(sourceRoot)).isDirectory()).toBe(true)
    expect((await stat(restored.reportPath)).isFile()).toBe(true)
  })

  it('exports readable files and restores or purges soft-deleted tasks behind a backup gate', async () => {
    const { taskId } = createProjectAndTask('回收站任务')
    workspaceManager.getDatabase().prepare('DELETE FROM searchable_content').run()
    expect(data.rebuildSearchIndex().indexedCount).toBeGreaterThanOrEqual(2)
    expect(
      workspaceManager
        .getDatabase()
        .prepare("SELECT COUNT(*) AS count FROM searchable_content WHERE entity_type = 'task'")
        .get()
    ).toEqual({ count: 1 })
    const exported = await data.exportReadable()
    expect(exported.files).toEqual(['README.md', 'projects.csv', 'tasks.csv', 'efforts.csv'])
    expect(await readFile(join(exported.directory, 'tasks.csv'), 'utf8')).toContain('回收站任务')

    planning.trashTask(taskId)
    const trash = data.listTrash()
    expect(trash[0]).toMatchObject({
      entityType: 'task',
      entityId: taskId,
      title: '回收站任务'
    })
    expect(data.restoreTrash(trash[0]!.id).entityId).toBe(taskId)
    expect(planning.listTasks({
      projectId: null,
      statuses: [],
      tagIds: [],
      includeDeleted: false,
      limit: 100,
      offset: 0
    })).toHaveLength(1)

    planning.trashTask(taskId)
    const secondTrash = data.listTrash()[0]!
    await expect(data.purgeTrash(secondTrash.id, '永久删除')).rejects.toThrow(/备份/)
    await data.createBackup('永久删除保护点')
    await data.purgeTrash(secondTrash.id, '永久删除')
    expect(data.listTrash()).toHaveLength(0)
    expect(workspaceManager.getDatabase().prepare('SELECT COUNT(*) AS count FROM tasks').get())
      .toEqual({ count: 0 })
  })
})
