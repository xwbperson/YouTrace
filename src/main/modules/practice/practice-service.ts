import { randomUUID } from 'node:crypto'
import type {
  Course,
  CreateLearningTestInput,
  CreateCourseInput,
  CreateHabitInput,
  CreateKnowledgeInput,
  CreateMetricInput,
  CreateMistakeInput,
  Habit,
  KnowledgeItem,
  LearningTest,
  Metric,
  Mistake,
  RecordHabitInput,
  RecordMetricInput,
  RecordReviewResultInput,
  ReviewQueueItem,
  UpdateCourseInput,
  UpdateHabitInput,
  UpdateKnowledgeInput,
  UpdateLearningTestInput,
  UpdateMetricInput,
  UpdateMistakeInput
} from '../../../shared/contracts'
import { YouTraceError } from '../../../shared/errors'
import type { PlanningRepository } from '../planning/planning-repository'
import { mapCourse, mapHabit, mapMetric, PracticeRepository } from './practice-repository'

export class PracticeService {
  constructor(
    private readonly repository: PracticeRepository,
    private readonly planningRepository: PlanningRepository
  ) {}

  listHabits(projectId: string | null, date: string): Habit[] {
    return this.repository
      .listHabits(projectId, date)
      .map((row) => mapHabit(row, calculateStreak(this.repository.getCompletedHabitDates(row.id), date)))
  }

  createHabit(input: CreateHabitInput): Habit {
    this.assertProject(input.projectId)
    const id = randomUUID()
    this.repository.insertHabit(id, input, new Date().toISOString())
    return this.requireHabit(id, input.startDate)
  }

  updateHabit(input: UpdateHabitInput): Habit {
    const current = this.repository.getHabit(input.id, new Date().toISOString().slice(0, 10))
    if (!current) throw notFound('习惯')
    const merged: CreateHabitInput = {
      projectId: input.projectId === undefined ? current.project_id : input.projectId,
      name: input.name ?? current.name,
      description: input.description ?? current.description,
      frequency: input.frequency ?? current.frequency,
      targetCount: input.targetCount ?? current.target_count,
      weekdays: input.weekdays ?? JSON.parse(current.weekdays_json) as number[],
      reminderTime: input.reminderTime === undefined ? current.reminder_time : input.reminderTime,
      startDate: input.startDate ?? current.start_date,
      endDate: input.endDate === undefined ? current.end_date : input.endDate
    }
    this.assertProject(merged.projectId)
    this.repository.updateHabit(input.id, merged, new Date().toISOString())
    return this.requireHabit(input.id, new Date().toISOString().slice(0, 10))
  }

  trashHabit(id: string): void {
    if (!this.repository.trashHabit(id, new Date().toISOString())) throw notFound('习惯')
  }

  recordHabit(input: RecordHabitInput): Habit {
    if (!this.repository.getHabit(input.habitId, input.date)) throw notFound('习惯')
    this.repository.recordHabit(randomUUID(), input, new Date().toISOString())
    return this.requireHabit(input.habitId, input.date)
  }

  listMetrics(projectId: string | null): Metric[] {
    return this.repository.listMetrics(projectId).map(mapMetric)
  }

  createMetric(input: CreateMetricInput): Metric {
    this.assertProject(input.projectId)
    const id = randomUUID()
    this.repository.insertMetric(id, input, new Date().toISOString())
    return this.requireMetric(id)
  }

  updateMetric(input: UpdateMetricInput): Metric {
    const current = this.repository.getMetric(input.id)
    if (!current) throw notFound('指标')
    const merged: CreateMetricInput = {
      projectId: input.projectId === undefined ? current.project_id : input.projectId,
      name: input.name ?? current.name,
      targetValue: input.targetValue ?? current.target_value,
      unit: input.unit ?? current.unit,
      direction: input.direction ?? current.direction,
      period: input.period ?? current.period
    }
    this.assertProject(merged.projectId)
    this.repository.updateMetric(input.id, merged, new Date().toISOString())
    return this.requireMetric(input.id)
  }

  trashMetric(id: string): void {
    if (!this.repository.trashMetric(id, new Date().toISOString())) throw notFound('指标')
  }

  recordMetric(input: RecordMetricInput): Metric {
    if (!this.repository.getMetric(input.metricId)) throw notFound('指标')
    this.repository.recordMetric(randomUUID(), input, new Date().toISOString())
    return this.requireMetric(input.metricId)
  }

