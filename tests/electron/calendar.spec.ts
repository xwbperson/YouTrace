import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

function localInput(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

function localDate(date: Date): string {
  return localInput(date).slice(0, 10)
}

test('plans capacity, moves calendar blocks and explains countdown speed', async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'youtrace-calendar-e2e-'))
  const environment = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)
  )
  const electronApp = await electron.launch({
    args: ['.', `--user-data-dir=${join(fixtureRoot, 'app-data')}`],
    env: { ...environment, NODE_ENV: 'production' }
  })

  try {
    const page = await electronApp.firstWindow()
    const ids = await page.evaluate(
      async ({ rootPath }) => {
        const api = (globalThis as unknown as {
          youtrace: {
            workspace: { create(input: { rootPath: string; name: string }): Promise<{ ok: boolean }> }
            planning: {
              createProject(input: Record<string, unknown>): Promise<{ ok: boolean; data?: { id: string } }>
              createTask(input: Record<string, unknown>): Promise<{ ok: boolean; data?: { id: string } }>
            }
          }
        }).youtrace
        await api.workspace.create({ rootPath, name: '时间验收工作区' })
        const project = await api.planning.createProject({
          areaId: null,
          name: '期限项目',
          description: '',
          status: 'active',
          startDate: null,
          targetDate: null,
          successCriteria: '',
          progressMode: 'equal'
        })
        const task = await api.planning.createTask({
          parentTaskId: null,
          projectId: project.data!.id,
          goalId: null,
          milestoneId: null,
          title: '完成阶段报告',
          description: '',
          status: 'ready',
          difficulty: 4,
          priority: 'high',
          estimatedMinutes: 120,
          progressWeight: null,
          startDate: null,
          dueAt: '2026-12-20T12:00:00.000Z',
          verificationCriteria: '',
          includeInProgress: true,
          tagIds: []
        })
        return { projectId: project.data!.id, taskId: task.data!.id }
      },
      { rootPath: join(fixtureRoot, 'workspace') }
    )
    await page.reload()
    await page.getByRole('button', { name: '日历', exact: true }).click()

    const start = new Date()
    start.setHours(9, 0, 0, 0)
    const end = new Date(start.getTime() + 60 * 60_000)
    await page.getByRole('button', { name: '时间块' }).click()
    await page.getByLabel('时间块标题').fill('阶段报告专注')
    await page.getByLabel('关联任务').selectOption({ label: '完成阶段报告' })
    await page.getByLabel('开始时间').fill(localInput(start))
    await page.getByLabel('结束时间').fill(localInput(end))
    await page.getByRole('button', { name: '创建时间块' }).click()
    await expect(page.getByText('阶段报告专注')).toBeVisible()

    await page.getByRole('button', { name: '时间块' }).click()
    await page.getByLabel('时间块标题').fill('资料补充')
    await page.getByLabel('开始时间').fill(localInput(new Date(start.getTime() + 30 * 60_000)))
    await page.getByLabel('结束时间').fill(localInput(new Date(end.getTime() + 30 * 60_000)))
    await page.getByRole('button', { name: '创建时间块' }).click()
    await expect(page.getByText(/时间块发生冲突/)).toBeVisible()

    const tomorrow = new Date(start)
    tomorrow.setDate(tomorrow.getDate() + 1)
    await page.getByText('阶段报告专注').dragTo(page.getByLabel(`${localDate(tomorrow)} 安排`))
    const dueAt = await page.evaluate(
      async ({ taskId }) => {
        const result = await (globalThis as unknown as {
          youtrace: {
            planning: {
              listTasks(input: Record<string, unknown>): Promise<{ ok: true; data: Array<{ id: string; dueAt: string | null }> }>
            }
          }
        }).youtrace.planning.listTasks({
          projectId: null,
          statuses: [],
          tagIds: [],
          includeDeleted: false,
          limit: 500,
          offset: 0
        })
        return result.data.find((task) => task.id === taskId)?.dueAt
      },
      { taskId: ids.taskId }
    )
    expect(dueAt).toBe('2026-12-20T12:00:00.000Z')

    await page.getByRole('tab', { name: '周期计划' }).click()
    await page.getByRole('button', { name: '新建计划' }).first().click()
    await page.getByLabel('可用分钟').fill('60')
    await page.getByRole('button', { name: /完成阶段报告/ }).click()
    await page.getByRole('button', { name: '创建计划' }).click()
    await expect(page.getByText('计划超载')).toBeVisible()

    await page.getByRole('tab', { name: '倒计时' }).click()
    await page.getByRole('button', { name: '新建倒计时' }).first().click()
    const target = new Date()
    target.setDate(target.getDate() + 10)
    await page.getByLabel('倒计时标题').fill('阶段验收')
    await page.getByLabel('目标时间').fill(localInput(target))
    await page.getByLabel('关联任务').selectOption({ label: '完成阶段报告' })
    await page.getByLabel('剩余分钟').fill('240')
    await page.getByRole('button', { name: '创建倒计时' }).click()
    await expect(page.getByText('阶段验收')).toBeVisible()
    await expect(page.getByText(/建议 \d+ 分钟\/日/)).toBeVisible()
    await page.screenshot({ path: 'test-results/calendar-countdown.png' })
  } finally {
    await electronApp.evaluate(({ app }) => app.exit(0)).catch(() => undefined)
  }
})
