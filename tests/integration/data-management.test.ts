import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DataRepository } from '../../src/main/modules/data/data-repository'
import { DatabaseRecoveryService } from '../../src/main/modules/data/database-recovery-service'
import {
  DataService,
  selectAutomaticBackupsToRetain
} from '../../src/main/modules/data/data-service'
import { PackageService } from '../../src/main/modules/data/package-service'
import { ExecutionRepository } from '../../src/main/modules/execution/execution-repository'
import { ExecutionService } from '../../src/main/modules/execution/execution-service'
import { PlanningRepository } from '../../src/main/modules/planning/planning-repository'
import { PlanningService } from '../../src/main/modules/planning/planning-service'
import { PracticeRepository } from '../../src/main/modules/practice/practice-repository'
import { PracticeService } from '../../src/main/modules/practice/practice-service'
import { WorkflowRepository } from '../../src/main/modules/workflow/workflow-repository'
import { WorkflowService } from '../../src/main/modules/workflow/workflow-service'
import { WorkspaceManager } from '../../src/main/workspace/workspace-manager'

let fixtureRoot: string
let sourceRoot: string
let workspaceManager: WorkspaceManager
let planning: PlanningService
let data: DataService
let execution: ExecutionService
let practice: PracticeService

beforeEach(async () => {
  fixtureRoot = await mkdtemp(join(tmpdir(), 'youtrace-data-test-'))
  sourceRoot = join(fixtureRoot, 'workspace')
  workspaceManager = new WorkspaceManager(join(fixtureRoot, 'app-data'))
  await workspaceManager.create(sourceRoot, '数据安全测试')
  const planningRepository = new PlanningRepository(() => workspaceManager.getDatabase())
  planning = new PlanningService(planningRepository)
  practice = new PracticeService(
    new PracticeRepository(() => workspaceManager.getDatabase()),
    planningRepository
  )
  execution = new ExecutionService(
    new ExecutionRepository(() => workspaceManager.getDatabase()),
    planningRepository,
    planning,
    practice
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
  it('copies multiple course material attachments into the workspace and reopens them', async () => {
    const project = planning.createProject({
      areaId: null,
      name: '课程附件项目',
      description: '',
      status: 'active',
      startDate: null,
      targetDate: null,
      successCriteria: '',
      progressMode: 'equal'
    })
    const course = practice.createCourse({
      projectId: project.id,
      courseName: '课程附件测试',
      examDate: null,
      textbook: { title: '主教材', author: '', edition: '', isbn: '', publisher: '' }
    })
    const material = practice.createCourseMaterial({
      courseId: course.id,
      materialType: 'notes',
      title: '章节笔记',
      author: '',
      edition: '',
      isbn: '',
      publisher: '',
      description: ''
    })
    const original = join(fixtureRoot, 'chapter-note.md')
    await writeFile(original, '# chapter note', 'utf8')

    const first = await data.attachCourseMaterialFile(original, material.id)
    const second = await data.attachCourseMaterialFile(original, material.id)

    expect(first.relativePath).toMatch(/^attachments\/course-materials\//)
    expect(second).toMatchObject({ id: first.id, reused: true })
    expect(await readFile(join(sourceRoot, first.relativePath), 'utf8')).toBe('# chapter note')
    expect(data.listCourseMaterialAttachments(material.id)).toEqual([
      expect.objectContaining({ id: first.id, originalName: 'chapter-note.md' })
    ])
    expect(data.getCourseMaterialAttachmentOpenTarget(first.id)).toBe(
      join(sourceRoot, first.relativePath)
    )
  })

  it('imports an optional attachment for text evidence without losing its source', async () => {
    const sourceFile = join(fixtureRoot, 'reading-note.md')
    await writeFile(sourceFile, '# reading note', 'utf8')

    const imported = await data.importEvidenceFile(sourceFile, {
      kind: 'note',
      title: '带原稿的文本笔记',
      note: '正文摘要',
      source: 'https://example.com/source',
      verificationStatus: 'prepared',
      entityType: null,
      entityId: null,
      tagIds: []
    })

    expect(imported.evidence).toMatchObject({
      kind: 'note',
      source: 'https://example.com/source',
      attachmentCount: 1
    })
    expect(data.listEvidenceAttachments(imported.evidence.id)).toEqual([
      expect.objectContaining({ originalName: 'reading-note.md' })
    ])
    expect(data.getEvidenceAttachmentOpenTarget(imported.attachment.id)).toBe(
      join(sourceRoot, imported.attachment.relativePath)
    )
  })

  it('attaches a workspace file to text evidence and restores both from the trash', async () => {
    const evidence = execution.createEvidence({
      kind: 'note',
      title: '带附件的文本成果',
      note: '正文和原始文件共同构成成果',
      source: null,
      verificationStatus: 'completed',
      entityType: null,
      entityId: null,
      tagIds: []
    })
    const sourceFile = join(fixtureRoot, 'experiment-output.txt')
    await writeFile(sourceFile, 'experiment output bytes', 'utf8')

    const attachment = await data.attachEvidenceFile(sourceFile, evidence.id)

    expect(attachment).toMatchObject({
      originalName: 'experiment-output.txt',
      reused: false
    })
    expect(data.listEvidenceAttachments(evidence.id)).toEqual([
      expect.objectContaining({
        id: attachment.id,
        originalName: 'experiment-output.txt'
      })
    ])

    execution.trashEvidence(evidence.id)
    const trash = data.listTrash().find((item) => item.entityId === evidence.id)!
    expect(trash).toMatchObject({
      entityType: 'evidence',
      title: '带附件的文本成果',
      attachmentCount: 1
    })

    data.restoreTrash(trash.id)

    expect(execution.listEvidence(null, null)).toContainEqual(
      expect.objectContaining({ id: evidence.id, title: '带附件的文本成果' })
    )
    expect(
      await readFile(join(sourceRoot, attachment.relativePath), 'utf8')
    ).toBe('experiment output bytes')
  })

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
      schemaVersion: 13
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

  it('restores and permanently deletes planning hierarchy items without deleting their children', async () => {
    const area = planning.createArea({
      name: '待清理领域',
      color: '#216E65',
      icon: null,
      description: ''
    })
    const project = planning.createProject({
      areaId: area.id,
      name: '层级关系项目',
      description: '',
      status: 'active',
      startDate: null,
      targetDate: null,
      successCriteria: '',
      progressMode: 'equal'
    })
    const goal = planning.createGoal({
      projectId: project.id,
      title: '可恢复目标',
      successCriteria: '',
      targetDate: null,
      measureType: 'milestone',
      status: 'active'
    })
    const milestone = planning.createMilestone({
      projectId: project.id,
      goalId: goal.id,
      title: '可恢复里程碑',
      description: '',
      plannedDate: null,
      estimatedMinutes: null,
      manualWeight: null,
      importanceRating: null,
      mastery: null,
      verificationCriteria: '',
      status: 'not_started',
      includeInProgress: true
    })
    const task = planning.createTask({
      parentTaskId: null,
      projectId: project.id,
      goalId: goal.id,
      milestoneId: milestone.id,
      title: '保留的子任务',
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

    planning.trashGoal(goal.id)
    const goalTrash = data.listTrash().find((item) => item.entityId === goal.id)!
    expect(goalTrash).toMatchObject({ entityType: 'goal', title: '可恢复目标' })
    expect(data.restoreTrash(goalTrash.id).entityId).toBe(goal.id)
    expect(planning.listGoals(project.id)).toHaveLength(1)

    planning.trashGoal(goal.id)
    planning.trashMilestone(milestone.id)
    planning.trashArea(area.id)
    await data.createBackup('计划层级永久删除保护点')
    const trash = data.listTrash()
    await data.purgeTrash(trash.find((item) => item.entityId === goal.id)!.id, '永久删除')
    await data.purgeTrash(trash.find((item) => item.entityId === milestone.id)!.id, '永久删除')
    await data.purgeTrash(trash.find((item) => item.entityId === area.id)!.id, '永久删除')

    const database = workspaceManager.getDatabase()
    expect(database.prepare('SELECT goal_id, milestone_id FROM tasks WHERE id = ?').get(task.id))
      .toEqual({ goal_id: null, milestone_id: null })
    expect(database.prepare('SELECT area_id FROM projects WHERE id = ?').get(project.id))
      .toEqual({ area_id: null })
    expect(database.prepare('SELECT COUNT(*) AS count FROM goals WHERE id = ?').get(goal.id))
      .toEqual({ count: 0 })
    expect(database.prepare('SELECT COUNT(*) AS count FROM milestones WHERE id = ?').get(milestone.id))
      .toEqual({ count: 0 })
    expect(database.prepare('SELECT COUNT(*) AS count FROM areas WHERE id = ?').get(area.id))
      .toEqual({ count: 0 })
  })

  it('updates, restores and permanently deletes practice and learning items', async () => {
    const project = planning.createProject({ areaId: null, name: '学习生命周期', description: '', status: 'active', startDate: null, targetDate: null, successCriteria: '', progressMode: 'equal' })
    const habit = practice.createHabit({ projectId: project.id, name: '旧习惯', description: '', frequency: 'daily', targetCount: 1, weekdays: [], reminderTime: null, startDate: '2026-08-01', endDate: null })
    const metric = practice.createMetric({ projectId: project.id, name: '旧指标', targetValue: 10, unit: '页', direction: 'increase', period: 'total' })
    const course = practice.createCourse({ projectId: project.id, courseName: '旧课程', examDate: null, textbook: { title: '旧教材', author: '', edition: '', isbn: '', publisher: '' } })
    const knowledge = practice.createKnowledge({ projectId: project.id, milestoneId: null, title: '旧知识点', content: '', mastery: null, nextReviewDate: null })
    const mistake = practice.createMistake({ projectId: project.id, knowledgeItemId: knowledge.id, question: '旧错题', wrongAnswer: '', correctAnswer: '', analysis: '', mastery: null, nextReviewDate: null })
    const learningTest = practice.createLearningTest({ projectId: project.id, milestoneId: null, title: '旧测试', score: 60, maxScore: 100, testedAt: '2026-08-01T08:00:00.000Z', note: '' })

    expect(practice.updateHabit({ id: habit.id, name: '新习惯' }).name).toBe('新习惯')
    expect(practice.updateMetric({ id: metric.id, name: '新指标' }).name).toBe('新指标')
    expect(practice.updateCourse({ id: course.id, courseName: '新课程' }).courseName).toBe('新课程')
    expect(practice.updateKnowledge({ id: knowledge.id, title: '新知识点' }).title).toBe('新知识点')
    expect(practice.updateMistake({ id: mistake.id, question: '新错题' }).question).toBe('新错题')
    expect(practice.updateLearningTest({ id: learningTest.id, title: '新测试' }).title).toBe('新测试')

    practice.trashKnowledge(knowledge.id)
    const knowledgeTrash = data.listTrash().find((item) => item.entityId === knowledge.id)!
    expect(knowledgeTrash).toMatchObject({ entityType: 'knowledge', title: '新知识点' })
    data.restoreTrash(knowledgeTrash.id)
    expect(practice.listKnowledge(project.id)).toHaveLength(1)

    practice.trashHabit(habit.id)
    practice.trashMetric(metric.id)
    practice.trashCourse(course.id)
    practice.trashKnowledge(knowledge.id)
    practice.trashMistake(mistake.id)
    practice.trashLearningTest(learningTest.id)
    await data.createBackup('实践对象永久删除保护点')
    for (const item of data.listTrash()) await data.purgeTrash(item.id, '永久删除')

    const database = workspaceManager.getDatabase()
    for (const [table, id] of [
      ['habit_rules', habit.id], ['metrics', metric.id], ['course_profiles', course.id],
      ['knowledge_items', knowledge.id], ['mistakes', mistake.id], ['learning_tests', learningTest.id]
    ]) {
      expect(database.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE id = ?`).get(id)).toEqual({ count: 0 })
    }
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

  it('keeps the source active when extracted database record counts do not match the package', async () => {
    createProjectAndTask('迁移记录数量校验')
    const source = workspaceManager.getCurrentPath()
    class RecordTamperingPackageService extends PackageService {
      override async extractVerified(archivePath: string, targetRoot: string) {
        const manifest = await super.extractVerified(archivePath, targetRoot)
        const targetDatabase = new Database(join(targetRoot, 'database', 'youtrace.sqlite3'))
        targetDatabase.prepare("DELETE FROM tasks WHERE title = '迁移记录数量校验'").run()
        targetDatabase.close()
        return manifest
      }
    }
    const guardedData = new DataService(
      workspaceManager,
      new DataRepository(() => workspaceManager.getDatabase()),
      new RecordTamperingPackageService()
    )

    await expect(
      guardedData.migrateWorkspace(join(fixtureRoot, 'record-count-mismatch'))
    ).rejects.toMatchObject({
      code: 'RESTORE_RECORD_COUNT_MISMATCH'
    })
    expect(await guardedData.getPendingMigration()).toMatchObject({
      sourcePath: source,
      targetPath: join(fixtureRoot, 'record-count-mismatch'),
      stage: 'failed',
      failureCode: 'RESTORE_RECORD_COUNT_MISMATCH'
    })
    expect(workspaceManager.getCurrentPath()).toBe(source)
    expect(
      workspaceManager
        .getDatabase()
        .prepare("SELECT title FROM tasks WHERE title = '迁移记录数量校验'")
        .get()
    ).toEqual({ title: '迁移记录数量校验' })
  })

  it('rejects migration before extraction when the target volume lacks estimated free space', async () => {
    createProjectAndTask('迁移空间预检')
    const source = workspaceManager.getCurrentPath()
    class OversizedPackageService extends PackageService {
      override async verify(archivePath: string) {
        const verification = await super.verify(archivePath)
        return {
          ...verification,
          totalBytes: Number.MAX_SAFE_INTEGER
        }
      }
    }
    const guardedData = new DataService(
      workspaceManager,
      new DataRepository(() => workspaceManager.getDatabase()),
      new OversizedPackageService()
    )

    await expect(
      guardedData.migrateWorkspace(join(fixtureRoot, 'insufficient-space-target'))
    ).rejects.toMatchObject({
      code: 'TARGET_SPACE_INSUFFICIENT'
    })
    expect(workspaceManager.getCurrentPath()).toBe(source)
  })

  it('persists a failed migration and deletes only its recorded incomplete target', async () => {
    createProjectAndTask('失败迁移恢复')
    const source = workspaceManager.getCurrentPath()
    const target = join(fixtureRoot, 'pending-migration-target')
    const unrelated = join(fixtureRoot, 'unrelated-directory')
    await mkdir(unrelated, { recursive: true })
    await writeFile(join(unrelated, 'keep.txt'), 'keep', 'utf8')
    class PendingMigrationPackageService extends PackageService {
      override async extractVerified(archivePath: string, targetRoot: string) {
        const manifest = await super.extractVerified(archivePath, targetRoot)
        const targetDatabase = new Database(join(targetRoot, 'database', 'youtrace.sqlite3'))
        targetDatabase.prepare("DELETE FROM tasks WHERE title = '失败迁移恢复'").run()
        targetDatabase.close()
        return manifest
      }
    }
    const guardedData = new DataService(
      workspaceManager,
      new DataRepository(() => workspaceManager.getDatabase()),
      new PendingMigrationPackageService()
    )

    await expect(guardedData.migrateWorkspace(target)).rejects.toMatchObject({
      code: 'RESTORE_RECORD_COUNT_MISMATCH'
    })
    await workspaceManager.close()
    workspaceManager = new WorkspaceManager(join(fixtureRoot, 'app-data'))
    const bootstrap = await workspaceManager.bootstrap()
    expect(bootstrap).toMatchObject({
      status: 'ready',
      workspace: { path: source }
    })
    data = new DataService(
      workspaceManager,
      new DataRepository(() => workspaceManager.getDatabase())
    )
    expect(await data.getPendingMigration()).toMatchObject({
      sourcePath: source,
      targetPath: target,
      stage: 'failed'
    })

    await data.resolvePendingMigration('discard')
    expect(await data.getPendingMigration()).toBeNull()
    await expect(stat(target)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(join(unrelated, 'keep.txt'), 'utf8')).toBe('keep')
    expect(workspaceManager.getCurrentPath()).toBe(source)
  })

  it('retries a recorded failed migration from a clean target copy', async () => {
    createProjectAndTask('失败迁移重试')
    const target = join(fixtureRoot, 'retry-migration-target')
    vi.spyOn(PackageService.prototype, 'extractVerified').mockRejectedValueOnce(
      new Error('simulated copy interruption')
    )

    await expect(data.migrateWorkspace(target)).rejects.toThrow(/simulated copy interruption/)
    expect(await data.getPendingMigration()).toMatchObject({
      targetPath: target,
      stage: 'failed'
    })

    const retried = await data.resolvePendingMigration('retry')
    expect(retried?.workspace.path).toBe(target)
    expect(workspaceManager.getCurrentPath()).toBe(target)
    expect(await data.getPendingMigration()).toBeNull()
    expect(
      workspaceManager
        .getDatabase()
        .prepare("SELECT title FROM tasks WHERE title = '失败迁移重试'")
        .get()
    ).toEqual({ title: '失败迁移重试' })
  })

  it('persists an unsaved long-text draft inside the workspace recovery directory', async () => {
    const workspaceId = workspaceManager.getCurrent()!.id
    await data.saveRecoveryDraft({
      key: 'memo:quick-capture',
      label: '快速备忘',
      content: '程序异常退出后仍需恢复的长文本',
      context: {
        kind: 'idea',
        projectId: '',
        sourceLink: 'https://example.com/source',
        tagIds: ['tag-a', 'tag-b']
      }
    })
    await workspaceManager.close()
    workspaceManager = new WorkspaceManager(join(fixtureRoot, 'app-data'))
    await workspaceManager.bootstrap()
    data = new DataService(
      workspaceManager,
      new DataRepository(() => workspaceManager.getDatabase())
    )

    expect(await data.listRecoveryDrafts()).toEqual([
      expect.objectContaining({
        workspaceId,
        key: 'memo:quick-capture',
        label: '快速备忘',
        content: '程序异常退出后仍需恢复的长文本',
        context: {
          kind: 'idea',
          projectId: '',
          sourceLink: 'https://example.com/source',
          tagIds: ['tag-a', 'tag-b']
        }
      })
    ])
    await data.discardRecoveryDraft('memo:quick-capture')
    expect(await data.listRecoveryDrafts()).toEqual([])
  })
})

describe('automatic backup retention', () => {
  it('keeps daily, weekly and monthly recovery points as a union', () => {
    const dates = [
      '2026-07-30',
      '2026-07-29',
      '2026-07-28',
      '2026-07-27',
      '2026-07-26',
      '2026-07-25',
      '2026-07-24',
      '2026-07-23',
      '2026-07-15',
      '2026-07-08',
      '2026-07-01',
      '2026-06-24',
      '2026-06-17',
      '2026-05-31',
      '2026-04-30',
      '2026-03-31',
      '2026-02-28',
      '2026-01-31',
      '2025-12-31'
    ]
    const backups = dates.map((date) => ({
      id: date,
      relativePath: `backups/${date}.ytrace`,
      kind: 'automatic' as const,
      label: '自动备份',
      createdAt: `${date}T12:00:00.000Z`,
      verifiedAt: `${date}T12:01:00.000Z`,
      manifestHash: date,
      sizeBytes: 1,
      sourceSchemaVersion: 9
    }))

    const retained = selectAutomaticBackupsToRetain(
      backups,
      { daily: 7, weekly: 4, monthly: 6 },
      'Asia/Shanghai'
    )

    expect(retained).toEqual(
      expect.arrayContaining([
        '2026-07-30',
        '2026-07-24',
        '2026-07-15',
        '2026-07-08',
        '2026-06-24',
        '2026-05-31',
        '2026-04-30',
        '2026-03-31',
        '2026-02-28'
      ])
    )
    expect(retained).not.toContain('2026-07-23')
    expect(retained).not.toContain('2026-06-17')
    expect(retained).not.toContain('2026-01-31')
    expect(retained).not.toContain('2025-12-31')
  })
})

describe('database corruption recovery', () => {
  it('preserves the damaged database and switches only after confirming a verified backup copy', async () => {
    createProjectAndTask('损坏前已备份任务')
    await data.createBackup('损坏恢复点')
    const databasePath = join(sourceRoot, 'database', 'youtrace.sqlite3')
    await workspaceManager.close()
    await writeFile(databasePath, 'not a sqlite database', 'utf8')

    workspaceManager = new WorkspaceManager(join(fixtureRoot, 'app-data'))
    const bootstrap = await workspaceManager.bootstrap()
    expect(bootstrap).toMatchObject({
      status: 'workspace-unavailable',
      code: 'DATABASE_INTEGRITY_FAILED',
      lastPath: sourceRoot
    })
    const recoveryService = new DatabaseRecoveryService(workspaceManager)
    const recovery = await recoveryService.prepare(sourceRoot)

    expect(recovery.candidateWorkspacePath).not.toBeNull()
    expect(await readFile(recovery.preservedDatabasePath!, 'utf8')).toBe(
      'not a sqlite database'
    )
    expect(await readFile(databasePath, 'utf8')).toBe('not a sqlite database')
    expect(await stat(recovery.reportPath)).toMatchObject({ size: expect.any(Number) })

    const restored = await recoveryService.confirm(recovery.id)
    expect(restored.path).toBe(recovery.candidateWorkspacePath)
    expect(
      workspaceManager
        .getDatabase()
        .prepare("SELECT title FROM tasks WHERE title = '损坏前已备份任务'")
        .get()
    ).toEqual({ title: '损坏前已备份任务' })
    expect(await readFile(databasePath, 'utf8')).toBe('not a sqlite database')
    expect(await stat(join(sourceRoot, 'backups'))).toMatchObject({
      isDirectory: expect.any(Function)
    })
  })
})

describe('trash relationship and file safety', () => {
  it('permanently removes only a trashed review after a verified backup exists', async () => {
    const workflow = new WorkflowService(
      new WorkflowRepository(() => workspaceManager.getDatabase()),
      planning
    )
    const review = workflow.createReview({
      reviewType: 'weekly',
      startDate: '2026-07-27',
      endDate: '2026-08-02',
      title: '待清理复盘'
    })
    workflow.updateReview({
      id: review.id,
      importantOutcomes: '准备永久删除',
      status: 'completed'
    })
    workflow.trashReview(review.id)
    const trash = data.listTrash().find((item) => item.entityId === review.id)!

    await data.createBackup('复盘永久删除保护点')
    await data.purgeTrash(trash.id, '永久删除')

    expect(workflow.listReviews()).toHaveLength(0)
    expect(data.listTrash()).toHaveLength(0)
    expect(
      workspaceManager
        .getDatabase()
        .prepare('SELECT COUNT(*) AS count FROM reviews WHERE id = ?')
        .get(review.id)
    ).toEqual({ count: 0 })
    expect(
      workspaceManager
        .getDatabase()
        .prepare('SELECT COUNT(*) AS count FROM review_snapshots WHERE review_id = ?')
        .get(review.id)
    ).toEqual({ count: 0 })
  })

  it('keeps a shared attachment file when permanently deleting only one task reference', async () => {
    const first = createProjectAndTask('共享附件任务一')
    const second = planning.createTask({
      parentTaskId: null,
      projectId: first.projectId,
      goalId: null,
      milestoneId: null,
      title: '共享附件任务二',
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
    const attachmentId = randomUUID()
    const relativePath = 'attachments/shared-proof.bin'
    const attachmentPath = join(sourceRoot, relativePath)
    await writeFile(attachmentPath, 'shared attachment bytes', 'utf8')
    const now = new Date().toISOString()
    const database = workspaceManager.getDatabase()
    database
      .prepare(
        `INSERT INTO attachments(
           id, relative_path, original_name, content_hash, size_bytes, mime_type, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(attachmentId, relativePath, 'shared-proof.bin', 'shared-hash', 23, null, now)
    const link = database.prepare(
      `INSERT INTO entity_attachments(attachment_id, entity_type, entity_id, created_at)
       VALUES (?, 'task', ?, ?)`
    )
    link.run(attachmentId, first.taskId, now)
    link.run(attachmentId, second.id, now)

    planning.trashTask(first.taskId)
    const trash = data.listTrash().find((item) => item.entityId === first.taskId)!
    expect(trash).toMatchObject({ attachmentCount: 1, sharedAttachmentCount: 1 })
    await data.createBackup('共享附件永久删除保护点')
    await data.purgeTrash(trash.id, '永久删除')

    expect(await readFile(attachmentPath, 'utf8')).toBe('shared attachment bytes')
    expect(
      database
        .prepare(
          `SELECT COUNT(*) AS count FROM entity_attachments
            WHERE attachment_id = ? AND entity_type = 'task' AND entity_id = ?`
        )
        .get(attachmentId, second.id)
    ).toEqual({ count: 1 })
  })

  it('restores a trashed task into recovered content after its project is purged', async () => {
    const created = createProjectAndTask('父项目消失后恢复')
    planning.trashTask(created.taskId)
    planning.trashProject(created.projectId)
    await data.createBackup('父对象永久删除保护点')
    const projectTrash = data.listTrash().find((item) => item.entityId === created.projectId)!
    await data.purgeTrash(projectTrash.id, '永久删除')

    const taskTrash = data.listTrash().find((item) => item.entityId === created.taskId)!
    expect(taskTrash.parentAvailable).toBe(false)
    data.restoreTrash(taskTrash.id)
    expect(
      workspaceManager
        .getDatabase()
        .prepare('SELECT project_id, deleted_at FROM tasks WHERE id = ?')
        .get(created.taskId)
    ).toEqual({ project_id: null, deleted_at: null })
  })
})
