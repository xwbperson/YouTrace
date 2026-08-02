import { z } from 'zod'

const localDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export const createHabitInputSchema = z.object({
  projectId: z.string().uuid().nullable().default(null),
  name: z.string().trim().min(1).max(160),
  description: z.string().max(5_000).default(''),
  frequency: z.enum(['daily', 'weekly', 'weekdays', 'custom']),
  targetCount: z.number().int().min(1).max(99).default(1),
  weekdays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
  reminderTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().default(null),
  startDate: localDateSchema,
  endDate: localDateSchema.nullable().default(null)
})

export const updateHabitInputSchema = createHabitInputSchema.partial().extend({ id: z.string().uuid() })

export const recordHabitInputSchema = z.object({
  habitId: z.string().uuid(),
  date: localDateSchema,
  status: z.enum(['completed', 'skipped']),
  skipReason: z.string().max(2_000).nullable().default(null)
})

export const createMetricInputSchema = z.object({
  projectId: z.string().uuid().nullable().default(null),
  name: z.string().trim().min(1).max(160),
  targetValue: z.number().finite(),
  unit: z.string().trim().min(1).max(40),
  direction: z.enum(['increase', 'decrease', 'maintain']),
  period: z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'total'])
})

export const updateMetricInputSchema = createMetricInputSchema.partial().extend({ id: z.string().uuid() })

export const recordMetricInputSchema = z.object({
  metricId: z.string().uuid(),
  value: z.number().finite(),
  recordedAt: z.string().datetime(),
  note: z.string().max(2_000).default('')
})

export const updateMetricEntryInputSchema = recordMetricInputSchema.omit({ metricId: true }).extend({
  id: z.string().uuid()
})

export const createCourseInputSchema = z.object({
  projectId: z.string().uuid(),
  courseName: z.string().trim().min(1).max(200),
  examDate: localDateSchema.nullable().default(null),
  textbook: z.object({
    title: z.string().trim().min(1).max(300),
    author: z.string().max(200).default(''),
    edition: z.string().max(100).default(''),
    isbn: z.string().max(40).default(''),
    publisher: z.string().max(200).default('')
  })
})

export const updateCourseInputSchema = createCourseInputSchema.partial().extend({ id: z.string().uuid() })

export const courseMaterialTypeSchema = z.enum([
  'textbook',
  'reference',
  'slides',
  'paper',
  'notes',
  'exercises',
  'other'
])

export const createCourseMaterialInputSchema = z.object({
  courseId: z.string().uuid(),
  materialType: courseMaterialTypeSchema.default('other'),
  title: z.string().trim().min(1).max(300),
  author: z.string().max(200).default(''),
  edition: z.string().max(100).default(''),
  isbn: z.string().max(40).default(''),
  publisher: z.string().max(200).default(''),
  description: z.string().max(10_000).default('')
})

export const updateCourseMaterialInputSchema = createCourseMaterialInputSchema.partial().extend({
  id: z.string().uuid()
})

export const createKnowledgeInputSchema = z.object({
  projectId: z.string().uuid(),
  milestoneId: z.string().uuid().nullable().default(null),
  title: z.string().trim().min(1).max(240),
  content: z.string().max(100_000).default(''),
  mastery: z.number().int().min(0).max(100).nullable().default(null),
  nextReviewDate: localDateSchema.nullable().default(null)
})

export const updateKnowledgeInputSchema = createKnowledgeInputSchema.partial().extend({ id: z.string().uuid() })

export const createMistakeInputSchema = z.object({
  projectId: z.string().uuid(),
  knowledgeItemId: z.string().uuid().nullable().default(null),
  question: z.string().trim().min(1).max(20_000),
  wrongAnswer: z.string().max(20_000).default(''),
  correctAnswer: z.string().max(20_000).default(''),
  analysis: z.string().max(50_000).default(''),
  mastery: z.number().int().min(0).max(100).nullable().default(null),
  nextReviewDate: localDateSchema.nullable().default(null)
})

export const updateMistakeInputSchema = createMistakeInputSchema.partial().extend({ id: z.string().uuid() })

const learningTestInputSchema = z.object({
  projectId: z.string().uuid(),
  milestoneId: z.string().uuid().nullable().default(null),
  title: z.string().trim().min(1).max(240),
  score: z.number().finite().min(0).nullable().default(null),
  maxScore: z.number().finite().positive().nullable().default(null),
  testedAt: z.string().datetime(),
  note: z.string().max(10_000).default('')
})

export const createLearningTestInputSchema = learningTestInputSchema.refine(
  (value) => value.score === null || value.maxScore === null || value.score <= value.maxScore,
  { message: '成绩不能超过满分。', path: ['score'] }
)

