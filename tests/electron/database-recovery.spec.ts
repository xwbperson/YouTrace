import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

test('preserves a corrupt database and switches only after confirming a verified backup', async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'youtrace-database-recovery-e2e-'))
  const userDataPath = join(fixtureRoot, 'app-data')
  const workspacePath = join(fixtureRoot, 'workspace')
  const databasePath = join(workspacePath, 'database', 'youtrace.sqlite3')
  const environment = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)
  )
  const launchOptions = {
    args: ['.', `--user-data-dir=${userDataPath}`],
    env: { ...environment, NODE_ENV: 'production', YOUTRACE_E2E: '1' }
  }
  let electronApp = await electron.launch(launchOptions)

  try {
    let page = await electronApp.firstWindow()
    const setup = await page.evaluate(
      async ({ rootPath }) => {
        const api = (globalThis as unknown as { youtrace: any }).youtrace
        await api.workspace.create({ rootPath, name: '数据库恢复验收' })
        const project = await api.planning.createProject({
          areaId: null,
          name: '损坏前项目',
          description: '',
          status: 'active',
          startDate: null,
          targetDate: null,
          successCriteria: '',
          progressMode: 'equal'
        })
        const task = await api.planning.createTask({
          parentTaskId: null,
          projectId: project.data.id,
          goalId: null,
          milestoneId: null,
          title: '从已验证备份恢复的任务',
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
        const backup = await api.data.createBackup('数据库损坏恢复点')
        return { taskId: task.data.id, backupOk: backup.ok }
      },
      { rootPath: workspacePath }
    )
    expect(setup.backupOk).toBe(true)

    const closePromise = electronApp.waitForEvent('close')
    await electronApp.evaluate(({ app }) => app.exit(0)).catch(() => undefined)
    await closePromise
    await writeFile(databasePath, 'not a sqlite database', 'utf8')

    electronApp = await electron.launch(launchOptions)
    page = await electronApp.firstWindow()
    await expect(
      page.getByRole('heading', { name: '工作区数据库未通过完整性检查' })
    ).toBeVisible()
    await expect(page.getByText('原数据库和最近备份都没有被删除')).toBeVisible()
    await expect(page.getByText(workspacePath, { exact: true })).toBeVisible()
    await expect(
      page.getByRole('button', { name: '确认切换到恢复副本' })
    ).toBeEnabled()
    expect(await readFile(databasePath, 'utf8')).toBe('not a sqlite database')

    await page.getByRole('button', { name: '确认切换到恢复副本' }).click()
    await expect(page.getByRole('button', { name: '今日', exact: true })).toBeVisible()
    const tasks = await page.evaluate(async () =>
      (globalThis as unknown as { youtrace: any }).youtrace.planning.listTasks({
        projectId: null,
        status: null,
        includeTrashed: false,
        limit: 100,
        offset: 0
      })
    )
    expect(tasks.ok).toBe(true)
    expect(tasks.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: setup.taskId,
          title: '从已验证备份恢复的任务'
        })
      ])
    )
    expect(await readFile(databasePath, 'utf8')).toBe('not a sqlite database')
  } finally {
    await electronApp.evaluate(({ app }) => app.exit(0)).catch(() => undefined)
  }
})
