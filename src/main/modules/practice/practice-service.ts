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
  ReviewQueueItem
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
