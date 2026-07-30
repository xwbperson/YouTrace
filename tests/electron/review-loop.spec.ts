import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

function localDate(value: Date): string {
  const offset = value.getTimezoneOffset() * 60_000
  return new Date(value.getTime() - offset).toISOString().slice(0, 10)
}

function addDays(value: Date, days: number): Date {
  const result = new Date(value)
  result.setDate(result.getDate() + days)
  return result
}

test('keeps a weekly snapshot immutable while rescheduling, splitting and cancelling future work', async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'youtrace-review-loop-e2e-'))
  const environment = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)
  )
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const weekStartDate = addDays(today, -(today.getDay() === 0 ? 6 : today.getDay() - 1))
  const weekEndDate = addDays(weekStartDate, 6)
  const nextWeekDate = addDays(weekStartDate, 9)
  const weekStart = localDate(weekStartDate)
  const weekEnd = localDate(weekEndDate)
  const nextDueDate = localDate(nextWeekDate)
  const originalDueAt = `${weekEnd}T12:00:00.000Z`
  const nextDueAt = new Date(`${nextDueDate}T12:00:00`).toISOString()

  const electronApp = await electron.launch({
    args: ['.', `--user-data-dir=${join(fixtureRoot, 'app-data')}`],
    env: { ...environment, NODE_ENV: 'production' }
  })

  try {
    const page = await electronApp.firstWindow()
    const setup = await page.evaluate(
      async ({ rootPath, weekStart, weekEnd, originalDueAt }) => {
        type Result<T = unknown> = { ok: boolean; data?: T }
        const api = (
          globalThis as unknown as {
            youtrace: {
              workspace: {
                create(input: { rootPath: string; name: string }): Promise<Result>
              }
              planning: {
                createProject(input: Record<string, unknown>): Promise<Result<{ id: string }>>
                createTask(input: Record<string, unknown>): Promise<
                  Result<{ id: string; title: string }>
                >
              }
              temporal: {
                createPlan(input: Record<string, unknown>): Promise<Result<{ id: string }>>
                createTimeBlock(input: Record<string, unknown>): Promise<Result<{ id: string }>>
              }
              execution: {
                createManualEffort(input: Record<string, unknown>): Promise<Result<{ id: string }>>
              }
            }
          }
        ).youtrace
        const workspace = await api.workspace.create({ rootPath, name: '复盘闭环验收' })
        const project = await api.planning.createProject({
          areaId: null,
          name: '周复盘项目',
          description: '',
          status: 'active',
          startDate: weekStart,
          targetDate: null,
          successCriteria: '',
          progressMode: 'equal'
        })
        const definitions = [
          { title: '完成本周成果', status: 'completed' },
          { title: '顺延协议实验', status: 'ready' },
          { title: '拆分章节复习', status: 'ready' },
          { title: '取消低价值整理', status: 'ready' }
        ] as const
        const tasks: Array<{ id: string; title: string }> = []
        for (const definition of definitions) {
          if (!project.data) break
          const result = await api.planning.createTask({
            parentTaskId: null,
            projectId: project.data.id,
            goalId: null,
            milestoneId: null,
            title: definition.title,
            description: '',
            status: definition.status,
            difficulty: 3,
            priority: definition.title.startsWith('顺延') ? 'high' : 'medium',
            estimatedMinutes: 60,
            progressWeight: null,
            startDate: weekStart,
            dueAt: originalDueAt,
            verificationCriteria: '',
            includeInProgress: true,
            tagIds: []
          })
          if (result.data) tasks.push(result.data)
        }
        const plan =
          project.data && tasks.length === 4
            ? await api.temporal.createPlan({
                periodType: 'week',
                startDate: weekStart,
                endDate: weekEnd,
                title: '本周执行计划',
                focusResult: '完成协议分析',
                capacityMinutes: 360,
                items: tasks.map((task) => ({
                  entityType: 'task',
                  entityId: task.id,
                  titleSnapshot: task.title
                }))
              })
            : { ok: false }
        const block =
          tasks[1]
            ? await api.temporal.createTimeBlock({
                taskId: tasks[1].id,
                title: '协议实验专注块',
                note: '按原计划执行',
                startsAt: `${weekStart}T01:00:00.000Z`,
                endsAt: `${weekStart}T02:00:00.000Z`,
                timezone: 'Asia/Shanghai'
              })
            : { ok: false }
        const effort =
          tasks[0]
            ? await api.execution.createManualEffort({
                entityType: 'task',
                entityId: tasks[0].id,
                startedAt: `${weekStart}T02:00:00.000Z`,
                endedAt: `${weekStart}T03:00:00.000Z`,
                effectiveMinutes: 60,
                result: '完成本周成果',
                interruptions: '',
                obstacles: '',
                nextStep: '',
                energy: 4,
                perceivedDifficulty: 3,
                tagIds: []
              })
            : { ok: false }
        return {
          workspace: workspace.ok,
          project: project.ok,
          tasks: tasks.length,
          plan: plan.ok,
          block: block.ok,
          effort: effort.ok,
          projectId: project.data?.id,
          taskIds: Object.fromEntries(tasks.map((task) => [task.title, task.id]))
        }
      },
      {
        rootPath: join(fixtureRoot, 'workspace'),
        weekStart,
        weekEnd,
        originalDueAt
      }
    )
    expect(setup).toMatchObject({
      workspace: true,
      project: true,
      tasks: 4,
      plan: true,
      block: true,
      effort: true,
      projectId: expect.any(String)
    })
    await page.reload()

    await page.getByRole('button', { name: '复盘', exact: true }).click()
    await page.getByRole('button', { name: '生成复盘' }).first().click()
    await page.getByLabel('复盘标题').fill('本周课程复盘')
    await page.getByRole('button', { name: /生成快照/ }).click()

    await expect(page.getByRole('heading', { name: '本周课程复盘' })).toBeVisible()
    await expect(page.getByText('计划事项').locator('..').getByText('4')).toBeVisible()
    await expect(page.getByText('已完成').locator('..').getByText('1')).toBeVisible()
    for (const title of Object.keys(setup.taskIds as Record<string, string>)) {
      await expect(page.locator('.snapshot-list').getByText(title)).toBeVisible()
    }

    await page.getByLabel('重要成果').fill('已完成协议分析成果')
    await page.getByLabel('阻塞与延期原因').fill('实验环境占用导致延期')
    await page.getByLabel('下一周期第一步').fill('先恢复实验环境')
    await page.getByLabel('下一周期承诺').fill('完成拆分后的复习任务')

    const selectOnly = async (title: string): Promise<void> => {
      for (const candidate of ['顺延协议实验', '拆分章节复习', '取消低价值整理']) {
        const checkbox = page.getByRole('checkbox', { name: candidate })
        if (candidate === title) {
          await checkbox.check()
        } else {
          await checkbox.uncheck()
        }
      }
    }

    await selectOnly('顺延协议实验')
    await page.getByLabel('新日期').fill(nextDueDate)
    await page.getByLabel('调整原因').fill('容量不足，顺延到下周')
    await page.getByRole('button', { name: '批量顺延' }).click()
    await expect(page.getByText('已执行 1 次调整')).toBeVisible()

    await selectOnly('拆分章节复习')
    await page.getByLabel('新日期').fill(nextDueDate)
    await page.getByLabel('拆分出的新任务').fill('完成第一轮复习')
    await page.getByLabel('调整原因').fill('拆成可在一次专注中完成的动作')
    await page.getByRole('button', { name: '批量拆分' }).click()
    await expect(page.getByText('已执行 2 次调整')).toBeVisible()

    await selectOnly('取消低价值整理')
    await page.getByLabel('调整原因').fill('不再支持本周成果')
    await page.getByRole('button', { name: '批量取消' }).click()
    await expect(page.getByText('已执行 3 次调整')).toBeVisible()

    await page.getByRole('button', { name: '完成复盘' }).click()
    await expect(page.locator('.review-status')).toHaveText('已完成')
    await expect(page.getByLabel('重要成果')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '保存草稿' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '完成复盘' })).toHaveCount(0)
    await expect(page.getByText('已完成协议分析成果', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '编辑复盘' })).toBeVisible()
    await expect(page.getByRole('button', { name: '删除复盘' })).toBeVisible()

    await page.getByRole('button', { name: '编辑复盘' }).click()
    await page.getByLabel('重要成果').fill('完成后补充的协议分析成果')
    await expect(page.getByRole('button', { name: '保存草稿' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '完成复盘' })).toHaveCount(0)
    await page.getByRole('button', { name: '保存修改' }).click()
    await expect(page.getByLabel('重要成果')).toHaveCount(0)
    await expect(page.getByText('完成后补充的协议分析成果', { exact: true })).toBeVisible()

    const snapshotList = page.locator('.snapshot-list')
    await expect(
      snapshotList
        .getByRole('article')
        .filter({ hasText: '顺延协议实验' })
        .getByText(`原计划未完成 · ${weekEnd}`)
    ).toBeVisible()
    await expect(snapshotList.getByText('完成第一轮复习')).toHaveCount(0)

    const verified = await page.evaluate(
      async ({ projectId, weekStart, weekEnd, nextDueAt, originalDueAt }) => {
        type Result<T> = { ok: boolean; data?: T }
        const api = (
          globalThis as unknown as {
            youtrace: {
              planning: {
                listTasks(input: Record<string, unknown>): Promise<
                  Result<
                    Array<{
                      title: string
                      status: string
                      dueAt: string | null
                    }>
                  >
                >
              }
              temporal: {
                listPlans(start: string, end: string): Promise<
                  Result<Array<{ title: string; items: unknown[] }>>
                >
                listTimeBlocks(input: Record<string, unknown>): Promise<Result<unknown[]>>
              }
              workflow: {
                listReviews(): Promise<
                  Result<
                    Array<{
                      title: string
                      status: string
                      adjustmentCount: number
                      importantOutcomes: string
                      blockers: string
                      snapshot: {
                        plans: unknown[]
                        tasks: Array<{ title: string; status: string; dueAt: string | null }>
                      }
                    }>
                  >
                >
              }
            }
          }
        ).youtrace
        const [tasks, plans, blocks, reviews] = await Promise.all([
          api.planning.listTasks({
            projectId,
            statuses: [],
            tagIds: [],
            includeDeleted: false,
            limit: 100,
            offset: 0
          }),
          api.temporal.listPlans(weekStart, weekEnd),
          api.temporal.listTimeBlocks({
            start: `${weekStart}T00:00:00.000Z`,
            end: `${weekEnd}T23:59:59.999Z`
          }),
          api.workflow.listReviews()
        ])
        const byTitle = Object.fromEntries(
          (tasks.data ?? []).map((task) => [task.title, { status: task.status, dueAt: task.dueAt }])
        )
        const review = reviews.data?.find((item) => item.title === '本周课程复盘')
        return {
          liveTasks: byTitle,
          planTitle: plans.data?.[0]?.title,
          planItemCount: plans.data?.[0]?.items.length,
          timeBlockCount: blocks.data?.length,
          review: review
            ? {
                status: review.status,
                adjustmentCount: review.adjustmentCount,
                importantOutcomes: review.importantOutcomes,
                blockers: review.blockers,
                snapshotPlanCount: review.snapshot.plans.length,
                snapshotTasks: Object.fromEntries(
                  review.snapshot.tasks.map((task) => [
                    task.title,
                    { status: task.status, dueAt: task.dueAt }
                  ])
                )
              }
            : null,
          expected: { nextDueAt, originalDueAt }
        }
      },
      { projectId: setup.projectId as string, weekStart, weekEnd, nextDueAt, originalDueAt }
    )
    expect(verified.planTitle).toBe('本周执行计划')
    expect(verified.planItemCount).toBe(4)
    expect(verified.timeBlockCount).toBe(1)
    expect(verified.liveTasks).toMatchObject({
      '完成本周成果': { status: 'completed', dueAt: originalDueAt },
      '顺延协议实验': { status: 'scheduled', dueAt: nextDueAt },
      '拆分章节复习': { status: 'ready', dueAt: originalDueAt },
      '完成第一轮复习': { status: 'ready', dueAt: nextDueAt },
      '取消低价值整理': { status: 'cancelled', dueAt: originalDueAt }
    })
    expect(verified.review).toMatchObject({
      status: 'completed',
      adjustmentCount: 3,
      importantOutcomes: '完成后补充的协议分析成果',
      blockers: '实验环境占用导致延期',
      snapshotPlanCount: 1,
      snapshotTasks: {
        '完成本周成果': { status: 'completed', dueAt: originalDueAt },
        '顺延协议实验': { status: 'ready', dueAt: originalDueAt },
        '拆分章节复习': { status: 'ready', dueAt: originalDueAt },
        '取消低价值整理': { status: 'ready', dueAt: originalDueAt }
      }
    })

    await page.getByRole('button', { name: '删除复盘' }).click()
    await expect(page.getByRole('heading', { name: '删除“本周课程复盘”' })).toBeVisible()
    await page.getByRole('button', { name: '移入回收站' }).click()
    await expect(page.getByText('还没有复盘', { exact: true })).toBeVisible()

    const deletion = await page.evaluate(async () => {
      type Result<T> = { ok: boolean; data?: T }
      const api = (
        globalThis as unknown as {
          youtrace: {
            workflow: { listReviews(): Promise<Result<unknown[]>> }
            data: {
              listTrash(): Promise<
                Result<Array<{ id: string; entityType: string; title: string }>>
              >
              restoreTrash(input: { id: string; confirmation: string }): Promise<Result<void>>
            }
          }
        }
      ).youtrace
      const reviews = await api.workflow.listReviews()
      const trash = await api.data.listTrash()
      const reviewTrash = trash.data?.find((item) => item.entityType === 'review')
      const restored = reviewTrash
        ? await api.data.restoreTrash({ id: reviewTrash.id, confirmation: '' })
        : { ok: false }
      return {
        visibleReviews: reviews.data?.length,
        trashTitle: reviewTrash?.title,
        restored: restored.ok
      }
    })
    expect(deletion).toEqual({
      visibleReviews: 0,
      trashTitle: '本周课程复盘',
      restored: true
    })

    await page.reload()
    await page.getByRole('button', { name: '复盘', exact: true }).click()
    await expect(page.locator('.review-status')).toHaveText('已完成')
    await expect(page.getByText('完成后补充的协议分析成果', { exact: true })).toBeVisible()
  } finally {
    await electronApp.evaluate(({ app }) => app.exit(0)).catch(() => undefined)
  }
})
