import { mkdir, mkdtemp, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { PlanningRepository } from '../../src/main/modules/planning/planning-repository'
import { PlanningService } from '../../src/main/modules/planning/planning-service'
import { DatabaseManager } from '../../src/main/database/database-manager'
import { WorkspaceManager } from '../../src/main/workspace/workspace-manager'

const managers: WorkspaceManager[] = []

afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.close()))
})

describe('workspace lifecycle', () => {
  it('creates a complete portable workspace and reopens it from the bootstrap pointer', async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), 'youtrace-workspace-test-'))
    const workspaceRoot = join(fixtureRoot, 'workspace')
    const userDataRoot = join(fixtureRoot, 'app-data')

    const manager = new WorkspaceManager(userDataRoot)
    managers.push(manager)
    const created = await manager.create(workspaceRoot, '测试工作区')

    expect(created).toMatchObject({
      name: '测试工作区',
      path: workspaceRoot,
      formatVersion: 1,
      readOnly: false
    })

    const marker = JSON.parse(
      await readFile(join(workspaceRoot, '.youtrace-workspace.json'), 'utf8')
    ) as Record<string, unknown>
    expect(marker).toMatchObject({
      product: 'YouTrace',
      workspaceId: created.id,
      name: '测试工作区',
      formatVersion: 1
    })

    for (const directory of ['database', 'attachments', 'evidence', 'backups', 'recovery', 'trash']) {
      expect((await stat(join(workspaceRoot, directory))).isDirectory()).toBe(true)
    }

    const database = new Database(join(workspaceRoot, 'database', 'youtrace.sqlite3'), {
      readonly: true
    })
    const migration = database
      .prepare('SELECT MAX(version) AS version FROM schema_migrations')
      .get() as { version: number }
    const searchTable = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'searchable_content'")
      .get() as { name: string } | undefined
    database.close()

    expect(migration.version).toBe(11)
    expect(searchTable?.name).toBe('searchable_content')

    const bootstrapContents = await readFile(join(userDataRoot, 'bootstrap.json'), 'utf8')
    const bootstrap = JSON.parse(bootstrapContents) as Record<string, unknown>
    expect(bootstrap).toMatchObject({
      workspacePath: workspaceRoot,
      workspaceId: created.id
    })
    expect(bootstrapContents).not.toContain('任务')
    expect(bootstrapContents).not.toContain('备忘')

    await manager.close()

    const reopeningManager = new WorkspaceManager(userDataRoot)
    managers.push(reopeningManager)
    const reopened = await reopeningManager.bootstrap()
    expect(reopened).toEqual({
      status: 'ready',
      workspace: created
    })
  })

  it('upgrades a schema v9 workspace for recoverable review and course deletion', async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), 'youtrace-schema-v11-test-'))
    const databasePath = join(fixtureRoot, 'youtrace.sqlite3')
    const legacy = new Database(databasePath)
    legacy.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
      INSERT INTO schema_migrations(version, applied_at)
      VALUES (9, '2026-07-30T00:00:00.000Z');
      CREATE TABLE reviews (
        id TEXT PRIMARY KEY,
        review_type TEXT NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        title TEXT NOT NULL,
        important_outcomes TEXT NOT NULL DEFAULT '',
        incomplete_items TEXT NOT NULL DEFAULT '',
        blockers TEXT NOT NULL DEFAULT '',
        next_first_step TEXT NOT NULL DEFAULT '',
        next_commitments TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'draft',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      );
    `)
    legacy.close()

    const manager = new DatabaseManager()
    const migrated = manager.open(databasePath)
    try {
      const columns = migrated.pragma('table_info(reviews)') as Array<{ name: string }>
      const courseColumns = migrated.pragma('table_info(course_profiles)') as Array<{ name: string }>
      const version = migrated
        .prepare('SELECT MAX(version) AS version FROM schema_migrations')
        .get() as { version: number }
      expect(columns.map((column) => column.name)).toContain('deleted_at')
      expect(courseColumns.map((column) => column.name)).toEqual(expect.arrayContaining(['archived_at', 'deleted_at']))
      expect(version.version).toBe(11)
    } finally {
      manager.close()
    }
  })

  it('rejects a second writer while allowing an explicit read-only connection', async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), 'youtrace-lock-test-'))
    const workspaceRoot = join(fixtureRoot, 'workspace')
    const first = new WorkspaceManager(join(fixtureRoot, 'first-app-data'))
    managers.push(first)
    await first.create(workspaceRoot, '锁测试工作区')

    const second = new WorkspaceManager(join(fixtureRoot, 'second-app-data'))
    managers.push(second)
    await expect(second.open(workspaceRoot, false)).rejects.toMatchObject({
      code: 'WORKSPACE_LOCKED'
    })
    const readOnly = await second.open(workspaceRoot, true)
    expect(readOnly).toMatchObject({
      path: workspaceRoot,
      readOnly: true
    })
  })

  it('blocks writes after identity loss and reconnects only the original complete workspace', async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), 'youtrace-disconnect-test-'))
    const workspaceRoot = join(fixtureRoot, 'workspace')
    const relocatedRoot = join(fixtureRoot, 'workspace-relocated')
    const manager = new WorkspaceManager(join(fixtureRoot, 'app-data'))
    managers.push(manager)
    const workspace = await manager.create(workspaceRoot, '失联保护工作区')
    const planning = new PlanningService(
      new PlanningRepository(() => manager.getDatabase())
    )
    planning.createProject({
      areaId: null,
      name: '失联前项目',
      description: '',
      status: 'active',
      startDate: null,
      targetDate: null,
      successCriteria: '',
      progressMode: 'equal'
    })

    const markerPath = join(workspaceRoot, '.youtrace-workspace.json')
    const markerContents = await readFile(markerPath, 'utf8')
    await unlink(markerPath)

    const availability = await manager.checkAvailability()
    expect(availability).toMatchObject({
      available: false,
      workspaceId: workspace.id,
      path: workspaceRoot
    })
    expect(() => manager.getDatabase()).toThrow('工作区连接已中断')
    expect(() =>
      planning.createProject({
        areaId: null,
        name: '不应写入',
        description: '',
        status: 'active',
        startDate: null,
        targetDate: null,
        successCriteria: '',
        progressMode: 'equal'
      })
    ).toThrow('工作区连接已中断')

    await rename(workspaceRoot, relocatedRoot)
    await writeFile(join(relocatedRoot, '.youtrace-workspace.json'), markerContents, 'utf8')
    await mkdir(workspaceRoot)

    await expect(manager.reconnect(workspaceRoot)).rejects.toMatchObject({
      code: 'WORKSPACE_MARKER_MISSING'
    })
    const reconnected = await manager.reconnect(relocatedRoot)
    expect(reconnected).toMatchObject({
      id: workspace.id,
      path: relocatedRoot,
      readOnly: false
    })
    expect(planning.listProjects(false).map((project) => project.name)).toContain('失联前项目')
    planning.createProject({
      areaId: null,
      name: '重新连接后项目',
      description: '',
      status: 'active',
      startDate: null,
      targetDate: null,
      successCriteria: '',
      progressMode: 'equal'
    })
    expect((await manager.checkAvailability()).available).toBe(true)
  })
})
