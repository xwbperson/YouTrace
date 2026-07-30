import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

test('keeps core navigation reachable at 100, 125, 150 and 200 percent display scale', async () => {
  test.setTimeout(60_000)
  const environment = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)
  )

  for (const factor of [1, 1.25, 1.5, 2]) {
    const fixtureRoot = await mkdtemp(join(tmpdir(), `youtrace-display-${factor}-`))
    const electronApp = await electron.launch({
      args: [
        '.',
        `--user-data-dir=${join(fixtureRoot, 'app-data')}`,
        `--force-device-scale-factor=${factor}`
      ],
      env: { ...environment, NODE_ENV: 'production' }
    })
    try {
      const page = await electronApp.firstWindow()
      await electronApp.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]!.setSize(1080, 720)
      )
      const created = await page.evaluate(
        async ({ rootPath, name }) =>
          (
            globalThis as unknown as {
              youtrace: {
                workspace: {
                  create(input: { rootPath: string; name: string }): Promise<{ ok: boolean }>
                }
              }
            }
          ).youtrace.workspace.create({ rootPath, name }),
        {
          rootPath: join(fixtureRoot, 'workspace'),
          name: `显示缩放 ${factor}`
        }
      )
      expect(created.ok).toBe(true)
      await page.reload()

      for (const name of ['首页', '今日', '计划', '日历', '记录', '复盘']) {
        await expect(page.getByRole('button', { name, exact: true })).toBeVisible()
      }
      await expect(page.getByRole('button', { name: /^备忘(?:\s+\d+)?$/ })).toBeVisible()
      await expect(page.getByRole('button', { name: '最小化窗口' })).toBeVisible()
      await expect(page.getByRole('button', { name: '关闭窗口并保留后台运行' })).toBeVisible()

      const layout = await page.evaluate(() => {
        const content = document.querySelector<HTMLElement>('.workspace-content')
        const activePage = content?.firstElementChild as HTMLElement | null
        const activeBounds = activePage?.getBoundingClientRect()
        return {
          devicePixelRatio: window.devicePixelRatio,
          documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          contentOverflow: content ? content.scrollWidth - content.clientWidth : null,
          activePageReachable: Boolean(
            activeBounds &&
              activeBounds.right > 0 &&
              activeBounds.bottom > 0 &&
              activeBounds.left < window.innerWidth &&
              activeBounds.top < window.innerHeight
          )
        }
      })
      expect(layout.devicePixelRatio).toBeCloseTo(factor, 2)
      expect(layout.documentOverflow).toBeLessThanOrEqual(1)
      expect(layout.contentOverflow).not.toBeNull()
      expect(layout.activePageReachable).toBe(true)

      await page.emulateMedia({ reducedMotion: 'reduce' })
      const reducedMotion = await page.evaluate(() => {
        const style = getComputedStyle(document.querySelector('button')!)
        const milliseconds = (value: string): number =>
          value.endsWith('ms') ? Number.parseFloat(value) : Number.parseFloat(value) * 1_000
        return {
          matches: matchMedia('(prefers-reduced-motion: reduce)').matches,
          transitionMilliseconds: milliseconds(style.transitionDuration),
          animationMilliseconds: milliseconds(style.animationDuration)
        }
      })
      expect(reducedMotion.matches).toBe(true)
      expect(reducedMotion.transitionMilliseconds).toBeLessThanOrEqual(0.011)
      expect(reducedMotion.animationMilliseconds).toBeLessThanOrEqual(0.011)
    } finally {
      await electronApp.evaluate(({ app }) => app.exit(0)).catch(() => undefined)
    }
  }
})
