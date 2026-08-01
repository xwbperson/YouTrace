import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

test('keeps an active effort alive through custom window controls and tray-style hiding', async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'youtrace-window-lifecycle-e2e-'))
  const environment = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)
  )
  const electronApp = await electron.launch({
    args: ['.', `--user-data-dir=${join(fixtureRoot, 'app-data')}`],
    env: { ...environment, NODE_ENV: 'production' }
  })

  try {
    const page = await electronApp.firstWindow()
    const setup = await page.evaluate(
      async ({ rootPath }) => {
        const api = (globalThis as unknown as { youtrace: any }).youtrace
        const workspace = await api.workspace.create({ rootPath, name: '窗口生命周期验收' })
        const project = await api.planning.createProject({
          areaId: null,
          name: '后台计时项目',
          description: '',
          status: 'active',
          startDate: null,
          targetDate: null,
          successCriteria: '',
          progressMode: 'equal'
        })
        const task = project.data
          ? await api.planning.createTask({
              parentTaskId: null,
              projectId: project.data.id,
              goalId: null,
              milestoneId: null,
              title: '验证后台计时',
              description: '',
              status: 'ready',
              difficulty: 2,
              priority: 'high',
              estimatedMinutes: 30,
              progressWeight: null,
              startDate: new Date().toLocaleDateString('sv-SE'),
              dueAt: null,
              verificationCriteria: '',
              includeInProgress: true,
              tagIds: []
            })
          : { ok: false }
        return { workspace: workspace.ok, project: project.ok, task: task.ok }
      },
      { rootPath: join(fixtureRoot, 'workspace') }
    )
    expect(setup).toEqual({ workspace: true, project: true, task: true })
    await page.reload()

    const initialWindow = await electronApp.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]!
      return {
        bounds: window.getBounds(),
        minimumSize: window.getMinimumSize(),
        resizable: window.isResizable(),
        menuVisible: window.isMenuBarVisible()
      }
    })
    expect(initialWindow).toMatchObject({
      minimumSize: [1080, 720],
      resizable: true,
      menuVisible: false
    })
    const developmentTrayIconLoaded = await electronApp.evaluate(({ app, nativeImage }) =>
      !nativeImage
        .createFromPath(`${app.getAppPath()}/resources/icon.png`)
        .isEmpty()
    )
    expect(developmentTrayIconLoaded).toBe(true)

    await page.getByRole('button', { name: '最小化窗口' }).click()
    await expect
      .poll(() =>
        electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isMinimized())
      )
      .toBe(true)
    await electronApp.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]!
      window.restore()
      window.show()
    })
    await expect(page.getByRole('button', { name: '最大化窗口' })).toBeVisible()

    await page.getByRole('button', { name: '最大化窗口' }).click()
    await expect
      .poll(() =>
        electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isMaximized())
      )
      .toBe(true)
    await expect(page.getByRole('button', { name: '还原窗口' })).toBeVisible()
    await page.getByRole('button', { name: '还原窗口' }).click()
    await expect
      .poll(() =>
        electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isMaximized())
      )
      .toBe(false)

    await page.getByRole('button', { name: '设置', exact: true }).click()
    await expect(page.getByRole('radio', { name: /最小化到托盘/ })).toBeChecked()
    await expect(page.getByRole('radio', { name: /直接退出程序/ })).toBeVisible()

    await page.getByRole('button', { name: '今日', exact: true }).click()
    const task = page.getByRole('article').filter({ hasText: '验证后台计时' })
    await task.getByRole('button', { name: '开始', exact: true }).click()
    await expect(page.getByText('正在投入')).toBeVisible()

    await page.getByRole('button', { name: '关闭窗口并保留后台运行' }).click()
    await expect
      .poll(() =>
        electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isVisible())
      )
      .toBe(false)
    const hiddenState = await electronApp.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]!
      return {
        destroyed: window.isDestroyed(),
        webContentsDestroyed: window.webContents.isDestroyed()
      }
    })
    expect(hiddenState).toEqual({ destroyed: false, webContentsDestroyed: false })

    await electronApp.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]!
      window.show()
      window.focus()
    })
    await expect(page.getByText('正在投入')).toBeVisible()
    const active = await page.evaluate(async () => {
      const api = (globalThis as unknown as { youtrace: any }).youtrace
      return api.execution.getActiveEffort()
    })
    expect(active).toMatchObject({
      ok: true,
      data: {
        entityTitle: '验证后台计时',
        endedAt: null
      }
    })

    await page.getByRole('button', { name: '停止并记录' }).click()
    await page.getByLabel('实际结果').fill('窗口隐藏期间计时事实保持')
    await page.getByRole('button', { name: '保存并停止' }).click()
    await expect(page.getByText('当前没有计时')).toBeVisible()

    await page.getByRole('button', { name: '设置', exact: true }).click()
    await page.getByRole('radio', { name: /直接退出程序/ }).check()
    await page.getByRole('button', { name: '保存全部设置' }).click()
    await expect(page.getByRole('button', { name: '关闭窗口并退出程序' })).toBeVisible()
    await page.getByRole('button', { name: '关闭窗口并退出程序' }).click()
    const quitDialog = page.getByRole('dialog', { name: '退出有迹？' })
    await expect(quitDialog).toBeVisible()
    await Promise.all([
      electronApp.waitForEvent('close'),
      quitDialog.getByRole('button', { name: '退出程序' }).click()
    ])
  } finally {
    await electronApp.evaluate(({ app }) => app.exit(0)).catch(() => undefined)
  }
})
