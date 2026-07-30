import { writeFile } from 'node:fs/promises'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

function localDate(value: Date): string {
  const offset = value.getTimezoneOffset() * 60_000
  return new Date(value.getTime() - offset).toISOString().slice(0, 10)
}

test('completes the course learning loop and preserves it across an explicit quit and reopen', async () => {
  test.setTimeout(60_000)
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'youtrace-course-loop-e2e-'))
  const userDataPath = join(fixtureRoot, 'app-data')
  const workspacePath = join(fixtureRoot, 'workspace')
  const evidencePath = join(fixtureRoot, 'chapter-note.txt')
  await writeFile(evidencePath, 'chapter 1 verified notes', 'utf8')
  const today = localDate(new Date())
  const examDateValue = new Date()
  examDateValue.setDate(examDateValue.getDate() + 30)
  const examDate = localDate(examDateValue)
  const environment = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => entry[1] !== undefined
      )
    ),
    NODE_ENV: 'production',
    YOUTRACE_E2E: '1'
  }
  const launchArgs = ['.', `--user-data-dir=${userDataPath}`]
  let electronApp = await electron.launch({ args: launchArgs, env: environment })

  try {
    let page = await electronApp.firstWindow()
    const setup = await page.evaluate(
      async ({ rootPath, today, examDate }) => {
        const api = (globalThis as unknown as { youtrace: any }).youtrace
        const workspace = await api.workspace.create({ rootPath, name: '课程闭环验收' })
        if (!workspace.ok) return { ok: false, stage: 'workspace' }
        const tag = await api.planning.createTag({
          name: '计算机网络',
          color: '#216E65',
          icon: 'book-open',
          description: '课程学习闭环'
        })
        const applied = await api.workflow.applyTemplate({
          templateId: 'builtin:course',
          projectName: '计算机网络课程'
        })
        if (!tag.ok || !applied.ok) return { ok: false, stage: 'template' }
        const projectId = applied.data.project.id as string
        await api.planning.updateProject({
          id: projectId,
          description: '按官方教材完成五章学习闭环',
          targetDate: examDate,
          successCriteria: '完成章节测试并形成可验证证据',
          progressMode: 'equal'
        })
        await api.planning.assignTag({
          tagId: tag.data.id,
          entityType: 'project',
          entityId: projectId
        })

        const weights = [1, 2, 7, 3, 4]
        for (let chapter = 0; chapter < applied.data.milestoneIds.length; chapter += 1) {
          await api.planning.updateMilestone({
            id: applied.data.milestoneIds[chapter],
            title: `第 ${chapter + 1} 章`,
            manualWeight: weights[chapter],
            mastery: chapter === 0 ? 72 : null,
            status: chapter === 0 ? 'in_progress' : 'not_started'
          })
        }

        const taskTypes = ['阅读', '笔记', '习题', '测试', '复盘']
        const difficulties = [2, 3, 4, 5, 3]
        const estimates = [60, 90, 75, 45, 30]
        const priorities = ['medium', 'medium', 'high', 'critical', 'high']
        const updatedTasks: Array<{ id: string; title: string }> = []
        for (let index = 0; index < applied.data.taskIds.length; index += 1) {
          const chapter = Math.floor(index / 5)
          const type = index % 5
          const title = `第 ${chapter + 1} 章：${taskTypes[type]}`
          const isCompletedFirstChapterTask = chapter === 0 && type < 4
          const isTimerTask = chapter === 0 && type === 4
          const result = await api.planning.updateTask({
            id: applied.data.taskIds[index],
            title,
            status: isCompletedFirstChapterTask ? 'completed' : 'ready',
            difficulty: difficulties[type],
            priority: priorities[type],
            estimatedMinutes: estimates[type],
            startDate: isTimerTask ? today : null,
            dueAt: isTimerTask ? `${today}T12:00:00.000Z` : null,
            tagIds: [tag.data.id]
          })
          if (result.ok) updatedTasks.push({ id: result.data.id, title: result.data.title })
        }
        const timerTask = updatedTasks.find((task) => task.title === '第 1 章：复盘')
        if (!timerTask) return { ok: false, stage: 'tasks' }

        const course = await api.practice.createCourse({
          projectId,
          courseName: '计算机网络',
          examDate,
          textbook: {
            title: '计算机网络：自顶向下方法（第 8 版）',
            author: 'James F. Kurose / Keith W. Ross',
            edition: '第 8 版',
            isbn: '9787111599715',
            publisher: '机械工业出版社'
          }
        })
        const countdown = await api.temporal.createCountdown({
          title: '计算机网络考试',
          targetAt: `${examDate}T01:00:00.000Z`,
          timezone: 'Asia/Shanghai',
          workingDays: [1, 2, 3, 4, 5],
          bufferDays: 2,
          importance: 'critical',
          entityType: 'task',
          entityId: timerTask.id,
          remainingMinutes: 900,
          tagIds: [tag.data.id]
        })
        return {
          ok: course.ok && countdown.ok && updatedTasks.length === 25,
          projectId,
          timerTaskId: timerTask.id,
          tagId: tag.data.id,
          milestoneIds: applied.data.milestoneIds,
          courseId: course.data?.id
        }
      },
      { rootPath: workspacePath, today, examDate }
    )
    expect(setup).toMatchObject({
      ok: true,
      projectId: expect.any(String),
      timerTaskId: expect.any(String),
      tagId: expect.any(String),
      milestoneIds: expect.any(Array),
      courseId: expect.any(String)
    })
    await page.reload()

    await page.getByRole('button', { name: '今日', exact: true }).click()
    const timerTask = page.getByRole('article').filter({ hasText: '第 1 章：复盘' })
    await expect(timerTask).toBeVisible()
    await timerTask.getByRole('button', { name: '开始', exact: true }).click()
    await expect(page.getByText('正在投入')).toBeVisible()
    await page.getByRole('button', { name: '停止并记录' }).click()
    await page.getByLabel('实际结果').fill('完成第一章复盘笔记')
    await page.getByLabel('困难').fill('运输层概念需要再次核对')
    await page.getByLabel('下一步').fill('进入第二章阅读')
    await page.getByRole('button', { name: '保存并停止' }).click()
    await timerTask
      .getByRole('button', { name: '完成任务：第 1 章：复盘' })
      .click()
    await expect(timerTask).toHaveCount(0)

    await page.getByRole('button', { name: /备忘/ }).click()
    await page.getByLabel('快速记录').fill('第一章复盘：区分协议提供的服务与协议本身。')
    await page.getByLabel('关联项目').selectOption(setup.projectId as string)
    await page
      .getByLabel('备忘标签')
      .getByRole('button', { name: '计算机网络', exact: true })
      .click()
    await page.getByRole('button', { name: '保存到收件箱' }).click()
    await expect(page.getByText('第一章复盘：区分协议提供的服务与协议本身。')).toBeVisible()

    await page.getByRole('button', { name: '记录', exact: true }).click()
    await page.getByRole('button', { name: '添加成果' }).click()
    await page.getByLabel('证据类型').selectOption('file')
    await page.getByLabel('关联任务').selectOption(setup.timerTaskId as string)
    await page.getByLabel('标题').fill('第一章复盘文件')
    await page.getByLabel('说明').fill('章节复盘笔记原文件')
    await page.getByLabel('选择成果附件').setInputFiles(evidencePath)
    await page.getByRole('button', { name: '上传并保存证据' }).click()
    await page.getByRole('button', { name: '成果证据', exact: true }).click()
    await expect(page.getByText('第一章复盘文件')).toBeVisible()

    await page.getByRole('button', { name: '计划', exact: true }).click()
    await page.getByRole('tab', { name: '实践与学习' }).click()
    await page.getByRole('tab', { name: '课程学习' }).click()
    await expect(page.getByText('计算机网络：自顶向下方法（第 8 版）')).toBeVisible()

    await page.getByRole('button', { name: '知识点' }).click()
    await page.getByLabel('知识点标题').fill('协议与服务')
    await page.getByLabel('内容').fill('协议定义对等实体通信规则，服务描述层间能力。')
    await page.getByLabel('掌握度（0–100）').fill('72')
    await page.getByRole('button', { name: '添加知识点' }).click()
    await expect(page.getByText('掌握度 72%')).toBeVisible()

    await page.getByRole('button', { name: '测试', exact: true }).click()
    await page.getByLabel('测试名称').fill('第一章章节测试')
    await page.getByLabel('成绩').fill('82')
    await page.getByLabel('满分').fill('100')
    await page.getByLabel('说明').fill('执行进度已完成，掌握度仍需提升')
    await page.getByRole('button', { name: '记录测试' }).click()
    await expect(page.getByText('第一章章节测试')).toBeVisible()
    await expect(page.getByText('82 / 100')).toBeVisible()

    await page.getByRole('tab', { name: '项目任务' }).click()
    await expect(page.locator('.milestone-track').getByRole('article')).toHaveCount(5)
    await expect(page.locator('.task-list').getByRole('article')).toHaveCount(25)
    await expect(page.locator('.project-facts')).toContainText('5 / 25')
    await expect(page.locator('.project-facts')).toContainText('72%')
    await expect(page.locator('.project-progress-summary')).toContainText('等权 20% · 工作量 6%')

    const beforeModeSwitch = await page.evaluate(async (projectId) => {
      const api = (globalThis as unknown as { youtrace: any }).youtrace
      const [projects, milestones, tasks] = await Promise.all([
        api.planning.listProjects(),
        api.planning.listMilestones(projectId),
        api.planning.listTasks({
          projectId,
          statuses: [],
          tagIds: [],
          includeDeleted: false,
          limit: 100,
          offset: 0
        })
      ])
      const project = projects.data.find((item: { id: string }) => item.id === projectId)
      return {
        equalProgress: project.equalProgress,
        workloadProgress: project.workloadProgress,
        progressMode: project.progressMode,
        milestones: milestones.data.map((item: any) => ({
          id: item.id,
          manualWeight: item.manualWeight,
          mastery: item.mastery,
          status: item.status
        })),
        tasks: tasks.data.map((item: any) => ({
          id: item.id,
          status: item.status,
          difficulty: item.difficulty,
          priority: item.priority,
          estimatedMinutes: item.estimatedMinutes,
          tagIds: item.tagIds
        }))
      }
    }, setup.projectId as string)
    expect(beforeModeSwitch).toMatchObject({
      equalProgress: 0.2,
      progressMode: 'equal'
    })
    expect(beforeModeSwitch.workloadProgress).toBeCloseTo(1 / 17)

    await page.getByLabel('主进度模式').selectOption('workload')
    await expect(page.locator('.project-progress-summary > strong')).toHaveText('6%')

    const afterModeSwitch = await page.evaluate(async (projectId) => {
      const api = (globalThis as unknown as { youtrace: any }).youtrace
      const [projects, milestones, tasks] = await Promise.all([
        api.planning.listProjects(),
        api.planning.listMilestones(projectId),
        api.planning.listTasks({
          projectId,
          statuses: [],
          tagIds: [],
          includeDeleted: false,
          limit: 100,
          offset: 0
        })
      ])
      const project = projects.data.find((item: { id: string }) => item.id === projectId)
      return {
        equalProgress: project.equalProgress,
        workloadProgress: project.workloadProgress,
        progressMode: project.progressMode,
        milestones: milestones.data.map((item: any) => ({
          id: item.id,
          manualWeight: item.manualWeight,
          mastery: item.mastery,
          status: item.status
        })),
        tasks: tasks.data.map((item: any) => ({
          id: item.id,
          status: item.status,
          difficulty: item.difficulty,
          priority: item.priority,
          estimatedMinutes: item.estimatedMinutes,
          tagIds: item.tagIds
        }))
      }
    }, setup.projectId as string)
    expect(afterModeSwitch).toEqual({
      ...beforeModeSwitch,
      progressMode: 'workload'
    })

    await page.getByRole('button', { name: '日历', exact: true }).click()
    await page.getByRole('tab', { name: '倒计时' }).click()
    const countdown = page.getByRole('article').filter({ hasText: '计算机网络考试' })
    await expect(countdown).toBeVisible()
    await expect(countdown.getByText(/建议 \d+ 分钟\/日/)).toBeVisible()

    const closePromise = electronApp.waitForEvent('close')
    await electronApp
      .evaluate(async ({ dialog }) => {
        ;(dialog.showMessageBox as unknown as (...args: unknown[]) => unknown) = async () => ({
          response: 0,
          checkboxChecked: false
        })
        const hooks = (
          globalThis as unknown as {
            __youtraceE2E?: { requestApplicationQuit(): Promise<void> }
          }
        ).__youtraceE2E
        if (!hooks) throw new Error('E2E quit hook is unavailable')
        await hooks.requestApplicationQuit()
      })
      .catch(() => undefined)
    await closePromise

    electronApp = await electron.launch({ args: launchArgs, env: environment })
    page = await electronApp.firstWindow()
    await expect(page.getByRole('banner').getByText('课程闭环验收')).toBeVisible()
    const reopened = await page.evaluate(
      async ({ projectId, timerTaskId }) => {
        const api = (globalThis as unknown as { youtrace: any }).youtrace
        const [projects, milestones, tasks, courses, tests, evidence, memos, countdowns, efforts] =
          await Promise.all([
            api.planning.listProjects(),
            api.planning.listMilestones(projectId),
            api.planning.listTasks({
              projectId,
              statuses: [],
              tagIds: [],
              includeDeleted: false,
              limit: 100,
              offset: 0
            }),
            api.practice.listCourses(),
            api.practice.listLearningTests(projectId),
            api.execution.listEvidence('task', timerTaskId),
            api.execution.listMemos(false),
            api.temporal.listCountdowns(new Date().toISOString()),
            api.execution.listEfforts({
              entityType: 'task',
              entityId: timerTaskId,
              from: null,
              to: null,
              limit: 100,
              offset: 0
            })
          ])
        const project = projects.data.find((item: { id: string }) => item.id === projectId)
        return {
          project: {
            progressMode: project.progressMode,
            equalProgress: project.equalProgress,
            workloadProgress: project.workloadProgress,
            masteryAverage: project.masteryAverage,
            masteryAssessed: project.masteryAssessed,
            masteryTotal: project.masteryTotal
          },
          milestoneCount: milestones.data.length,
          taskCount: tasks.data.length,
          completedCount: tasks.data.filter((item: { status: string }) => item.status === 'completed')
            .length,
          textbook: courses.data[0]?.textbook,
          learningTest: tests.data[0],
          evidence: evidence.data[0],
          memoBody: memos.data[0]?.body,
          countdown: countdowns.data[0],
          effort: efforts.data[0]
        }
      },
      { projectId: setup.projectId as string, timerTaskId: setup.timerTaskId as string }
    )
    expect(reopened).toMatchObject({
      project: {
        progressMode: 'workload',
        equalProgress: 0.2,
        masteryAverage: 72,
        masteryAssessed: 1,
        masteryTotal: 5
      },
      milestoneCount: 5,
      taskCount: 25,
      completedCount: 5,
      textbook: {
        title: '计算机网络：自顶向下方法（第 8 版）',
        author: 'James F. Kurose / Keith W. Ross',
        edition: '第 8 版',
        isbn: '9787111599715',
        publisher: '机械工业出版社'
      },
      learningTest: {
        title: '第一章章节测试',
        score: 82,
        maxScore: 100
      },
      evidence: {
        kind: 'file',
        title: '第一章复盘文件',
        source: 'chapter-note.txt'
      },
      memoBody: '第一章复盘：区分协议提供的服务与协议本身。',
      countdown: {
        title: '计算机网络考试',
        remainingMinutes: 900
      },
      effort: {
        entityId: setup.timerTaskId,
        source: 'timer',
        result: '完成第一章复盘笔记'
      }
    })
    expect(reopened.project.workloadProgress).toBeCloseTo(1 / 17)
  } finally {
    await electronApp.evaluate(({ app }) => app.exit(0)).catch(() => undefined)
  }
})
