import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DataRepository } from '../../src/main/modules/data/data-repository'
import { DataService } from '../../src/main/modules/data/data-service'
import { PackageService } from '../../src/main/modules/data/package-service'
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
  vi.restoreAllMocks()
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
    expect(data.getEvidenceOpenTarget(imported.evidence.id)).toMatchObject({
      type: 'file',
      target: join(sourceRoot, imported.attachment.relativePath)
    })
    workspaceManager
      .getDatabase()
      .prepare(
        `INSERT INTO evidence(
           id, kind, title, note, source, verification_status, created_at, updated_at
         ) VALUES ('77000000-0000-4000-8000-000000000001', 'link', '危险链接', '',
                   'javascript:alert(1)', 'prepared', ?, ?)`
      )
      .run(new Date().toISOString(), new Date().toISOString())
    expect(() =>
      data.getEvidenceOpenTarget('77000000-0000-4000-8000-000000000001')
    ).toThrow(/协议/)

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

  it('migrates by verified copy and preserves the active source when a later target is invalid', async () => {
    createProjectAndTask('迁移保留任务')
    const originalRoot = workspaceManager.getCurrentPath()
    const migratedRoot = join(fixtureRoot, 'migrated-workspace')
    const migrated = await data.migrateWorkspace(migratedRoot)

    expect(migrated.workspace.path).toBe(migratedRoot)
    expect(workspaceManager.getCurrentPath()).toBe(migratedRoot)
    expect((await stat(originalRoot)).isDirectory()).toBe(true)
    expect(
      JSON.parse(await readFile(join(originalRoot, '.youtrace-migrated.json'), 'utf8'))
    ).toMatchObject({
      targetPath: migratedRoot,
      sourcePreserved: true
    })
    expect(
      workspaceManager
        .getDatabase()
        .prepare("SELECT title FROM tasks WHERE title = '迁移保留任务'")
        .get()
    ).toEqual({ title: '迁移保留任务' })

    const invalidTarget = join(fixtureRoot, 'non-empty-target')
    await mkdir(invalidTarget, { recursive: true })
    await writeFile(join(invalidTarget, 'occupied.txt'), 'do not overwrite', 'utf8')
    await expect(data.migrateWorkspace(invalidTarget)).rejects.toThrow()
    expect(workspaceManager.getCurrentPath()).toBe(migratedRoot)
    expect(await readFile(join(invalidTarget, 'occupied.txt'), 'utf8')).toBe('do not overwrite')
  })

  it('keeps using the source workspace when restore extraction is interrupted', async () => {
    createProjectAndTask('恢复中断保护任务')
    const source = workspaceManager.getCurrentPath()
    const backup = await data.createBackup('恢复中断测试')
    vi.spyOn(PackageService.prototype, 'extractVerified').mockRejectedValueOnce(
      new Error('simulated extraction interruption')
    )

    await expect(
      data.restoreBackup(backup.id, join(fixtureRoot, 'interrupted-restore'))
    ).rejects.toThrow(/simulated extraction interruption/)
    expect(workspaceManager.getCurrentPath()).toBe(source)
    expect(
      workspaceManager
        .getDatabase()
        .prepare("SELECT title FROM tasks WHERE title = '恢复中断保护任务'")
        .get()
    ).toEqual({ title: '恢复中断保护任务' })
  })

  it.each([
    {
      systemCode: 'ENOSPC',
      appCode: 'TARGET_SPACE_INSUFFICIENT',
      message: '目标磁盘空间不足，工作区未切换。'
    },
    {
      systemCode: 'EACCES',
      appCode: 'TARGET_NOT_WRITABLE',
      message: '目标目录不可写，工作区未切换。'
    }
  ])(
    'preserves the source when migration extraction fails with $systemCode',
    async ({ systemCode, appCode, message }) => {
      createProjectAndTask(`迁移失败保护-${systemCode}`)
      const source = workspaceManager.getCurrentPath()
      const systemError = Object.assign(new Error(`simulated ${systemCode}`), {
        code: systemCode
      })
      vi.spyOn(PackageService.prototype, 'extractVerified').mockRejectedValueOnce(systemError)

      await expect(
        data.migrateWorkspace(join(fixtureRoot, `failed-migration-${systemCode}`))
      ).rejects.toMatchObject({
        code: appCode,
        message
      })
      expect(workspaceManager.getCurrentPath()).toBe(source)
      expect(
        workspaceManager
          .getDatabase()
          .prepare('SELECT title FROM tasks WHERE title = ?')
          .get(`迁移失败保护-${systemCode}`)
      ).toEqual({ title: `迁移失败保护-${systemCode}` })
    }
  )
})
