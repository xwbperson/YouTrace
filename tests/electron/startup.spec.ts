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
      apiKeys: ['app', 'dialog', 'workspace', 'planning', 'window']
    })
    expect(rendererErrors).toEqual([])
    await page.screenshot({ path: 'test-results/onboarding.png' })
  } finally {
    await electronApp.evaluate(({ app }) => app.exit(0)).catch(() => undefined)
  }
})