export const updateLearningTestInputSchema = learningTestInputSchema.partial().extend({
  id: z.string().uuid()
}).refine(
  (value) => value.score === undefined || value.maxScore === undefined || value.score === null || value.maxScore === null || value.score <= value.maxScore,
  { message: '成绩不能超过满分。', path: ['score'] }
)

export const recordReviewResultInputSchema = z.object({
  queueId: z.string().uuid(),
  result: z.enum(['again', 'hard', 'good', 'easy']),
  reviewedAt: z.string().datetime()
})

export interface Habit {
  id: string
  projectId: string | null
  name: string
  description: string
  frequency: z.infer<typeof createHabitInputSchema>['frequency']
  targetCount: number
  weekdays: number[]
  reminderTime: string | null
  startDate: string
  endDate: string | null
  todayStatus: 'completed' | 'skipped' | null
  totalCompleted: number
  currentStreak: number
  createdAt: string
  updatedAt: string
}

export interface Metric {
  id: string
  projectId: string | null
  name: string
  targetValue: number
  unit: string
  direction: z.infer<typeof createMetricInputSchema>['direction']
  period: z.infer<typeof createMetricInputSchema>['period']
  currentValue: number
  lastRecordedAt: string | null
  entryCount: number
  createdAt: string
  updatedAt: string
}

export interface MetricEntry {
  id: string
  metricId: string
  value: number
  recordedAt: string
  note: string
  createdAt: string
}

export interface Course {
  id: string
  projectId: string
  courseName: string
  examDate: string | null
  textbook: {
    id: string
    title: string
    author: string
    edition: string
    isbn: string
    publisher: string
  } | null
  knowledgeCount: number
  mistakeCount: number
  pendingReviewCount: number
  materialCount: number
  createdAt: string
  updatedAt: string
}

export interface CourseMaterial {
  id: string
  courseId: string
  materialType: z.infer<typeof courseMaterialTypeSchema>
  title: string
  author: string
  edition: string
  isbn: string
  publisher: string
  description: string
  attachmentCount: number
  createdAt: string
  updatedAt: string
}

export interface KnowledgeItem {
  id: string
  projectId: string
  milestoneId: string | null
  title: string
  content: string
  mastery: number | null
  lastReviewedAt: string | null
  nextReviewDate: string | null
  createdAt: string
  updatedAt: string
}

export interface Mistake {
  id: string
  projectId: string
  knowledgeItemId: string | null
  question: string
  wrongAnswer: string
  correctAnswer: string
  analysis: string
  mastery: number | null
  nextReviewDate: string | null
  createdAt: string
  updatedAt: string
}

export interface LearningTest {
  id: string
  projectId: string
  milestoneId: string | null
  title: string
  score: number | null
  maxScore: number | null
  testedAt: string
  note: string
  createdAt: string
  updatedAt: string
}

export interface ReviewQueueItem {
  id: string
  entityType: 'knowledge' | 'mistake'
  entityId: string
  title: string
  scheduledDate: string
  status: 'pending' | 'completed'
  result: 'again' | 'hard' | 'good' | 'easy' | null
  projectId: string
  createdAt: string
  updatedAt: string
}

export type CreateHabitInput = z.infer<typeof createHabitInputSchema>
export type UpdateHabitInput = z.infer<typeof updateHabitInputSchema>
export type RecordHabitInput = z.infer<typeof recordHabitInputSchema>
export type CreateMetricInput = z.infer<typeof createMetricInputSchema>
export type UpdateMetricInput = z.infer<typeof updateMetricInputSchema>
export type RecordMetricInput = z.infer<typeof recordMetricInputSchema>
export type UpdateMetricEntryInput = z.infer<typeof updateMetricEntryInputSchema>
export type CreateCourseInput = z.infer<typeof createCourseInputSchema>
export type UpdateCourseInput = z.infer<typeof updateCourseInputSchema>
export type CreateCourseMaterialInput = z.infer<typeof createCourseMaterialInputSchema>
export type UpdateCourseMaterialInput = z.infer<typeof updateCourseMaterialInputSchema>
export type CreateKnowledgeInput = z.infer<typeof createKnowledgeInputSchema>
export type UpdateKnowledgeInput = z.infer<typeof updateKnowledgeInputSchema>
export type CreateMistakeInput = z.infer<typeof createMistakeInputSchema>
export type UpdateMistakeInput = z.infer<typeof updateMistakeInputSchema>
export type CreateLearningTestInput = z.infer<typeof createLearningTestInputSchema>
export type UpdateLearningTestInput = z.infer<typeof updateLearningTestInputSchema>
export type RecordReviewResultInput = z.infer<typeof recordReviewResultInputSchema>
