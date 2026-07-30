import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

test('freezes an active effort after an abrupt exit and asks how to recover it', async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'youtrace-effort-recovery-e2e-'))
  const userDataPath = join(fixtureRoot, 'app-data')
  const workspacePath = join(fixtureRoot, 'workspace')
  const environment = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)
  )
  const launchOptions = {
    args: ['.', `--user-data-dir=${userDataPath}`],
    env: { ...environment, NODE_ENV: 'production', YOUTRACE_E2E: '1' }
  }
  let electronApp = await electron.launch(launchOptions)

  try {
    let page = await electronApp.firstWindow()
    const setup = await page.evaluate(
      async ({ rootPath }) => {
        const api = (globalThis as unknown as { youtrace: any }).youtrace
        await api.workspace.create({ rootPath, name: '中断计时恢复验收' })
        const project = await api.planning.createProject({
          areaId: null,
          name: '恢复项目',
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
          title: '异常退出中的工作',
          description: '',
          status: 'ready',
          difficulty: null,
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
        return effort.data
      },
      { rootPath: workspacePath }
    )

    const heartbeatPath = join(workspacePath, 'recovery', 'active-effort-heartbeat.json')
    await expect
      .poll(async () => JSON.parse(await readFile(heartbeatPath, 'utf8')))
      .toMatchObject({ effortId: setup.id })
    const closePromise = electronApp.waitForEvent('close')
    await electronApp.evaluate(({ app }) => app.exit(0)).catch(() => undefined)
    await closePromise

    electronApp = await electron.launch(launchOptions)
    page = await electronApp.firstWindow()
    const recovery = page.getByRole('alertdialog')
    await expect(recovery.getByRole('heading', { name: '发现一段异常中断的计时' })).toBeVisible()
    await expect(recovery).toContainText('异常退出中的工作')
    await expect(recovery).toContainText('没有把程序关闭后的时间计入努力')

    const active = await page.evaluate(async () =>
      (globalThis as unknown as { youtrace: any }).youtrace.execution.getActiveEffort()
    )
    expect(active).toMatchObject({
      ok: true,
      data: { id: setup.id }
    })
    expect(active.data.suspendedAt).not.toBeNull()

    await recovery.getByRole('button', { name: '保留为暂停' }).click()
    await expect(recovery).toHaveCount(0)
    expect(
      await page.evaluate(async () =>
        (globalThis as unknown as { youtrace: any }).youtrace.execution.getPendingRecovery()
      )
    ).toEqual({ ok: true, data: null })
  } finally {
    await electronApp.evaluate(({ app }) => app.exit(0)).catch(() => undefined)
  }
})