  listCourses(): Course[] {
    return this.repository.listCourses().map(mapCourse)
  }

  createCourse(input: CreateCourseInput): Course {
    if (!this.planningRepository.getProject(input.projectId)) throw notFound('课程项目')
    const id = randomUUID()
    try {
      this.repository.insertCourse(id, randomUUID(), input, new Date().toISOString())
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
        throw new YouTraceError({
          code: 'COURSE_PROJECT_EXISTS',
          message: '这个项目已经建立了课程资料。'
        })
      }
      throw error
    }
    const course = this.repository.getCourse(id)
    if (!course) throw notFound('课程')
    return mapCourse(course)
  }

  updateCourse(input: UpdateCourseInput): Course {
    const currentRow = this.repository.getCourse(input.id)
    if (!currentRow) throw notFound('课程')
    const current = mapCourse(currentRow)
    const merged: CreateCourseInput = {
      projectId: input.projectId ?? current.projectId,
      courseName: input.courseName ?? current.courseName,
      examDate: input.examDate === undefined ? current.examDate : input.examDate,
      textbook: input.textbook ?? current.textbook ?? {
        title: '未命名教材', author: '', edition: '', isbn: '', publisher: ''
      }
    }
    if (!this.planningRepository.getProject(merged.projectId)) throw notFound('课程项目')
    try {
      this.repository.updateCourse(input.id, merged, new Date().toISOString())
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
        throw new YouTraceError({ code: 'COURSE_PROJECT_EXISTS', message: '这个项目已经建立了课程资料。' })
      }
      throw error
    }
    return mapCourse(this.repository.getCourse(input.id)!)
  }

  trashCourse(id: string): void {
    if (!this.repository.trashCourse(id, new Date().toISOString())) throw notFound('课程')
  }

  listKnowledge(projectId: string): KnowledgeItem[] {
    return this.repository.listKnowledge(projectId)
  }

  createKnowledge(input: CreateKnowledgeInput): KnowledgeItem {
    if (!this.planningRepository.getProject(input.projectId)) throw notFound('课程项目')
    const id = randomUUID()
    this.repository.insertKnowledge(id, input, new Date().toISOString())
    const item = this.repository.getKnowledge(id)
    if (!item) throw notFound('知识点')
    return item
  }

  updateKnowledge(input: UpdateKnowledgeInput): KnowledgeItem {
    const current = this.repository.getKnowledge(input.id)
    if (!current) throw notFound('知识点')
    const merged: CreateKnowledgeInput = {
      projectId: input.projectId ?? current.projectId,
      milestoneId: input.milestoneId === undefined ? current.milestoneId : input.milestoneId,
      title: input.title ?? current.title,
      content: input.content ?? current.content,
      mastery: input.mastery === undefined ? current.mastery : input.mastery,
      nextReviewDate: input.nextReviewDate === undefined ? current.nextReviewDate : input.nextReviewDate
    }
    this.repository.updateKnowledge(input.id, merged, new Date().toISOString())
    return this.repository.getKnowledge(input.id)!
  }

  trashKnowledge(id: string): void {
    if (!this.repository.trashKnowledge(id, new Date().toISOString())) throw notFound('知识点')
  }

  listMistakes(projectId: string): Mistake[] {
    return this.repository.listMistakes(projectId)
  }

  createMistake(input: CreateMistakeInput): Mistake {
    if (!this.planningRepository.getProject(input.projectId)) throw notFound('课程项目')
    const id = randomUUID()
    this.repository.insertMistake(id, input, new Date().toISOString())
    const item = this.repository.getMistake(id)
    if (!item) throw notFound('错题')
    return item
  }

  updateMistake(input: UpdateMistakeInput): Mistake {
    const current = this.repository.getMistake(input.id)
    if (!current) throw notFound('错题')
    const merged: CreateMistakeInput = {
      projectId: input.projectId ?? current.projectId,
      knowledgeItemId: input.knowledgeItemId === undefined ? current.knowledgeItemId : input.knowledgeItemId,
      question: input.question ?? current.question,
      wrongAnswer: input.wrongAnswer ?? current.wrongAnswer,
      correctAnswer: input.correctAnswer ?? current.correctAnswer,
      analysis: input.analysis ?? current.analysis,
      mastery: input.mastery === undefined ? current.mastery : input.mastery,
      nextReviewDate: input.nextReviewDate === undefined ? current.nextReviewDate : input.nextReviewDate
    }
    this.repository.updateMistake(input.id, merged, new Date().toISOString())
    return this.repository.getMistake(input.id)!
  }

  trashMistake(id: string): void {
    if (!this.repository.trashMistake(id, new Date().toISOString())) throw notFound('错题')
  }

  listLearningTests(projectId: string): LearningTest[] {
    return this.repository.listLearningTests(projectId)
  }

  createLearningTest(input: CreateLearningTestInput): LearningTest {
    if (!this.planningRepository.getProject(input.projectId)) throw notFound('课程项目')
    const id = randomUUID()
    this.repository.insertLearningTest(id, input, new Date().toISOString())
    const test = this.repository.getLearningTest(id)
    if (!test) throw notFound('学习测试')
    return test
  }

  updateLearningTest(input: UpdateLearningTestInput): LearningTest {
    const current = this.repository.getLearningTest(input.id)
    if (!current) throw notFound('学习测试')
    const merged: CreateLearningTestInput = {
      projectId: input.projectId ?? current.projectId,
      milestoneId: input.milestoneId === undefined ? current.milestoneId : input.milestoneId,
      title: input.title ?? current.title,
      score: input.score === undefined ? current.score : input.score,
      maxScore: input.maxScore === undefined ? current.maxScore : input.maxScore,
      testedAt: input.testedAt ?? current.testedAt,
      note: input.note ?? current.note
    }
    if (merged.score !== null && merged.maxScore !== null && merged.score > merged.maxScore) {
      throw new YouTraceError({ code: 'INVALID_TEST_SCORE', message: '成绩不能超过满分。' })
    }
    this.repository.updateLearningTest(input.id, merged, new Date().toISOString())
    return this.repository.getLearningTest(input.id)!
  }

  trashLearningTest(id: string): void {
    if (!this.repository.trashLearningTest(id, new Date().toISOString())) throw notFound('学习测试')
  }

  listReviewQueue(projectId: string): ReviewQueueItem[] {
    return this.repository.listReviewQueue(projectId)
  }

  recordReviewResult(input: RecordReviewResultInput): ReviewQueueItem {
    const item = this.repository.getReviewQueueItem(input.queueId)
    if (!item || item.status !== 'pending') throw notFound('待复习项目')
    const policy = {
      again: { days: 1, mastery: 25 },
      hard: { days: 3, mastery: 50 },
      good: { days: 7, mastery: 75 },
      easy: { days: 14, mastery: 90 }
    }[input.result]
    const next = new Date(input.reviewedAt)
    next.setUTCDate(next.getUTCDate() + policy.days)
    const nextDate = next.toISOString().slice(0, 10)
    this.repository.recordReviewResult(
      item,
      input,
      nextDate,
      policy.mastery,
      new Date().toISOString()
    )
    return this.repository
      .listReviewQueue(item.projectId)
      .find(
        (candidate) =>
          candidate.entityType === item.entityType &&
          candidate.entityId === item.entityId &&
          candidate.scheduledDate === nextDate &&
          candidate.status === 'pending'
      )!
  }

  private requireHabit(id: string, date: string): Habit {
    const row = this.repository.getHabit(id, date)
    if (!row) throw notFound('习惯')
    return mapHabit(row, calculateStreak(this.repository.getCompletedHabitDates(id), date))
  }

  private requireMetric(id: string): Metric {
    const row = this.repository.getMetric(id)
    if (!row) throw notFound('指标')
    return mapMetric(row)
  }

  private assertProject(projectId: string | null): void {
    if (projectId && !this.planningRepository.getProject(projectId)) throw notFound('项目')
  }
}

function calculateStreak(completedDates: string[], referenceDate: string): number {
  const completed = new Set(completedDates)
  const cursor = new Date(`${referenceDate}T12:00:00Z`)
  let streak = 0
  while (completed.has(cursor.toISOString().slice(0, 10))) {
    streak += 1
    cursor.setUTCDate(cursor.getUTCDate() - 1)
  }
  return streak
}

function notFound(label: string): YouTraceError {
  return new YouTraceError({
    code: 'ENTITY_NOT_FOUND',
    message: `${label}不存在或已进入回收站。`
  })
}
