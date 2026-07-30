import { spawn } from 'node:child_process'
import { access, mkdtemp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

const setupPath = resolve('release/YouTrace-1.0.2-Setup.exe')

function runExecutable(
  executablePath: string,
  args: string[],
  timeoutMs = 120_000
): Promise<void> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(executablePath, args, {
      stdio: 'ignore',
      windowsHide: true
    })
    const timeout = setTimeout(() => {
      child.kill()
      reject(new Error(`${executablePath} 在 ${timeoutMs}ms 内没有退出`))
    }, timeoutMs)
    child.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.once('exit', (code) => {
      clearTimeout(timeout)
      if (code === 0) resolveRun()
      else reject(new Error(`${executablePath} 退出码为 ${code}`))
    })
  })
}

async function waitForMissing(path: string): Promise<void> {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    try {
      await access(path)
    } catch {
      return
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 200))
  }
  throw new Error(`卸载后仍存在：${path}`)
}

test('NSIS setup installs, runs, uninstalls and preserves the external workspace', async () => {
  test.setTimeout(180_000)
  await access(setupPath).catch(() => test.skip(true, '先运行 npm run dist:win 生成安装包'))
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'youtrace-installer-test-'))
  const installPath = join(fixtureRoot, 'installed')
  const workspacePath = join(fixtureRoot, 'external-workspace')

  await runExecutable(setupPath, ['/S', `/D=${installPath}`])
  const appPath = join(installPath, '有迹.exe')
  await expect(access(appPath)).resolves.toBeUndefined()

  const electronApp = await electron.launch({
    executablePath: appPath,
    args: [`--user-data-dir=${join(fixtureRoot, 'app-data')}`]
  })
  try {
    const page = await electronApp.firstWindow()
    await expect(page.getByRole('heading', { name: '选择工作区' })).toBeVisible()
    const result = await page.evaluate(
      async ({ path }) =>
        (
          globalThis as unknown as {
            youtrace: {
              workspace: {
                create(input: { rootPath: string; name: string }): Promise<{ ok: boolean }>
              }
            }
          }
        ).youtrace.workspace.create({
          rootPath: path,
          name: '安装版验收工作区'
        }),
      { path: workspacePath }
    )
    expect(result).toMatchObject({ ok: true })
    await page.reload()
    await expect(page.getByText('工作区已连接')).toBeVisible()
  } finally {
    await electronApp.evaluate(({ app }) => app.exit(0)).catch(() => undefined)
  }

  const uninstallerName = (await readdir(installPath)).find((name) =>
    /^Uninstall.*\.exe$/i.test(name)
  )
  expect(uninstallerName).toBeDefined()
  await runExecutable(join(installPath, uninstallerName!), ['/S'])

  await waitForMissing(appPath)
  await expect(access(join(workspacePath, '.youtrace-workspace.json'))).resolves.toBeUndefined()
  await expect(access(join(workspacePath, 'database', 'youtrace.sqlite3'))).resolves.toBeUndefined()
})
