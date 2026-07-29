import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

test('records a habit, metric and course knowledge through the Electron UI', async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'youtrace-practice-e2e-'))
  const environment = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)
  )
  const electronApp = await electron.launch({
    args: ['.', `--user-data-dir=${join(fixtureRoot, 'app-data')}`],
    env: { ...environment, NODE_ENV: 'production' }
  })

  try {
    const page = await electronApp.firstWindow()
    const result = await page.evaluate(
      async ({ rootPath }) =>
        (
          globalThis as unknown as {
            youtrace: {
              workspace: {
                create(input: { rootPath: string; name: string }): Promise<{ ok: boolean }>
              }
            }
          }
        ).youtrace.workspace.create({ rootPath, name: '实践验收工作区' }),
      { rootPath: join(fixtureRoot, 'workspace') }
    )
    expect(result.ok).toBe(true)
    await page.reload()

    await page.getByRole('button', { name: '计划', exact: true }).click()
    await page.getByRole('button', { name: '新建项目' }).click()
    await page.getByLabel('项目名称').fill('计算机网络课程')
    await page.getByRole('button', { name: '创建项目' }).click()

    await page.getByRole('tab', { name: '实践与学习' }).click()
    await page.getByRole('button', { name: '新建习惯' }).click()
    await page.getByLabel('习惯名称').fill('每日复盘')
    await page.getByLabel('提醒时间').fill('21:00')
    await page.getByRole('button', { name: '创建习惯' }).click()
    await expect(page.getByText('每日复盘')).toBeVisible()
    await page.getByRole('button', { name: '完成 每日复盘' }).click()
    await expect(page.getByText('连续')).toBeVisible()

    await page.getByRole('tab', { name: '指标' }).click()
    await page.getByRole('button', { name: '新建指标' }).click()
    await page.getByLabel('指标名称').fill('累计跑量')
    await page.getByLabel('目标值').fill('100')
    await page.getByLabel('单位').fill('公里')
    await page.getByRole('button', { name: '创建指标' }).click()
    await expect(page.getByText('累计跑量')).toBeVisible()
    await page.getByRole('article').filter({ hasText: '累计跑量' }).getByRole('button', { name: '记录' }).click()
    await page.getByLabel('本次数值（公里）').fill('12')
    await page.getByRole('button', { name: '保存记录' }).click()
    await expect(page.getByRole('article').filter({ hasText: '累计跑量' })).toContainText('12公里')

    await page.getByRole('tab', { name: '课程学习' }).click()
    await page.getByRole('button', { name: '建立课程' }).click()
    await page.getByLabel('课程名称').fill('计算机网络')
    await page.getByLabel('教材名称').fill('计算机网络：自顶向下方法')
    await page.getByRole('button', { name: '建立课程' }).click()
    await expect(page.getByRole('heading', { name: '计算机网络', exact: true })).toBeVisible()

    await page.getByRole('button', { name: '知识点' }).click()
    await page.getByLabel('知识点标题').fill('分层体系结构')
    await page.getByLabel('内容').fill('应用层、运输层、网络层、链路层')
    await page.getByLabel('掌握度（0–100）').fill('60')
    await page.getByRole('button', { name: '添加知识点' }).click()
    await expect(page.getByText('分层体系结构')).toBeVisible()
    await page.screenshot({ path: 'test-results/practice.png' })
  } finally {
    await electronApp.evaluate(({ app }) => app.exit(0)).catch(() => undefined)
  }
})
