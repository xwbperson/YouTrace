import { access, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

test('packaged Windows app creates a SQLite workspace and opens the dashboard', async () => {
  const executablePath = resolve('release/win-unpacked/有迹.exe')
  await access(executablePath).catch(() => test.skip(true, '先运行 npm run dist:win 生成打包应用'))

  const fixtureRoot = await mkdtemp(join(tmpdir(), 'youtrace-packaged-test-'))
  const userDataPath = join(fixtureRoot, 'app-data')
  const workspacePath = join(fixtureRoot, 'workspace')
  const electronApp = await electron.launch({
    executablePath,
    args: [`--user-data-dir=${userDataPath}`]
  })

  try {
    const page = await electronApp.firstWindow()
    await expect(page.getByRole('heading', { name: '选择工作区' })).toBeVisible()

    const createResult = await page.evaluate(
      async ({ path }) =>
        (
          globalThis as unknown as {
            youtrace: {
              workspace: {
                create(input: { rootPath: string; name: string }): Promise<{
                  ok: boolean
                  error?: { message: string }
                }>
              }
            }
          }
        ).youtrace.workspace.create({
          rootPath: path,
          name: '打包验收工作区'
        }),
      { path: workspacePath }
    )
    expect(createResult).toMatchObject({ ok: true })

    await page.reload()
    await expect(page.getByRole('heading', { name: '今天，从一件真正重要的事开始。' })).toBeVisible()
    await expect(page.getByText('工作区已连接')).toBeVisible()
    await page.screenshot({ path: 'test-results/dashboard-packaged.png' })
  } finally {
    await electronApp.evaluate(({ app }) => app.exit(0)).catch(() => undefined)
  }
})
