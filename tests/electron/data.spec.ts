import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

test('creates a verified backup and restores a trashed task from the data center', async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'youtrace-data-e2e-'))
  const environment = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)
  )
  const electronApp = await electron.launch({
    args: ['.', `--user-data-dir=${join(fixtureRoot, 'app-data')}`],
    env: { ...environment, NODE_ENV: 'production' }
  })

  try {
    const page = await electronApp.firstWindow()
    const created = await page.evaluate(
      async ({ rootPath }) => {
        const api = (
          globalThis as unknown as {
            youtrace: {
              workspace: {
                create(input: { rootPath: string; name: string }): Promise<{
                  ok: boolean
                }>
              }
            }
          }
        ).youtrace
        return api.workspace.create({ rootPath, name: '数据安全验收工作区' })
      },
      { rootPath: join(fixtureRoot, 'workspace') }
    )
    expect(created.ok).toBe(true)
    await page.reload()

    const seeded = await page.evaluate(async () => {
      const api = (
        globalThis as unknown as {
          youtrace: {
            planning: {
              createProject(input: Record<string, unknown>): Promise<{
                ok: boolean
                data?: { id: string }
              }>
              createTask(input: Record<string, unknown>): Promise<{
                ok: boolean
                data?: { id: string }
              }>
              trashTask(id: string): Promise<{ ok: boolean }>
            }
          }
        }
      ).youtrace
      const project = await api.planning.createProject({
        areaId: null,
        name: '数据保护项目',
        description: '',
        status: 'active',
        startDate: null,
        targetDate: null,
        successCriteria: '',
        progressMode: 'equal'
      })
      if (!project.ok || !project.data) return { ok: false }
      const task = await api.planning.createTask({
        parentTaskId: null,
        projectId: project.data.id,
        goalId: null,
        milestoneId: null,
        title: '待恢复任务',
        description: '',
        status: 'ready',
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
      if (!task.ok || !task.data) return { ok: false }
      const trashed = await api.planning.trashTask(task.data.id)
      return { ok: trashed.ok, taskId: task.data.id }
    })
    expect(seeded.ok).toBe(true)

    await page.getByRole('button', { name: '更多' }).click()
    await expect(page.getByRole('heading', { name: '数据中心' })).toBeVisible()

    await page.getByText('运行完整性检查').click()
    await expect(page.getByText(/数据库 ok · schema v7/)).toBeVisible()

    await page.getByText('创建已验证备份').click()
    await expect(page.getByText('手动备份', { exact: true })).toBeVisible()
    await page.getByText('手动备份', { exact: true }).click()
    await page.getByRole('button', { name: '重新校验' }).click()
    await expect(page.getByText('校验已完成。')).toBeVisible()

    await page.getByRole('tab', { name: /回收站/ }).click()
    const trashItem = page.getByRole('article').filter({ hasText: '待恢复任务' })
    await expect(trashItem).toBeVisible()
    await trashItem.getByRole('button', { name: '恢复' }).click()
    await expect(trashItem).toHaveCount(0)

    const restored = await page.evaluate(async () => {
      const api = (
        globalThis as unknown as {
          youtrace: {
            planning: {
              listTasks(input: Record<string, unknown>): Promise<{
                ok: boolean
                data?: Array<{ id: string; title: string }>
              }>
            }
          }
        }
      ).youtrace
      return api.planning.listTasks({
        projectId: null,
        statuses: [],
        tagIds: [],
        includeDeleted: false,
        limit: 100,
        offset: 0
      })
    })
    expect(restored.ok).toBe(true)
    expect(restored.data).toContainEqual(expect.objectContaining({ title: '待恢复任务' }))
    await page.screenshot({ path: 'test-results/data-center.png' })
  } finally {
    await electronApp.evaluate(({ app }) => app.exit(0)).catch(() => undefined)
  }
})
