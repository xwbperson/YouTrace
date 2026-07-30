import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

test('shows a failed migration on reload and keeps an unrelated target untouched when returning to source', async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'youtrace-migration-recovery-e2e-'))
  const workspacePath = join(fixtureRoot, 'workspace')
  const occupiedTarget = join(fixtureRoot, 'occupied-target')
  await mkdir(occupiedTarget, { recursive: true })
  await writeFile(join(occupiedTarget, 'keep.txt'), 'keep this file', 'utf8')
  const environment = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)
  )
  const electronApp = await electron.launch({
    args: ['.', `--user-data-dir=${join(fixtureRoot, 'app-data')}`],
    env: { ...environment, NODE_ENV: 'production' }
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
        ).youtrace.workspace.create({ rootPath, name: '迁移恢复验收' }),
      { rootPath: workspacePath }
    )
    expect(created.ok).toBe(true)
    await page.reload()

    const migration = await page.evaluate(
      async ({ targetRoot }) =>
        (
          globalThis as unknown as {
            youtrace: {
              data: {
                migrateWorkspace(input: { targetRoot: string }): Promise<{
                  ok: boolean
                  error?: { code: string }
                }>
              }
            }
          }
        ).youtrace.data.migrateWorkspace({ targetRoot }),
      { targetRoot: occupiedTarget }
    )
    expect(migration).toMatchObject({
      ok: false,
      error: { code: 'TARGET_NOT_EMPTY' }
    })

    await page.reload()
    const recovery = page.getByRole('alertdialog')
    await expect(recovery).toContainText('上次迁移没有完成')
    await expect(recovery).toContainText(workspacePath)
    await expect(recovery).toContainText(occupiedTarget)
    await recovery.getByRole('button', { name: '继续使用源工作区' }).click()
    await expect(recovery).toHaveCount(0)
    expect(await readFile(join(occupiedTarget, 'keep.txt'), 'utf8')).toBe('keep this file')

    const pending = await page.evaluate(async () =>
      (
        globalThis as unknown as {
          youtrace: {
            data: {
              getPendingMigration(): Promise<{ ok: boolean; data?: unknown }>
            }
          }
        }
      ).youtrace.data.getPendingMigration()
    )
    expect(pending).toEqual({ ok: true, data: null })
  } finally {
    await electronApp.evaluate(({ app }) => app.exit(0)).catch(() => undefined)
  }
})
