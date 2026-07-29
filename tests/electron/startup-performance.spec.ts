import { access, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { _electron as electron, expect, test } from '@playwright/test'

const executablePath = resolve('release/win-unpacked/有迹.exe')

test('release cold start reaches the workspace dashboard within the P95 target', async () => {
  test.setTimeout(120_000)
  await access(executablePath).catch(() => test.skip(true, '先运行 npm run dist:win 生成打包应用'))
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'youtrace-startup-performance-'))
  const userDataPath = join(fixtureRoot, 'app-data')
  const workspacePath = join(fixtureRoot, 'workspace')
  const args = [`--user-data-dir=${userDataPath}`]

  const setupApp = await electron.launch({ executablePath, args })
  try {
    const page = await setupApp.firstWindow()
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
          name: '启动性能工作区'
        }),
      { path: workspacePath }
    )
    expect(result).toMatchObject({ ok: true })
  } finally {
    await setupApp.evaluate(({ app }) => app.exit(0)).catch(() => undefined)
  }

  const durations: number[] = []
  for (let index = 0; index < 20; index += 1) {
    const startedAt = performance.now()
    const app = await electron.launch({ executablePath, args })
    try {
      const page = await app.firstWindow()
      await expect(
        page.getByRole('heading', { name: '今天，从一件真正重要的事开始。' })
      ).toBeVisible()
      durations.push(performance.now() - startedAt)
    } finally {
      await app.evaluate(({ app: electronApp }) => electronApp.exit(0)).catch(() => undefined)
    }
  }

  durations.sort((left, right) => left - right)
  const report = {
    runs: durations.length,
    median: round(durations[9]!),
    p95: round(durations[18]!)
  }
  process.stdout.write(`\nYOUTRACE_STARTUP_PERFORMANCE ${JSON.stringify(report)}\n`)
  expect(report.p95).toBeLessThan(3_000)
})

function round(value: number): number {
  return Math.round(value * 100) / 100
}
