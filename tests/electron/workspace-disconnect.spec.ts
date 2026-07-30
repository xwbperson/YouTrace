import { mkdtemp, rename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

test('blocks writes, preserves a draft and reconnects the same workspace after identity loss', async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'youtrace-workspace-disconnect-e2e-'))
  const workspacePath = join(fixtureRoot, 'workspace')
  const markerPath = join(workspacePath, '.youtrace-workspace.json')
  const unavailableMarkerPath = join(workspacePath, '.youtrace-workspace.offline.json')
  const environment = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)
  )
  const electronApp = await electron.launch({
    args: ['.', `--user-data-dir=${join(fixtureRoot, 'app-data')}`],
    env: { ...environment, NODE_ENV: 'production', YOUTRACE_E2E: '1' }
  })

  try {
    const page = await electronApp.firstWindow()
    const created = await page.evaluate(
      async ({ rootPath }) =>
        (
          globalThis as unknown as {
            youtrace: {
              workspace: {
                create(input: { rootPath: string; name: string }): Promise<{ ok: boolean }>
              }
            }
          }
        ).youtrace.workspace.create({ rootPath, name: '运行中失联工作区' }),
      { rootPath: workspacePath }
    )
    expect(created.ok).toBe(true)
    await page.reload()

    await page.getByRole('button', { name: /备忘/ }).click()
    await page.getByLabel('快速记录').fill('移动盘断开前尚未保存的草稿')
    await rename(markerPath, unavailableMarkerPath)

    await expect(page.getByRole('alertdialog')).toContainText('工作区连接已中断')
    const blockedWrite = await page.evaluate(async () =>
      (
        globalThis as unknown as {
          youtrace: {
            execution: {
              createMemo(input: Record<string, unknown>): Promise<{
                ok: boolean
                error?: { code: string }
              }>
            }
          }
        }
      ).youtrace.execution.createMemo({
        title: '',
        body: '失联期间不应写入',
        kind: 'memo',
        sourceLink: null,
        projectId: null,
        tagIds: []
      })
    )
    expect(blockedWrite).toMatchObject({
      ok: false,
      error: { code: 'WORKSPACE_UNAVAILABLE' }
    })

    await page.getByRole('button', { name: '返回页面复制草稿' }).click()
    await expect(page.getByLabel('快速记录')).toHaveValue('移动盘断开前尚未保存的草稿')
    await expect(page.getByText('当前页面草稿仍保留')).toBeVisible()

    await rename(unavailableMarkerPath, markerPath)
    await page.getByRole('button', { name: '重新定位' }).click()
    await page.getByRole('button', { name: '验证并重新连接' }).click()
    await expect(page.getByRole('alertdialog')).toHaveCount(0)
    await expect(page.getByText('当前页面草稿仍保留')).toHaveCount(0)
    await expect(page.getByLabel('快速记录')).toHaveValue('移动盘断开前尚未保存的草稿')

    await page.getByRole('button', { name: '保存到收件箱' }).click()
    await expect(page.getByText('移动盘断开前尚未保存的草稿')).toBeVisible()
  } finally {
    await electronApp.evaluate(({ app }) => app.exit(0)).catch(() => undefined)
  }
})
