import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PlanningRepository } from '../../src/main/modules/planning/planning-repository'
import { PlanningService } from '../../src/main/modules/planning/planning-service'
import { PracticeRepository } from '../../src/main/modules/practice/practice-repository'
import { PracticeService } from '../../src/main/modules/practice/practice-service'
import { WorkspaceManager } from '../../src/main/workspace/workspace-manager'

let workspaceManager: WorkspaceManager
let planning: PlanningService
let practice: PracticeService

beforeEach(async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'youtrace-practice-test-'))
  workspaceManager = new WorkspaceManager(join(fixtureRoot, 'app-data'))
  await workspaceManager.create(join(fixtureRoot, 'workspace'), '实践测试')
  const planningRepository = new PlanningRepository(() => workspaceManager.getDatabase())
  planning = new PlanningService(planningRepository)
  practice = new PracticeService(
    new PracticeRepository(() => workspaceManager.getDatabase()),
    planningRepository
  )
})

afterEach(async () => {
  await workspaceManager.close()
})

describe('habit, metric and course practice service', () => {
  it('records streaks and cumulative metrics without turning them into task completion', () => {
    const habit = practice.createHabit({
      projectId: null,
      name: '每日复盘',
      description: '写下今天的一个事实',
      frequency: 'daily',
      targetCount: 1,
      weekdays: [],
      reminderTime: '21:00',
      startDate: '2026-07-28',
      endDate: null
    })

    practice.recordHabit({
      habitId: habit.id,
      date: '2026-07-28',
      status: 'completed',
      skipReason: null
    })
    practice.recordHabit({
      habitId: habit.id,
      date: '2026-07-29',
      status: 'completed',
      skipReason: null
    })
    const recorded = practice.recordHabit({
      habitId: habit.id,
      date: '2026-07-30',
      status: 'completed',
      skipReason: null
    })
    expect(recorded).toMatchObject({
      todayStatus: 'completed',
      currentStreak: 3,
      totalCompleted: 3
    })
    expect(practice.clearHabitRecord(habit.id, '2026-07-30')).toMatchObject({
      todayStatus: null,
      currentStreak: 0,
      totalCompleted: 2
    })

    const metric = practice.createMetric({
      projectId: null,
      name: '累计跑量',
      targetValue: 100,
      unit: '公里',
      direction: 'increase',
      period: 'total'
    })
    practice.recordMetric({
      metricId: metric.id,
      value: 5,
      recordedAt: '2026-07-29T02:00:00.000Z',
      note: '晨跑'
    })
    const current = practice.recordMetric({
      metricId: metric.id,
      value: 7,
      recordedAt: '2026-07-30T02:00:00.000Z',
      note: '节奏跑'
    })
    expect(current).toMatchObject({ currentValue: 12, entryCount: 2 })
    const entries = practice.listMetricEntries(metric.id)
    expect(entries).toHaveLength(2)
    const corrected = practice.updateMetricEntry({
      id: entries[0]!.id,
      value: 6,
      recordedAt: entries[0]!.recordedAt,
      note: '晨跑，修正里程'
    })
    expect(corrected).toMatchObject({ value: 6, note: '晨跑，修正里程' })
    expect(practice.listMetrics(null)[0]).toMatchObject({ currentValue: 11, entryCount: 2 })
    practice.deleteMetricEntry(entries[1]!.id)
    expect(practice.listMetrics(null)[0]).toMatchObject({ currentValue: 6, entryCount: 1 })
  })

  it('connects course materials, knowledge, mistakes, review queue and search', () => {
    const project = planning.createProject({
      areaId: null,
      name: '计算机网络课程',
      description: '',
      status: 'active',
      startDate: '2026-07-30',
      targetDate: '2026-12-20',
      successCriteria: '通过课程考试',
      progressMode: 'equal'
    })
    const course = practice.createCourse({
      projectId: project.id,
      courseName: '计算机网络',
      examDate: '2026-12-20',
      textbook: {
        title: '计算机网络：自顶向下方法',
        author: 'Kurose',
        edition: '第8版',
        isbn: '',
        publisher: ''
      }
    })
    const knowledge = practice.createKnowledge({
      projectId: project.id,
      milestoneId: null,
      title: '分层体系结构',
      content: '应用层、运输层、网络层、链路层。',
      mastery: 60,
      nextReviewDate: '2026-08-01'
    })
    practice.createMistake({
      projectId: project.id,
      knowledgeItemId: null,
      question: '可靠传输由哪一层负责？',
      wrongAnswer: '网络层',
      correctAnswer: '运输层',
      analysis: '混淆了端到端可靠性和分组转发。',
      mastery: 30,
      nextReviewDate: '2026-08-01'
    })
    const learningTest = practice.createLearningTest({
      projectId: project.id,
      milestoneId: null,
      title: '第一章测试',
      score: 82,
      maxScore: 100,
      testedAt: '2026-08-01T02:00:00.000Z',
      note: '运输层概念仍需复习'
    })
    expect(practice.listLearningTests(project.id)).toMatchObject([
      { id: learningTest.id, score: 82, maxScore: 100 }
    ])
    const queue = practice.listReviewQueue(project.id)
    const knowledgeReview = queue.find(
      (item) => item.entityType === 'knowledge' && item.entityId === knowledge.id
    )!
    const nextReview = practice.recordReviewResult({
      queueId: knowledgeReview.id,
      result: 'good',
      reviewedAt: '2026-08-01T03:00:00.000Z'
    })
    expect(nextReview).toMatchObject({
      entityId: knowledge.id,
      scheduledDate: '2026-08-08',
      status: 'pending'
    })
    expect(practice.listKnowledge(project.id)[0]).toMatchObject({
      mastery: 75,
      nextReviewDate: '2026-08-08'
    })

    expect(practice.listCourses()[0]).toMatchObject({
      id: course.id,
      knowledgeCount: 1,
      mistakeCount: 1,
      pendingReviewCount: 2
    })
    expect(practice.listKnowledge(project.id)).toHaveLength(1)
    expect(practice.listMistakes(project.id)).toHaveLength(1)
    expect(
      planning.search({ query: '分层体系', entityTypes: ['knowledge'], limit: 20 })[0]
    ).toMatchObject({ entityType: 'knowledge', title: '分层体系结构' })
  })

  it('keeps multiple material entries under one course and preserves the primary textbook', () => {
    const project = planning.createProject({
      areaId: null,
      name: '密码学课程',
      description: '',
      status: 'active',
      startDate: null,
      targetDate: null,
      successCriteria: '',
      progressMode: 'equal'
    })
    const course = practice.createCourse({
      projectId: project.id,
      courseName: '现代密码学',
      examDate: null,
      textbook: {
        title: '现代密码学教程',
        author: 'Alice',
        edition: '第 2 版',
        isbn: '',
        publisher: ''
      }
    })

    const notes = practice.createCourseMaterial({
      courseId: course.id,
      materialType: 'notes',
      title: '课堂笔记',
      author: '我',
      edition: '',
      isbn: '',
      publisher: '',
      description: '按章节整理的课堂记录'
    })
    const paper = practice.createCourseMaterial({
      courseId: course.id,
      materialType: 'paper',
      title: '课程论文原文',
      author: 'Bob',
      edition: '',
      isbn: '',
      publisher: '',
      description: '扩展阅读'
    })
    const updated = practice.updateCourseMaterial({
      id: notes.id,
      description: '已按里程碑整理'
    })

    expect(updated.description).toBe('已按里程碑整理')
    expect(practice.listCourseMaterials(course.id)).toMatchObject([
      { title: '现代密码学教程', materialType: 'textbook' },
      { id: notes.id, title: '课堂笔记', materialType: 'notes' },
      { id: paper.id, title: '课程论文原文', materialType: 'paper' }
    ])
    expect(practice.listCourses()[0]).toMatchObject({
      id: course.id,
      materialCount: 3,
      textbook: { title: '现代密码学教程' }
    })
  })
})
