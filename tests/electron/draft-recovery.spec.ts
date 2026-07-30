import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

test('restores an unsaved quick memo after the application exits', async () => {
  test.setTimeout(30_000)
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'youtrace-draft-recovery-e2e-'))
  const userDataPath = join(fixtureRoot, 'app-data')
  const environment = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)
  )
  const launch = () =>
    electron.launch({
      args: ['.', `--user-data-dir=${userDataPath}`],
      env: { ...environment, NODE_ENV: 'production' }
    })

  const firstApp = await launch()
  const firstPage = await firstApp.firstWindow()
  const created = await firstPage.evaluate(
    async ({ rootPath }) =>
      (
        globalThis as unknown as {
          youtrace: {
            workspace: {
              create(input: { rootPath: string; name: string }): Promise<{ ok: boolean }>
            }
          }
        }
      ).youtrace.workspace.create({ rootPath, name: '草稿恢复验收' }),
    { rootPath: join(fixtureRoot, 'workspace') }
  )
  expect(created.ok).toBe(true)
  await firstPage.reload()
  await firstPage.getByRole('button', { name: /备忘/ }).click()
  await firstPage.getByLabel('快速记录').fill('异常退出后需要恢复的突然想法')
  await firstPage.getByLabel('备忘类型').selectOption('idea')
  await firstPage.getByLabel('来源链接').fill('https://example.com/draft-source')
  await expect
    .poll(async () =>
      firstPage.evaluate(async () => {
        const result = await (
          globalThis as unknown as {
            youtrace: {
              data: {
                listRecoveryDrafts(): Promise<{
                  ok: boolean
                  data?: Array<{ key: string; content: string }>
                }>
              }
            }
          }
        ).youtrace.data.listRecoveryDrafts()
        return result.ok ? result.data?.[0]?.content : null
      })
    )
    .toBe('异常退出后需要恢复的突然想法')
  await firstApp.evaluate(({ app }) => app.exit(0))

  const secondApp = await launch()
  try {
    const secondPage = await secondApp.firstWindow()
    await secondPage.getByRole('button', { name: /备忘/ }).click()
    const recovery = secondPage.getByText('发现上次未保存的快速备忘')
    await expect(recovery).toBeVisible()
    await secondPage.getByRole('button', { name: '恢复草稿' }).click()
    await expect(secondPage.getByLabel('快速记录')).toHaveValue(
      '异常退出后需要恢复的突然想法'
    )
    await expect(secondPage.getByLabel('备忘类型')).toHaveValue('idea')
    await expect(secondPage.getByLabel('来源链接')).toHaveValue(
      'https://example.com/draft-source'
    )

    await secondPage.getByRole('button', { name: '保存到收件箱' }).click()
    await expect(secondPage.getByText('异常退出后需要恢复的突然想法')).toBeVisible()
    const drafts = await secondPage.evaluate(async () =>
      (
        globalThis as unknown as {
          youtrace: {
            data: {
              listRecoveryDrafts(): Promise<{ ok: boolean; data?: unknown[] }>
            }
          }
        }
      ).youtrace.data.listRecoveryDrafts()
    )
    expect(drafts).toEqual({ ok: true, data: [] })
  } finally {
    await secondApp.evaluate(({ app }) => app.exit(0)).catch(() => undefined)
  }
})
