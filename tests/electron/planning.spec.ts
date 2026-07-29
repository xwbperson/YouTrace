import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

test('creates a project and completes a task through the real Electron UI', async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'youtrace-planning-e2e-'))
  const environment = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)
  )
  const electronApp = await electron.launch({
    args: ['.', `--user-data-dir=${join(fixtureRoot, 'app-data')}`],
    env: { ...environment, NODE_ENV: 'production' }
  })

  try {
    const page = await electronApp.firstWindow()
    const createWorkspace = await page.evaluate(
      async ({ rootPath }) =>
        (
          globalThis as unknown as {
            youtrace: {
              workspace: {
                create(input: { rootPath: string; name: string }): Promise<{ ok: boolean }>
              }
            }
          }
        ).youtrace.workspace.create({ rootPath, name: '计划验收工作区' }),
      { rootPath: join(fixtureRoot, 'workspace') }
    )
    expect(createWorkspace.ok).toBe(true)
    await page.reload()

    await page.getByRole('button', { name: '计划', exact: true }).click()
    await expect(page.getByRole('heading', { name: '计划', exact: true })).toBeVisible()

    await page.getByRole('button', { name: '新建项目' }).click()
    await page.getByLabel('项目名称').fill('完成计算机网络课程')
    await page.getByLabel('项目说明').fill('用章节、任务、投入和成果形成学习闭环')
    await page.getByLabel('目标日期').fill('2026-12-20')
    await page.getByLabel('主进度模式').selectOption('workload')
    await page.getByRole('button', { name: '创建项目' }).click()

    await expect(page.getByRole('heading', { name: '完成计算机网络课程' })).toBeVisible()
    await page.getByRole('button', { name: '新建任务' }).click()
    await page.getByLabel('下一步是什么？').fill('阅读第一章并整理分层模型')
    await page.getByLabel('难度').selectOption('3')
    await page.getByLabel('优先级').selectOption('high')
    await page.getByLabel('预计分钟').fill('90')
    await page.getByRole('button', { name: '创建任务' }).click()

    await expect(page.getByText('阅读第一章并整理分层模型')).toBeVisible()
    await page.getByRole('button', { name: '完成任务' }).click()
    await expect(page.getByText('已完成')).toBeVisible()
    await page.screenshot({ path: 'test-results/planning.png' })
  } finally {
    await electronApp.evaluate(({ app }) => app.exit(0)).catch(() => undefined)
  }
})
