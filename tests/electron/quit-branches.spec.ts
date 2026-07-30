import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

test('cancels an active-effort quit or suspends it without counting offline time', async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'youtrace-quit-branches-e2e-'))
  const userDataPath = join(fixtureRoot, 'app-data')
  const workspacePath = join(fixtureRoot, 'workspace')
  const environment = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)
  )
  const launchArgs = ['.', `--user-data-dir=${userDataPath}`]
  const launchEnvironment = {
    ...environment,
    NODE_ENV: 'production',
    YOUTRACE_E2E: '1'
  }
  let electronApp = await electron.launch({ args: launchArgs, env: launchEnvironment })

  try {
    let page = await electronApp.firstWindow()
    const setup = await page.evaluate(
      async ({ rootPath }) => {
        const api = (globalThis as unknown as { youtrace: any }).youtrace
        const workspace = await api.workspace.create({ rootPath, name: '退出分支验收' })
        const project = await api.planning.createProject({
          areaId: null,
          name: '退出保护项目',
          description: '',
          status: 'active',
          startDate: null,
          targetDate: null,
          successCriteria: '',
          progressMode: 'equal'
        })
        const task = await api.planning.createTask({
          parentTaskId: null,
          projectId: project.data.id,
          goalId: null,
          milestoneId: null,
          title: '退出前活动计时',
          description: '',
          status: 'ready',
          difficulty: 2,
          priority: 'medium',
          estimatedMinutes: 30,
          progressWeight: null,
          startDate: null,
          dueAt: null,
          verificationCriteria: '',
          includeInProgress: true,
          tagIds: []
        })
        const effort = await api.execution.startEffort({
          entityType: 'task',
          entityId: task.data.id,
          tagIds: []
        })
        return {
          workspace: workspace.ok,
          taskId: task.data.id,
          effortId: effort.data.id
        }
      },
      { rootPath: workspacePath }
    )
    expect(setup.workspace).toBe(true)

    await electronApp.evaluate(async ({ dialog }) => {
      ;(dialog.showMessageBox as unknown as (...args: unknown[]) => unknown) = async () => ({
        response: 2,
        checkboxChecked: false
      })
      const hook = (
        globalThis as unknown as {
          __youtraceE2E?: { requestApplicationQuit(): Promise<void> }
        }
      ).__youtraceE2E
      if (!hook) throw new Error('E2E quit hook is unavailable')
      await hook.requestApplicationQuit()
    })
    expect(
      await page.evaluate(async () =>
        (globalThis as unknown as { youtrace: any }).youtrace.execution.getActiveEffort()
      )
    ).toMatchObject({
      ok: true,
      data: { id: setup.effortId, suspendedAt: null }
    })

    const closePromise = electronApp.waitForEvent('close')
    await electronApp
      .evaluate(async ({ dialog }) => {
        ;(dialog.showMessageBox as unknown as (...args: unknown[]) => unknown) = async () => ({
          response: 1,
          checkboxChecked: false
        })
        const hook = (
          globalThis as unknown as {
            __youtraceE2E?: { requestApplicationQuit(): Promise<void> }
          }
        ).__youtraceE2E
        if (!hook) throw new Error('E2E quit hook is unavailable')
        await hook.requestApplicationQuit()
      })
      .catch(() => undefined)
    await closePromise

    electronApp = await electron.launch({ args: launchArgs, env: launchEnvironment })
    page = await electronApp.firstWindow()
    const reopened = await page.evaluate(async () =>
      (globalThis as unknown as { youtrace: any }).youtrace.execution.getActiveEffort()
    )
    expect(reopened).toMatchObject({
      ok: true,
      data: { id: setup.effortId }
    })
    expect(reopened.data.suspendedAt).not.toBeNull()

    await page.getByRole('button', { name: '今日', exact: true }).click()
    await expect(page.getByText('会话已暂停')).toBeVisible()
    await page.getByRole('button', { name: '继续计时' }).click()
    await page.getByRole('button', { name: '停止并记录' }).click()
    await page.getByLabel('实际结果').fill('退出分支保持了计时事实')
    await page.getByRole('button', { name: '保存并停止' }).click()
    await expect(page.getByText('当前没有计时')).toBeVisible()
  } finally {
    await electronApp.evaluate(({ app }) => app.exit(0)).catch(() => undefined)
  }
})
