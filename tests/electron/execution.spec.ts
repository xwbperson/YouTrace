import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

test('records a timed effort and converts a memo through the Electron UI', async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'youtrace-execution-e2e-'))
  const memoAttachmentPath = join(fixtureRoot, 'memo-attachment.txt')
  await writeFile(memoAttachmentPath, 'memo attachment content', 'utf8')
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
        const api = (
          globalThis as unknown as {
            youtrace: {
              workspace: {
                create(input: { rootPath: string; name: string }): Promise<{ ok: boolean }>
              }
              planning: {
                createProject(input: Record<string, unknown>): Promise<{
                  ok: boolean
                  data?: { id: string }
                }>
                createTask(input: Record<string, unknown>): Promise<{ ok: boolean }>
              }
            }
          }
        ).youtrace
        const workspace = await api.workspace.create({ rootPath, name: '执行验收工作区' })
        const project = await api.planning.createProject({
          areaId: null,
          name: '最小复现',
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
              title: '运行第一轮复现',
              description: '',
              status: 'ready',
              difficulty: 4,
              priority: 'high',
              estimatedMinutes: 45,
              progressWeight: null,
              startDate: null,
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

    await page.getByRole('button', { name: '今日', exact: true }).click()
    await expect(
      page.getByRole('article').filter({ hasText: '运行第一轮复现' }).first()
    ).toBeVisible()
    await page.getByRole('button', { name: '开始', exact: true }).click()
    await expect(page.getByText('正在投入')).toBeVisible()
    await page.getByRole('button', { name: '停止并记录' }).click()
    await page.getByLabel('实际结果').fill('完成第一轮复现并定位依赖问题')
    await page.getByLabel('困难').fill('原生依赖版本不一致')
    await page.getByLabel('下一步').fill('锁定依赖并重试')
    await page.getByRole('button', { name: '保存并停止' }).click()
    await expect(page.getByText('当前没有计时')).toBeVisible()

    await page.getByRole('button', { name: '记录', exact: true }).click()
    await expect(page.getByText('完成第一轮复现并定位依赖问题')).toBeVisible()

    await page.getByRole('button', { name: /备忘/ }).click()
    await page.getByLabel('快速记录').fill('把依赖排查步骤整理成检查表')
    await page.getByLabel('备忘类型').selectOption('idea')
    await page.getByLabel('选择备忘附件').setInputFiles(memoAttachmentPath)
    await page.getByRole('button', { name: '保存备忘及附件' }).click()
    await expect(page.getByText('把依赖排查步骤整理成检查表')).toBeVisible()
    await expect(page.locator('.memo-evidence-count')).toHaveText('1')
    await page.getByRole('button', { name: '整理' }).click()
    await page.getByRole('button', { name: '创建任务并保留来源' }).click()
    await expect(page.getByText('已转为任务')).toBeVisible()
    await page.getByRole('button', { name: '归档备忘' }).click()
    await page.getByRole('checkbox', { name: '显示已归档' }).check()
    const archivedMemo = page.getByRole('article').filter({ hasText: '把依赖排查步骤整理成检查表' })
    await expect(archivedMemo.getByText('已归档')).toBeVisible()
    await archivedMemo.getByRole('button', { name: '永久删除备忘' }).click()
    await expect(page.getByRole('heading', { name: '永久删除这条备忘？' })).toBeVisible()
    await page.getByRole('button', { name: '确认永久删除' }).click()
    await expect(archivedMemo).toHaveCount(0)
    await page.screenshot({ path: 'test-results/execution-memo.png' })
  } finally {
    await electronApp.evaluate(({ app }) => app.exit(0)).catch(() => undefined)
  }
})
