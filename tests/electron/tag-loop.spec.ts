import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

test('aggregates and merges one tag across six business object types without deleting data', async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'youtrace-tag-loop-e2e-'))
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
        type Result<T = unknown> = { ok: boolean; data?: T }
        const api = (
          globalThis as unknown as {
            youtrace: {
              workspace: {
                create(input: { rootPath: string; name: string }): Promise<Result>
              }
              planning: {
                createTag(input: Record<string, unknown>): Promise<Result<{ id: string }>>
                createProject(input: Record<string, unknown>): Promise<Result<{ id: string }>>
                createTask(input: Record<string, unknown>): Promise<Result<{ id: string }>>
                assignTag(input: Record<string, unknown>): Promise<Result>
              }
              temporal: {
                createCountdown(input: Record<string, unknown>): Promise<Result<{ id: string }>>
              }
              execution: {
                createMemo(input: Record<string, unknown>): Promise<Result<{ id: string }>>
                createManualEffort(input: Record<string, unknown>): Promise<Result<{ id: string }>>
                createEvidence(input: Record<string, unknown>): Promise<Result<{ id: string }>>
              }
            }
          }
        ).youtrace
        const workspace = await api.workspace.create({ rootPath, name: '标签闭环验收' })
        const tag = await api.planning.createTag({
          name: '计算机网络',
          color: '#216E65',
          icon: null,
          description: '课程主标签'
        })
        const alias = await api.planning.createTag({
          name: '网络课程',
          color: '#3D6FA8',
          icon: null,
          description: '待合并别名'
        })
        const project = await api.planning.createProject({
          areaId: null,
          name: '计算机网络课程项目',
          description: '',
          status: 'active',
          startDate: null,
          targetDate: null,
          successCriteria: '',
          progressMode: 'equal'
        })
        const task =
          project.data && tag.data
            ? await api.planning.createTask({
                parentTaskId: null,
                projectId: project.data.id,
                goalId: null,
                milestoneId: null,
                title: '完成协议分析',
                description: '',
                status: 'completed',
                difficulty: 4,
                priority: 'high',
                estimatedMinutes: 45,
                progressWeight: null,
                startDate: null,
                dueAt: null,
                verificationCriteria: '',
                includeInProgress: true,
                tagIds: [tag.data.id]
              })
            : { ok: false }
        const targetAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000).toISOString()
        const countdown =
          tag.data && task.data
            ? await api.temporal.createCountdown({
                title: '计算机网络考试',
                targetAt,
                timezone: 'Asia/Shanghai',
                workingDays: [1, 2, 3, 4, 5],
                bufferDays: 1,
                importance: 'high',
                entityType: 'task',
                entityId: task.data.id,
                remainingMinutes: 600,
                tagIds: [tag.data.id]
              })
            : { ok: false }
        const memo =
          tag.data && project.data
            ? await api.execution.createMemo({
                kind: 'idea',
                title: '协议分层联想',
                body: '把协议分层整理成一页图。',
                projectId: project.data.id,
                sourceLink: null,
                tagIds: [tag.data.id]
              })
            : { ok: false }
        const effort =
          tag.data && task.data
            ? await api.execution.createManualEffort({
                entityType: 'task',
                entityId: task.data.id,
                startedAt: '2026-07-30T01:00:00.000Z',
                endedAt: '2026-07-30T01:45:00.000Z',
                effectiveMinutes: 45,
                result: '完成协议分析',
                interruptions: '',
                obstacles: '',
                nextStep: '',
                energy: 4,
                perceivedDifficulty: 4,
                tagIds: [tag.data.id]
              })
            : { ok: false }
        const evidence =
          tag.data && task.data
            ? await api.execution.createEvidence({
                kind: 'note',
                title: '协议分析结果',
                note: '关键状态跳转已核对。',
                source: null,
                verificationStatus: 'verified',
                entityType: 'task',
                entityId: task.data.id,
                tagIds: [tag.data.id]
              })
            : { ok: false }

        const assignments: Result[] = []
        if (tag.data && project.data) {
          assignments.push(
            await api.planning.assignTag({
              tagId: tag.data.id,
              entityType: 'project',
              entityId: project.data.id
            })
          )
        }
        if (alias.data && project.data && task.data) {
          assignments.push(
            await api.planning.assignTag({
              tagId: alias.data.id,
              entityType: 'project',
              entityId: project.data.id
            }),
            await api.planning.assignTag({
              tagId: alias.data.id,
              entityType: 'task',
              entityId: task.data.id
            })
          )
        }
        return {
          workspace: workspace.ok,
          tag: tag.ok,
          alias: alias.ok,
          project: project.ok,
          task: task.ok,
          countdown: countdown.ok,
          memo: memo.ok,
          effort: effort.ok,
          evidence: evidence.ok,
          assignments: assignments.every((item) => item.ok),
          tagId: tag.data?.id,
          aliasId: alias.data?.id
        }
      },
      { rootPath: join(fixtureRoot, 'workspace') }
    )
    expect(setup).toMatchObject({
      workspace: true,
      tag: true,
      alias: true,
      project: true,
      task: true,
      countdown: true,
      memo: true,
      effort: true,
      evidence: true,
      assignments: true,
      tagId: expect.any(String),
      aliasId: expect.any(String)
    })
    await page.reload()

    await page.getByRole('button', { name: '标签', exact: true }).click()
    const mainTag = page
      .getByRole('article')
      .filter({ has: page.getByText('计算机网络', { exact: true }) })
    await mainTag.getByRole('button', { name: '查看统计' }).click()
    const stats = page.getByRole('region', { name: '标签聚合统计' })
    await expect(stats.getByText('6关联对象')).toBeVisible()
    await expect(stats.getByText('45投入分钟')).toBeVisible()
    await expect(stats.getByText('1完成任务')).toBeVisible()
    await expect(stats.getByText('1近期期限')).toBeVisible()
    await expect(stats.getByText('4级 1')).toBeVisible()
    for (const entityType of ['project', 'task', 'countdown', 'memo', 'effort', 'evidence']) {
      await expect(stats.getByText(`${entityType} 1`)).toBeVisible()
    }

    const aliasTag = page
      .getByRole('article')
      .filter({ has: page.getByText('网络课程', { exact: true }) })
    await aliasTag.getByRole('button', { name: '合并' }).click()
    await page.getByLabel('目标标签').selectOption(setup.tagId as string)
    await page.getByRole('button', { name: '合并标签' }).click()
    await expect(
      page
        .getByRole('article')
        .filter({ has: page.getByText('网络课程', { exact: true }) })
    ).toHaveCount(0)
    await expect(stats.getByText('6关联对象')).toBeVisible()

    const preserved = await page.evaluate(
      async ({ tagId, aliasId }) => {
        type Result<T> = { ok: boolean; data?: T }
        const api = (
          globalThis as unknown as {
            youtrace: {
              planning: {
                listTags(): Promise<Result<Array<{ id: string }>>>
                getTagStats(id: string): Promise<
                  Result<{ entityCounts: Record<string, number>; totalEffortMinutes: number }>
                >
                listProjects(): Promise<Result<unknown[]>>
                listTasks(input: Record<string, unknown>): Promise<Result<unknown[]>>
              }
              temporal: { listCountdowns(now: string): Promise<Result<unknown[]>> }
              execution: {
                listMemos(inboxOnly: boolean): Promise<Result<unknown[]>>
                listEfforts(input: Record<string, unknown>): Promise<Result<unknown[]>>
                listEvidence(entityType: null, entityId: null): Promise<Result<unknown[]>>
              }
            }
          }
        ).youtrace
        const [tags, statsResult, projects, tasks, countdowns, memos, efforts, evidence] =
          await Promise.all([
            api.planning.listTags(),
            api.planning.getTagStats(tagId),
            api.planning.listProjects(),
            api.planning.listTasks({
              projectId: null,
              statuses: [],
              tagIds: [],
              includeDeleted: false,
              limit: 100,
              offset: 0
            }),
            api.temporal.listCountdowns(new Date().toISOString()),
            api.execution.listMemos(false),
            api.execution.listEfforts({
              entityType: null,
              entityId: null,
              from: null,
              to: null,
              limit: 100,
              offset: 0
            }),
            api.execution.listEvidence(null, null)
          ])
        return {
          sourceArchived: !(tags.data ?? []).some((tag) => tag.id === aliasId),
          activeTarget: (tags.data ?? []).some((tag) => tag.id === tagId),
          counts: statsResult.data?.entityCounts,
          minutes: statsResult.data?.totalEffortMinutes,
          objectCounts: [
            projects.data?.length,
            tasks.data?.length,
            countdowns.data?.length,
            memos.data?.length,
            efforts.data?.length,
            evidence.data?.length
          ]
        }
      },
      { tagId: setup.tagId as string, aliasId: setup.aliasId as string }
    )
    expect(preserved).toEqual({
      sourceArchived: true,
      activeTarget: true,
      counts: {
        countdown: 1,
        effort: 1,
        evidence: 1,
        memo: 1,
        project: 1,
        task: 1
      },
      minutes: 45,
      objectCounts: [1, 1, 1, 1, 1, 1]
    })
  } finally {
    await electronApp.evaluate(({ app }) => app.exit(0)).catch(() => undefined)
  }
})
