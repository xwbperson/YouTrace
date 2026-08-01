import { z } from 'zod'

const localDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const instantSchema = z.string().datetime()

export const createPlanInputSchema = z.object({
  periodType: z.enum(['year', 'quarter', 'month', 'week', 'day']),
  startDate: localDateSchema,
  endDate: localDateSchema,
  title: z.string().trim().min(1).max(200),
  focusResult: z.string().max(5_000).default(''),
  capacityMinutes: z.number().int().positive().max(525_600).nullable().default(null),
  items: z.array(z.object({
    entityType: z.enum(['goal', 'project', 'milestone', 'task']),
    entityId: z.string().uuid(),
    titleSnapshot: z.string().trim().min(1).max(240)
  })).max(100).default([])
})

export const updatePlanInputSchema = createPlanInputSchema.partial().extend({ id: z.string().uuid() })

export const createTimeBlockInputSchema = z.object({
  taskId: z.string().uuid().nullable().default(null),
  title: z.string().trim().min(1).max(240),
  note: z.string().max(5_000).default(''),
  startsAt: instantSchema,
  endsAt: instantSchema,
  timezone: z.string().trim().min(1).max(100)
})

export const updateTimeBlockInputSchema = createTimeBlockInputSchema.partial().extend({ id: z.string().uuid() })

export const moveTimeBlockInputSchema = z.object({
  id: z.string().uuid(),
  startsAt: instantSchema,
  endsAt: instantSchema
})

export const timeRangeInputSchema = z.object({
  start: instantSchema,
  end: instantSchema
})

export const createCountdownInputSchema = z.object({
  title: z.string().trim().min(1).max(240),
  targetAt: instantSchema,
  timezone: z.string().trim().min(1).max(100),
  workingDays: z.array(z.number().int().min(0).max(6)).min(1).max(7).default([1, 2, 3, 4, 5]),
  bufferDays: z.number().int().min(0).max(365).default(0),
  importance: z.enum(['low', 'normal', 'high', 'critical']).default('normal'),
  entityType: z.enum(['goal', 'milestone', 'task', 'habit', 'metric', 'external']).nullable().default(null),
  entityId: z.string().uuid().nullable().default(null),
  remainingMinutes: z.number().int().min(0).max(10_000_000).nullable().default(null),
  tagIds: z.array(z.string().uuid()).max(50).default([])
})

export const updateCountdownInputSchema = createCountdownInputSchema.partial().extend({ id: z.string().uuid() })

export interface PlanItem {
  id: string
  entityType: 'goal' | 'project' | 'milestone' | 'task'
  entityId: string
  titleSnapshot: string
  committed: boolean
  sortOrder: number
}

export interface PlanPeriod {
  id: string
  periodType: 'year' | 'quarter' | 'month' | 'week' | 'day'
  startDate: string
  endDate: string
  title: string
  focusResult: string
  capacityMinutes: number | null
  plannedMinutes: number
  overloaded: boolean
  items: PlanItem[]
  createdAt: string
  updatedAt: string
}

export interface TimeBlock {
  id: string
  taskId: string | null
  taskTitle: string | null
  title: string
  note: string
  startsAt: string
  endsAt: string
  timezone: string
  durationMinutes: number
  conflicts: string[]
  createdAt: string
  updatedAt: string
}

export interface Countdown {
  id: string
  title: string
  targetAt: string
  timezone: string
  workingDays: number[]
  bufferDays: number
  importance: 'low' | 'normal' | 'high' | 'critical'
  entityType: string | null
  entityId: string | null
  remainingMinutes: number | null
  naturalDays: number
  effectiveWorkdays: number
  suggestedDailyMinutes: number | null
  recentDailyMinutes: number | null
  expectedCompletionAt: string | null
  risk: 'normal' | 'attention' | 'danger' | 'overdue'
  riskReason: string
  tagIds: string[]
  createdAt: string
  updatedAt: string
}

export type CreatePlanInput = z.infer<typeof createPlanInputSchema>
export type UpdatePlanInput = z.infer<typeof updatePlanInputSchema>
export type CreateTimeBlockInput = z.infer<typeof createTimeBlockInputSchema>
export type UpdateTimeBlockInput = z.infer<typeof updateTimeBlockInputSchema>
export type MoveTimeBlockInput = z.infer<typeof moveTimeBlockInputSchema>
export type TimeRangeInput = z.infer<typeof timeRangeInputSchema>
export type CreateCountdownInput = z.infer<typeof createCountdownInputSchema>
export type UpdateCountdownInput = z.infer<typeof updateCountdownInputSchema>
