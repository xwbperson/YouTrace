import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

test('shows permanent effort and task changes in the project history report', async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'youtrace-project-history-e2e-'))
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
                createTask(input: Record<string, unknown>): Promise<{
                  ok: boolean
                  data?: { id: string }
                }>
                updateTask(input: Record<string, unknown>): Promise<{ ok: boolean }>
                trashTask(id: string): Promise<{ ok: boolean }>
              }
              execution: {
                startEffort(input: Record<string, unknown>): Promise<{
                  ok: boolean
                  data?: { id: string; startedAt: string }
                }>
                stopEffort(input: Record<string, unknown>): Promise<{
                  ok: boolean
                  data?: { endedAt: string | null }
                }>
                correctEffort(input: Record<string, unknown>): Promise<{ ok: boolean }>
                createManualEffort(input: Record<string, unknown>): Promise<{ ok: boolean }>
              }
            }
          }
        ).youtrace
        const workspace = await api.workspace.create({ rootPath, name: '项目历史验收' })
        const project = await api.planning.createProject({
          areaId: null,
          name: '计算机网络课程',
          description: '验证永久努力',
          status: 'active',
          startDate: '2026-07-30',
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
              title: '整理章节笔记',
              description: '',
              status: 'ready',
              difficulty: 3,
              priority: 'medium',
              estimatedMinutes: 45,
              progressWeight: null,
              startDate: null,
              dueAt: null,
              verificationCriteria: '',
              includeInProgress: true,
              tagIds: []
            })
          : { ok: false }
        const firstTimer =
          task.data && project.data
            ? await api.execution.startEffort({
                entityType: 'task',
                entityId: task.data.id,
                tagIds: []
              })
            : { ok: false }
        const firstStopped = firstTimer.data
          ? await api.execution.stopEffort({
              id: firstTimer.data.id,
              result: '完成第一轮计时',
              interruptions: '',
              obstacles: '',
              nextStep: '继续整理',
              energy: 4,
              perceivedDifficulty: 3
            })
          : { ok: false }
        const firstCorrected =
          firstTimer.data && firstStopped.data?.endedAt
            ? await api.execution.correctEffort({
                id: firstTimer.data.id,
                startedAt: firstTimer.data.startedAt,
                endedAt: firstStopped.data.endedAt,
                effectiveMinutes: 25,
                reason: '补记离线专注时间'
              })
            : { ok: false }
        const secondTimer =
          task.data && project.data
            ? await api.execution.startEffort({
                entityType: 'task',
                entityId: task.data.id,
                tagIds: []
              })
            : { ok: false }
        const secondStopped = secondTimer.data
          ? await api.execution.stopEffort({
              id: secondTimer.data.id,
              result: '完成第二轮计时',
              interruptions: '',
              obstacles: '',
              nextStep: '补充示意图',
              energy: 3,
              perceivedDifficulty: 3
            })
          : { ok: false }
        const manual =
          task.data && project.data
            ? await api.execution.createManualEffort({
                entityType: 'task',
                entityId: task.data.id,
                startedAt: '2026-07-30T01:00:00.000Z',
                endedAt: '2026-07-30T01:20:00.000Z',
                effectiveMinutes: 20,
                result: '完成第一版笔记',
                interruptions: '',
                obstacles: '',
                nextStep: '补充示意图',
                energy: 4,
                perceivedDifficulty: 3,
                tagIds: []
              })
            : { ok: false }
        const cancelled = task.data
          ? await api.planning.updateTask({ id: task.data.id, status: 'cancelled' })
          : { ok: false }
        const trashed = task.data ? await api.planning.trashTask(task.data.id) : { ok: false }
        return {
          workspace: workspace.ok,
          project: project.ok,
          task: task.ok,
          firstTimer: firstTimer.ok,
          firstStopped: firstStopped.ok,
          firstCorrected: firstCorrected.ok,
          secondTimer: secondTimer.ok,
          secondStopped: secondStopped.ok,
          manual: manual.ok,
          cancelled: cancelled.ok,
          trashed: trashed.ok,
          projectId: project.data?.id,
          taskId: task.data?.id
        }
      },
      { rootPath: join(fixtureRoot, 'workspace') }
    )
    expect(setup).toEqual({
      workspace: true,
      project: true,
      task: true,
      firstTimer: true,
      firstStopped: true,
      firstCorrected: true,
      secondTimer: true,
      secondStopped: true,
      manual: true,
      cancelled: true,
      trashed: true,
      projectId: expect.any(String),
      taskId: expect.any(String)
    })
    await page.reload()

    await page.getByRole('button', { name: '记录', exact: true }).click()
    const effortTimeline = page.locator('.effort-timeline')
    await expect(effortTimeline.getByRole('article')).toHaveCount(3)
    await expect(effortTimeline.getByText('计时记录')).toHaveCount(2)
    await expect(effortTimeline.getByText('手动补录')).toHaveCount(1)
    await effortTimeline
      .getByRole('article')
      .filter({ hasText: '完成第一轮计时' })
      .getByRole('button', { name: '更正' })
      .click()
    await expect(page.getByText('0 → 25 分钟 · 补记离线专注时间')).toBeVisible()
    await page.getByRole('button', { name: '关闭' }).click()

    await page.getByRole('button', { name: '计划', exact: true }).click()
    await expect(page.getByRole('heading', { name: '项目历史' })).toBeVisible()
    const history = page.getByTestId('project-history')
    await expect(history.getByText('3 次投入')).toBeVisible()
    await expect(history.getByText('45 分钟')).toBeVisible()
    await expect(history.locator('li.effort')).toHaveCount(3)
    await expect(history.getByText('整理章节笔记').first()).toBeVisible()
    await expect(history.getByText('完成第一版笔记')).toBeVisible()
    await expect(history.getByText('已移入回收站')).toBeVisible()

    await page.getByRole('button', { name: '更多', exact: true }).click()
    await page.getByRole('tab', { name: /回收站/ }).click()
    const trashItem = page.getByRole('article').filter({ hasText: '整理章节笔记' })
    await expect(trashItem).toBeVisible()
    await trashItem.getByRole('button', { name: '恢复' }).click()
    await expect(page.getByText('恢复已完成。')).toBeVisible()

    await page.getByRole('button', { name: '计划', exact: true }).click()
    await expect(page.getByText('整理章节笔记').first()).toBeVisible()
    await expect(page.getByTestId('project-history').getByText('已从回收站恢复')).toBeVisible()

    const preserved = await page.evaluate(
      async ({ projectId, taskId }) => {
        const api = (
          globalThis as unknown as {
            youtrace: {
              planning: {
                listProjectHistory(id: string): Promise<{
                  ok: boolean
                  data?: {
                    effortCount: number
                    totalMinutes: number
                    entries: Array<{
                      kind: string
                      entityId: string | null
                      title: string
                      source: string | null
                    }>
                  }
                }>
                listTasks(input: Record<string, unknown>): Promise<{
                  ok: boolean
                  data?: Array<{ id: string; status: string }>
                }>
              }
            }
          }
        ).youtrace
        const historyResult = await api.planning.listProjectHistory(projectId)
        const taskResult = await api.planning.listTasks({
          projectId,
          statuses: [],
          tagIds: [],
          includeDeleted: false,
          limit: 100,
          offset: 0
        })
        const efforts =
          historyResult.data?.entries.filter((entry) => entry.kind === 'effort') ?? []
        return {
          effortCount: historyResult.data?.effortCount,
          totalMinutes: historyResult.data?.totalMinutes,
          sources: efforts.map((entry) => entry.source).sort(),
          snapshotsPreserved: efforts.every(
            (entry) => entry.entityId === taskId && entry.title === '整理章节笔记'
          ),
          restoredStatus: taskResult.data?.find((task) => task.id === taskId)?.status
        }
      },
      { projectId: setup.projectId as string, taskId: setup.taskId as string }
    )
    expect(preserved).toEqual({
      effortCount: 3,
      totalMinutes: 45,
      sources: ['manual', 'timer', 'timer'],
      snapshotsPreserved: true,
      restoredStatus: 'cancelled'
    })
  } finally {
    await electronApp.evaluate(({ app }) => app.exit(0)).catch(() => undefined)
  }
})
