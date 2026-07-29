import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
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

    expect(migration.version).toBe(9)
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
})
