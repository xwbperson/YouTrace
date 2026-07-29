import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

test('starts the production Electron shell with the isolated preload API', async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), 'youtrace-electron-test-'))
  const environment = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)
  )
  const electronApp = await electron.launch({
    args: ['.', `--user-data-dir=${userDataPath}`],
    env: {
      ...environment,
      NODE_ENV: 'production'
    }
  })

  try {
    const page = await electronApp.firstWindow()
    const rendererErrors: string[] = []
    page.on('pageerror', (error) => rendererErrors.push(error.stack ?? error.message))
    await expect(page).toHaveTitle('有迹')
    await expect(page.getByRole('heading', { name: '选择工作区' })).toBeVisible()
    await expect(page.getByRole('button', { name: '创建新工作区' })).toBeVisible()

    const securityBoundary = await page.evaluate(() => ({
      processType: typeof (globalThis as typeof globalThis & { process?: unknown }).process,
      requireType: typeof (globalThis as typeof globalThis & { require?: unknown }).require,
      apiKeys: Object.keys(
        (globalThis as unknown as { youtrace: Record<string, unknown> }).youtrace
      )
    }))

    expect(securityBoundary).toEqual({
      processType: 'undefined',
      requireType: 'undefined',
      apiKeys: ['app', 'dialog', 'workspace', 'planning', 'execution', 'practice', 'temporal', 'workflow', 'reminders', 'data', 'settings', 'window']
    })
    const beforeResize = await electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.getBounds()
    )
    await page.evaluate(() => {
      const api = (globalThis as unknown as {
        youtrace: {
          window: {
            startResize(edge: string, x: number, y: number): void
            moveResize(x: number, y: number): void
            endResize(): void
          }
        }
      }).youtrace
      api.window.startResize('south-east', 100, 100)
      api.window.moveResize(180, 140)
      api.window.endResize()
    })
    await expect.poll(async () =>
      electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getBounds())
    ).toMatchObject({
      width: beforeResize.width + 80,
      height: beforeResize.height + 40
    })
    expect(rendererErrors).toEqual([])
    await page.screenshot({ path: 'test-results/onboarding.png' })
  } finally {
    await electronApp.evaluate(({ app }) => app.exit(0)).catch(() => undefined)
  }
})
