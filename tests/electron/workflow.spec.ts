import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

function localDate(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 10)
}

test('previews a template and keeps a review snapshot after rescheduling', async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'youtrace-workflow-e2e-'))
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
      async ({ rootPath }) =>
        (globalThis as unknown as {
          youtrace: { workspace: { create(input: { rootPath: string; name: string }): Promise<{ ok: boolean }> } }
        }).youtrace.workspace.create({ rootPath, name: '复盘模板验收' }),
      { rootPath: join(fixtureRoot, 'workspace') }
    )
    expect(created.ok).toBe(true)
    await page.reload()

    await page.getByRole('button', { name: '模板', exact: true }).click()
    await page.getByRole('button', { name: /课程学习/ }).click()
    await expect(page.getByText('第 1 章')).toBeVisible()
    await expect(page.getByText('25 个任务')).toBeVisible()
    await page.getByLabel('新项目名称').fill('计算机网络模板项目')
    await page.getByRole('button', { name: '应用模板' }).click()
    await expect(page.getByText('已创建项目“计算机网络模板项目”')).toBeVisible()

    await page.getByRole('button', { name: '从项目保存' }).click()
    await page.getByLabel('来源项目').selectOption({ label: '计算机网络模板项目' })
    await page.getByLabel('模板名称').fill('我的课程项目')
    await page.getByRole('button', { name: '保存模板' }).click()
    await expect(page.getByRole('button', { name: /我的课程项目/ })).toBeVisible()

    const now = new Date()
    const start = new Date(now)
    start.setDate(start.getDate() - (start.getDay() === 0 ? 6 : start.getDay() - 1))
    const end = new Date(start)
    end.setDate(end.getDate() + 6)
    const taskTitle = await page.evaluate(
      async ({ startDate, endDate }) => {
        const api = (globalThis as unknown as {
          youtrace: {
            planning: {
              listTasks(input: Record<string, unknown>): Promise<{ ok: true; data: Array<{ id: string; title: string }> }>
            }
            temporal: {
              createPlan(input: Record<string, unknown>): Promise<{ ok: boolean }>
            }
          }
        }).youtrace
        const tasks = await api.planning.listTasks({
          projectId: null,
          statuses: [],
          tagIds: [],
          includeDeleted: false,
          limit: 500,
          offset: 0
        })
        const task = tasks.data[0]!
        await api.temporal.createPlan({
          periodType: 'week',
          startDate,
          endDate,
          title: '验收周计划',
          focusResult: '验证复盘快照',
          capacityMinutes: 300,
          items: [{ entityType: 'task', entityId: task.id, titleSnapshot: task.title }]
        })
        return task.title
      },
      { startDate: localDate(start), endDate: localDate(end) }
    )

    await page.getByRole('button', { name: '复盘', exact: true }).click()
    await page.getByRole('button', { name: '生成复盘' }).click()
    await page.getByRole('button', { name: /生成快照/ }).click()
    await expect(page.locator('.snapshot-list strong').filter({ hasText: taskTitle })).toBeVisible()
    await page.getByLabel('重要成果').fill('模板结构已验证')
    await page.getByLabel('阻塞与延期原因').fill('本周容量不足')
    await page.getByLabel('下一周期第一步').fill('完成第一章阅读')
    await page.getByRole('button', { name: '完成复盘' }).click()
    await expect(page.locator('.review-status')).toHaveText('已完成')

    const nextWeek = new Date(end)
    nextWeek.setDate(nextWeek.getDate() + 7)
    await page.getByLabel('新日期').fill(localDate(nextWeek))
    await page.getByLabel('调整原因').fill('容量不足，顺延到下周')
    await page.getByRole('button', { name: '顺延' }).click()
    await expect(page.getByText('已执行 1 次调整')).toBeVisible()
    await expect(page.getByText(/原计划未完成 · 无截止日期/)).toBeVisible()
    await page.screenshot({ path: 'test-results/review-snapshot.png' })

    await page.getByRole('button', { name: '设置', exact: true }).click()
    await page.getByLabel('静默开始').fill('23:00')
    await page.getByLabel('静默结束').fill('06:30')
    await page.getByRole('checkbox', { name: /任务截止/ }).uncheck()
    await page.getByRole('button', { name: '保存通知设置' }).click()
    await expect(page.getByRole('button', { name: '已保存' })).toBeVisible()
    const reminderSettings = await page.evaluate(
      async () =>
        (globalThis as unknown as {
          youtrace: {
            reminders: {
              getSettings(): Promise<{ ok: true; data: { quietStart: string; quietEnd: string; taskDue: boolean } }>
            }
          }
        }).youtrace.reminders.getSettings()
    )
    expect(reminderSettings.data).toMatchObject({
      quietStart: '23:00',
      quietEnd: '06:30',
      taskDue: false
    })
  } finally {
    await electronApp.evaluate(({ app }) => app.exit(0)).catch(() => undefined)
  }
})
