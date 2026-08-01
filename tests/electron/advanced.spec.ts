import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

test('connects advanced planning, saved search, learning and preferences in Electron', async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'youtrace-advanced-e2e-'))
  const environment = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)
  )
  const electronApp = await electron.launch({
    args: ['.', `--user-data-dir=${join(fixtureRoot, 'app-data')}`],
    env: { ...environment, NODE_ENV: 'production' }
  })

  try {
    const page = await electronApp.firstWindow()
    const setup = await page.evaluate(async ({ rootPath }) => {
      const api = (globalThis as unknown as { youtrace: any }).youtrace
      const workspace = await api.workspace.create({ rootPath, name: '高级闭环工作区' })
      if (!workspace.ok) return { ok: false }
      const tag = await api.planning.createTag({
        name: '网络课程',
        color: '#216E65',
        icon: 'book-open',
        description: '课程闭环',
        favorite: true
      })
      const project = await api.planning.createProject({
        areaId: null,
        name: '计算机网络进阶',
        description: '验证高级规划和学习闭环',
        status: 'active',
        startDate: '2026-07-30',
        targetDate: '2026-09-01',
        successCriteria: '完成测试并形成证据',
        progressMode: 'equal'
      })
      const goal = await api.planning.createGoal({
        projectId: project.data.id,
        title: '掌握协议分析',
        successCriteria: '测试达到 85 分',
        targetDate: '2026-09-01',
        measureType: 'milestone',
        status: 'active'
      })
      const milestone = await api.planning.createMilestone({
        projectId: project.data.id,
        goalId: goal.data.id,
        title: '第一章 网络体系结构',
        description: '完成阅读、习题和测试',
        plannedDate: '2026-08-05',
        estimatedMinutes: 180,
        manualWeight: 2,
        importanceRating: 4.5,
        mastery: 75,
        verificationCriteria: '完成章节测试',
        status: 'in_progress',
        includeInProgress: true
      })
      const task = await api.planning.createTask({
        parentTaskId: null,
        projectId: project.data.id,
        goalId: goal.data.id,
        milestoneId: milestone.data.id,
        title: '梳理协议分层与封装',
        description: '连续中文搜索：认证失败与协议状态机',
        status: 'ready',
        difficulty: 4,
        priority: 'high',
        estimatedMinutes: 60,
        progressWeight: 2,
        startDate: '2026-07-30',
        dueAt: '2026-08-01T12:00:00.000Z',
        verificationCriteria: '输出一页结构图',
        includeInProgress: true,
        tagIds: [tag.data.id]
      })
      await api.planning.createChecklistItem({ taskId: task.data.id, text: '画出五层结构' })
      await api.planning.setChecklistProgress({ taskId: task.data.id, enabled: true })
      await api.planning.setTaskRecurrence({
        taskId: task.data.id,
        rule: {
          frequency: 'weekly',
          intervalValue: 1,
          weekdays: [1],
          nextOccurrence: '2026-08-03'
        }
      })
      const course = await api.practice.createCourse({
        projectId: project.data.id,
        courseName: '计算机网络',
        examDate: '2026-09-01',
        textbook: {
          title: '计算机网络：自顶向下方法',
          author: 'Kurose',
          edition: '8',
          isbn: '',
          publisher: ''
        }
      })
      await api.practice.createKnowledge({
        projectId: project.data.id,
        milestoneId: milestone.data.id,
        title: '协议分层',
        content: '服务、接口与协议',
        mastery: 75,
        nextReviewDate: '2026-08-02'
      })
      await api.practice.createLearningTest({
        projectId: project.data.id,
        milestoneId: milestone.data.id,
        title: '第一章测试',
        score: 86,
        maxScore: 100,
        testedAt: '2026-07-30T12:00:00.000Z',
        note: '已完成'
      })
      return { ok: course.ok, taskId: task.data.id }
    }, { rootPath: join(fixtureRoot, 'workspace') })
    expect(setup.ok).toBe(true)
    await page.reload()

    await page.getByRole('button', { name: '计划', exact: true }).click()
    await expect(
      page.locator('.goal-section').getByText('掌握协议分析', { exact: true })
    ).toBeVisible()
    await expect(
      page.locator('.milestone-section').getByText('第一章 网络体系结构', { exact: true })
    ).toBeVisible()
    await page.getByRole('button', { name: /梳理协议分层与封装/ }).click()
    await expect(page.getByText('检查清单', { exact: true })).toBeVisible()
    await expect(page.getByText('画出五层结构')).toBeVisible()
    await expect(page.getByText('周期实例', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '关闭' }).click()

    await page.keyboard.press('Control+K')
    await page.getByLabel('搜索目标、任务和记录').fill('认证失败')
    await expect(page.getByRole('button', { name: /梳理协议分层与封装/ })).toBeVisible()
    await page.getByLabel('筛选项目').selectOption({ label: '计算机网络进阶' })
    await page.getByLabel('筛选难度').selectOption('4')
    await page.getByLabel('视图名称').fill('网络课程高难度')
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.getByRole('button', { name: '网络课程高难度', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '关闭' }).click()

    await page.getByRole('button', { name: '计划', exact: true }).click()
    await page.getByRole('tab', { name: '实践与学习' }).click()
    await page.getByRole('tab', { name: '课程学习' }).click()
    await expect(page.getByText('计算机网络：自顶向下方法')).toBeVisible()
    await expect(page.getByText('第一章测试')).toBeVisible()
    await expect(page.getByText('复习队列')).toBeVisible()

    await page.getByRole('button', { name: '设置', exact: true }).click()
    await page.getByLabel('主题').selectOption('dark')
    await page.getByRole('button', { name: '保存全部设置' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await page.screenshot({ path: 'test-results/advanced-workspace.png' })
  } finally {
    await electronApp.evaluate(({ app }) => app.exit(0)).catch(() => undefined)
  }
})
