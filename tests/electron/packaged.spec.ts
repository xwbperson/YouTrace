import { spawn } from 'node:child_process'
import { access, mkdtemp } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, chromium, expect, test, type Page } from '@playwright/test'

const unpackedPath = resolve('release/win-unpacked/有迹.exe')
const portablePath = resolve('release/YouTrace-1.0.2-Portable.exe')

async function createWorkspaceAndAssert(
  page: Page,
  workspacePath: string,
  targetName: string
): Promise<void> {
  await expect(page.getByRole('heading', { name: '选择工作区' })).toBeVisible()
  const createResult = await page.evaluate(
    async ({ path, name }) =>
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
        name
      }),
    { path: workspacePath, name: `${targetName} 打包验收工作区` }
  )
  expect(createResult).toMatchObject({ ok: true })

  await page.reload()
  await expect(
    page.getByRole('heading', { name: '今天，从一件真正重要的事开始。' })
  ).toBeVisible()
  await expect(page.getByText('工作区已连接')).toBeVisible()
}

async function availablePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.unref()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('无法分配本地调试端口'))
        return
      }
      server.close(() => resolvePort(address.port))
    })
  })
}

async function waitForDebugPort(port: number): Promise<void> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (response.ok) return
    } catch {
      // Portable 首次启动需要先解包，端口尚未就绪时继续等待。
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250))
  }
  throw new Error('Portable 应用未在 30 秒内开放调试端口')
}

test('unpacked Windows app creates a SQLite workspace and opens the dashboard', async () => {
  await access(unpackedPath).catch(() => test.skip(true, '先运行 npm run dist:win 生成打包应用'))
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'youtrace-unpacked-test-'))
  const electronApp = await electron.launch({
    executablePath: unpackedPath,
    args: [`--user-data-dir=${join(fixtureRoot, 'app-data')}`]
  })

  try {
    const page = await electronApp.firstWindow()
    await createWorkspaceAndAssert(page, join(fixtureRoot, 'workspace'), 'unpacked')
    await page.screenshot({ path: 'test-results/dashboard-unpacked.png' })
  } finally {
    await electronApp.evaluate(({ app }) => app.exit(0)).catch(() => undefined)
  }
})

test('portable Windows app creates a SQLite workspace and opens the dashboard', async () => {
  test.setTimeout(60_000)
  await access(portablePath).catch(() => test.skip(true, '先运行 npm run dist:win 生成打包应用'))
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'youtrace-portable-test-'))
  const port = await availablePort()
  const portableProcess = spawn(
    portablePath,
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${join(fixtureRoot, 'app-data')}`
    ],
    { stdio: 'ignore', windowsHide: true }
  )
  let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined

  try {
    await waitForDebugPort(port)
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
    const page = browser.contexts().flatMap((context) => context.pages())[0]
    if (!page) throw new Error('Portable 应用没有创建可访问窗口')
    await createWorkspaceAndAssert(page, join(fixtureRoot, 'workspace'), 'portable')
    await page.screenshot({ path: 'test-results/dashboard-portable.png' })
    const session = await page.context().newCDPSession(page)
    await session.send('Browser.close').catch(() => undefined)
  } finally {
    await browser?.close().catch(() => undefined)
    portableProcess.kill()
  }
})
