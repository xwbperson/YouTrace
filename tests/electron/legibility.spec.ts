import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, type Page, test } from '@playwright/test'

interface LegibilityIssue {
  kind: 'micro-text' | 'small-control-text' | 'missing-control-boundary' | 'short-control'
  element: string
  detail: string
}

async function auditVisibleUi(page: Page): Promise<LegibilityIssue[]> {
  return page.evaluate(() => {
    const issues: LegibilityIssue[] = []
    const visible = (element: Element): element is HTMLElement => {
      if (!(element instanceof HTMLElement)) return false
      const style = getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        Number(style.opacity) > 0 &&
        rect.width > 0 &&
        rect.height > 0
      )
    }
    const describe = (element: HTMLElement): string => {
      const label =
        element.getAttribute('aria-label') ||
        element.getAttribute('placeholder') ||
        element.textContent?.trim().slice(0, 40) ||
        element.tagName.toLowerCase()
      const className =
        typeof element.className === 'string' && element.className
          ? `.${element.className.trim().split(/\s+/).join('.')}`
          : ''
      return `${element.tagName.toLowerCase()}${className} "${label}"`
    }
    const hasBorder = (element: HTMLElement): boolean => {
      const style = getComputedStyle(element)
      const borders: Array<[string, string]> = [
        [style.borderTopWidth, style.borderTopStyle],
        [style.borderRightWidth, style.borderRightStyle],
        [style.borderBottomWidth, style.borderBottomStyle],
        [style.borderLeftWidth, style.borderLeftStyle]
      ]
      return borders.some(
        ([width, borderStyle]) => Number.parseFloat(width) > 0 && borderStyle !== 'none'
      )
    }

    for (const node of document.body.querySelectorAll('*')) {
      if (!visible(node)) continue
      const directText = Array.from(node.childNodes)
        .filter((child) => child.nodeType === Node.TEXT_NODE)
        .map((child) => child.textContent?.trim() ?? '')
        .join(' ')
        .trim()
      if (directText) {
        const fontSize = Number.parseFloat(getComputedStyle(node).fontSize)
        if (fontSize < 13) {
          issues.push({
            kind: 'micro-text',
            element: describe(node),
            detail: `${fontSize}px`
          })
        }
      }
    }

    const controls = document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
      'input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]):not([type="hidden"]), textarea, select'
    )
    for (const control of controls) {
      if (!visible(control)) continue
      const style = getComputedStyle(control)
      const fontSize = Number.parseFloat(style.fontSize)
      if (fontSize < 16) {
        issues.push({
          kind: 'small-control-text',
          element: describe(control),
          detail: `${fontSize}px`
        })
      }
      const composite = control.closest<HTMLElement>('.memo-source-link, .global-search-input')
      if (!hasBorder(control) && (!composite || !hasBorder(composite))) {
        const boundary = getComputedStyle(composite ?? control)
        issues.push({
          kind: 'missing-control-boundary',
          element: describe(control),
          detail: `${composite ? `unbounded ${composite.className}` : 'no visible border'}; ${[
            boundary.borderTopWidth,
            boundary.borderTopStyle,
            boundary.borderRightWidth,
            boundary.borderRightStyle,
            boundary.borderBottomWidth,
            boundary.borderBottomStyle,
            boundary.borderLeftWidth,
            boundary.borderLeftStyle
          ].join(' / ')}`
        })
      }
      if (control.getBoundingClientRect().height < 34) {
        issues.push({
          kind: 'short-control',
          element: describe(control),
          detail: `${control.getBoundingClientRect().height}px`
        })
      }
    }
    return issues
  })
}

async function expectLegible(page: Page, location: string): Promise<void> {
  const issues = await auditVisibleUi(page)
  expect(issues, `${location}\n${JSON.stringify(issues, null, 2)}`).toEqual([])
}

test('keeps text and form boundaries legible across the Electron application', async () => {
  test.setTimeout(120_000)
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'youtrace-legibility-e2e-'))
  const screenshotRoot = join(process.cwd(), 'test-results', 'ui-legibility')
  await mkdir(screenshotRoot, { recursive: true })
  const environment = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)
  )
  const electronApp = await electron.launch({
    args: ['.', `--user-data-dir=${join(fixtureRoot, 'app-data')}`],
    env: { ...environment, NODE_ENV: 'production' }
  })

  try {
    const page = await electronApp.firstWindow()
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(1440, 920)
    })
    const setup = await page.evaluate(async ({ rootPath }) => {
      const api = (globalThis as unknown as { youtrace: any }).youtrace
      const workspace = await api.workspace.create({ rootPath, name: '界面可读性验收' })
      const preferences = await api.settings.getPreferences()
      if (!workspace.ok || !preferences.ok) return false
      const updated = await api.settings.updatePreferences({
        ...preferences.data,
        theme: 'light',
        density: 'compact',
        fontScale: 1
      })
      return updated.ok
    }, { rootPath: join(fixtureRoot, 'workspace') })
    expect(setup).toBe(true)
    await page.reload()
    await expect(page.getByRole('button', { name: '首页', exact: true })).toBeVisible()

    const locations = ['首页', '今日', '计划', '日历', '记录', '备忘', '复盘', '标签', '模板', '更多', '设置']
    for (const location of locations) {
      await page.locator('.sidebar').getByText(location, { exact: true }).click()
      await page.waitForTimeout(80)
      await expectLegible(page, `浅色主题 / ${location}`)
      if (['首页', '备忘', '设置'].includes(location)) {
        await page.screenshot({
          path: join(screenshotRoot, `light-${location}.png`)
        })
      }
    }

    await page.keyboard.press('Control+K')
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.waitForTimeout(250)
    await expectLegible(page, '浅色主题 / 全局搜索')
    await page.screenshot({
      path: join(screenshotRoot, 'light-search.png')
    })
    await page.keyboard.press('Escape')

    await page.locator('.sidebar').getByText('设置', { exact: true }).click()
    await page.getByLabel('主题').selectOption('dark')
    await page.getByLabel('字号比例').fill('1.25')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expectLegible(page, '深色主题 / 125% 字号 / 设置')
    const difficultyFields = await page.locator('.difficulty-settings input').evaluateAll((inputs) =>
      inputs.map((input) => {
        const rect = input.getBoundingClientRect()
        return { width: rect.width, top: rect.top }
      })
    )
    expect(difficultyFields).toHaveLength(5)
    expect(Math.min(...difficultyFields.map(({ width }) => width))).toBeGreaterThan(140)
    expect(
      Math.max(...difficultyFields.map(({ top }) => top)) -
        Math.min(...difficultyFields.map(({ top }) => top))
    ).toBeLessThan(2)
    await page.screenshot({
      path: join(screenshotRoot, 'dark-125-settings.png')
    })

    await page.locator('.sidebar').getByText('备忘', { exact: true }).click()
    await expectLegible(page, '深色主题 / 125% 字号 / 备忘')
    await expect(page.getByLabel('快速记录')).toBeVisible()
    expect(
      await page.getByLabel('快速记录').evaluate((textarea) => textarea.getBoundingClientRect().width)
    ).toBeGreaterThan(480)
    await page.screenshot({
      path: join(screenshotRoot, 'dark-125-memos.png')
    })
  } finally {
    await electronApp.evaluate(({ app }) => app.exit(0)).catch(() => undefined)
  }
})
