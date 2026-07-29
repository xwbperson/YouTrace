import { z } from 'zod'

export const projectStatusSchema = z.enum([
  'planned',
  'active',
  'paused',
  'completed',
  'cancelled',
  'archived'
])
export const progressModeSchema = z.enum(['equal', 'workload'])
export const taskStatusSchema = z.enum([
  'inbox',
  'ready',
  'scheduled',
  'in_progress',
  'blocked',
  'completed',
  'cancelled'
])
export const prioritySchema = z.enum(['low', 'medium', 'high', 'critical'])
export const goalStatusSchema = z.enum([
  'planned',
  'active',
  'paused',
  'completed',
  'cancelled'
])
export const milestoneStatusSchema = z.enum([
  'not_started',
  'in_progress',
  'completed',
  'verified',
  'accepted',
  'paused',
  'cancelled'
])

const nullableDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable()

export const createProjectInputSchema = z.object({
  areaId: z.string().uuid().nullable().default(null),
  name: z.string().trim().min(1).max(120),
  description: z.string().max(10_000).default(''),
  status: projectStatusSchema.default('active'),
  startDate: nullableDateSchema.default(null),
  targetDate: nullableDateSchema.default(null),
  successCriteria: z.string().max(5_000).default(''),
  progressMode: progressModeSchema.default('equal')
})

export const updateProjectInputSchema = z.object({
  id: z.string().uuid(),
  areaId: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().max(10_000).optional(),
  status: projectStatusSchema.optional(),
  startDate: nullableDateSchema.optional(),
  targetDate: nullableDateSchema.optional(),
  successCriteria: z.string().max(5_000).optional(),
  progressMode: progressModeSchema.optional()
})

export const createTaskInputSchema = z.object({
  parentTaskId: z.string().uuid().nullable().default(null),
  projectId: z.string().uuid().nullable().default(null),
  goalId: z.string().uuid().nullable().default(null),
  milestoneId: z.string().uuid().nullable().default(null),
  title: z.string().trim().min(1).max(240),
  description: z.string().max(20_000).default(''),
  status: taskStatusSchema.default('ready'),
  difficulty: z.number().int().min(1).max(5).nullable().default(null),
  priority: prioritySchema.default('medium'),
  estimatedMinutes: z.number().int().positive().max(525_600).nullable().default(null),
  progressWeight: z.number().positive().max(1_000_000).nullable().default(null),
  startDate: nullableDateSchema.default(null),
  dueAt: z.string().datetime().nullable().default(null),
  verificationCriteria: z.string().max(5_000).default(''),
  includeInProgress: z.boolean().default(true),
  tagIds: z.array(z.string().uuid()).max(50).default([])
})

export const createGoalInputSchema = z.object({
  projectId: z.string().uuid().nullable().default(null),
  title: z.string().trim().min(1).max(200),
  successCriteria: z.string().max(5_000).default(''),
  targetDate: nullableDateSchema.default(null),
  measureType: z.enum(['milestone', 'metric', 'workload', 'manual']).default('milestone'),
  status: goalStatusSchema.default('active')
})

export const updateGoalInputSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(1).max(200).optional(),
  successCriteria: z.string().max(5_000).optional(),
  targetDate: nullableDateSchema.optional(),
  measureType: z.enum(['milestone', 'metric', 'workload', 'manual']).optional(),
  status: goalStatusSchema.optional()
})

export const createMilestoneInputSchema = z.object({
  projectId: z.string().uuid().nullable().default(null),
  goalId: z.string().uuid().nullable().default(null),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(10_000).default(''),
  plannedDate: nullableDateSchema.default(null),
  estimatedMinutes: z.number().int().positive().max(525_600).nullable().default(null),
  manualWeight: z.number().positive().max(1_000_000).nullable().default(null),
  mastery: z.number().int().min(0).max(100).nullable().default(null),
  verificationCriteria: z.string().max(5_000).default(''),
  status: milestoneStatusSchema.default('not_started'),
  includeInProgress: z.boolean().default(true)
})

export const updateMilestoneInputSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid().nullable().optional(),
  goalId: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(10_000).optional(),
  plannedDate: nullableDateSchema.optional(),
  estimatedMinutes: z.number().int().positive().max(525_600).nullable().optional(),
  manualWeight: z.number().positive().max(1_000_000).nullable().optional(),
  mastery: z.number().int().min(0).max(100).nullable().optional(),
  verificationCriteria: z.string().max(5_000).optional(),
  status: milestoneStatusSchema.optional(),
  includeInProgress: z.boolean().optional()
})

export const addTaskDependencyInputSchema = z.object({
  taskId: z.string().uuid(),
  prerequisiteTaskId: z.string().uuid(),
  overrideReason: z.string().max(2_000).nullable().default(null)
})

export const updateTaskInputSchema = z.object({
  id: z.string().uuid(),
  parentTaskId: z.string().uuid().nullable().optional(),
  projectId: z.string().uuid().nullable().optional(),
  goalId: z.string().uuid().nullable().optional(),
  milestoneId: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(1).max(240).optional(),
  description: z.string().max(20_000).optional(),
  status: taskStatusSchema.optional(),
  difficulty: z.number().int().min(1).max(5).nullable().optional(),
  priority: prioritySchema.optional(),
  estimatedMinutes: z.number().int().positive().max(525_600).nullable().optional(),
  progressWeight: z.number().positive().max(1_000_000).nullable().optional(),
  startDate: nullableDateSchema.optional(),
  dueAt: z.string().datetime().nullable().optional(),
  verificationCriteria: z.string().max(5_000).optional(),
  includeInProgress: z.boolean().optional(),
  tagIds: z.array(z.string().uuid()).max(50).optional()
})

export const taskListInputSchema = z.object({
  projectId: z.string().uuid().nullable().default(null),
  statuses: z.array(taskStatusSchema).default([]),
  tagIds: z.array(z.string().uuid()).default([]),
  includeDeleted: z.boolean().default(false),
  limit: z.number().int().min(1).max(500).default(100),
  offset: z.number().int().min(0).default(0)
})

export const createTagInputSchema = z.object({
  name: z.string().trim().min(1).max(60),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).nullable().default(null),
  icon: z.string().max(80).nullable().default(null),
  description: z.string().max(2_000).default('')
})

export const assignTagInputSchema = z.object({
  tagId: z.string().uuid(),
  entityType: z.enum([
    'project',
    'goal',
    'milestone',
    'task',
    'countdown',
    'memo',
    'effort',
    'evidence',
    'habit',
    'metric'
  ]),
  entityId: z.string().uuid()
})

export const searchInputSchema = z.object({
  query: z.string().trim().min(1).max(200),
  entityTypes: z.array(z.string()).max(20).default([]),
  limit: z.number().int().min(1).max(100).default(30)
})

export interface Project {
  id: string
  areaId: string | null
  name: string
  description: string
  status: z.infer<typeof projectStatusSchema>
  startDate: string | null
  targetDate: string | null
  successCriteria: string
  progressMode: z.infer<typeof progressModeSchema>
  equalProgress: number
  workloadProgress: number
  masteryAverage: number | null
  masteryAssessed: number
  masteryTotal: number
  createdAt: string
  updatedAt: string
}

export interface Task {
  id: string
  parentTaskId: string | null
  projectId: string | null
  goalId: string | null
  milestoneId: string | null
  title: string
  description: string
  status: z.infer<typeof taskStatusSchema>
  difficulty: number | null
  priority: z.infer<typeof prioritySchema>
  estimatedMinutes: number | null
  actualMinutes: number
  progressWeight: number | null
  startDate: string | null
  dueAt: string | null
  verificationCriteria: string
  includeInProgress: boolean
  completedAt: string | null
  tagIds: string[]
  createdAt: string
  updatedAt: string
}

export interface Goal {
  id: string
  projectId: string | null
  title: string
  successCriteria: string
  targetDate: string | null
  measureType: 'milestone' | 'metric' | 'workload' | 'manual'
  status: z.infer<typeof goalStatusSchema>
  createdAt: string
  updatedAt: string
}

export interface Milestone {
  id: string
  projectId: string | null
  goalId: string | null
  title: string
  description: string
  plannedDate: string | null
  completedDate: string | null
  estimatedMinutes: number | null
  manualWeight: number | null
  mastery: number | null
  verificationCriteria: string
  status: z.infer<typeof milestoneStatusSchema>
  includeInProgress: boolean
  progress: number
  createdAt: string
  updatedAt: string
}

export interface TaskDependency {
  taskId: string
  prerequisiteTaskId: string
  prerequisiteTitle: string
  prerequisiteStatus: Task['status']
  prerequisiteProjectId: string | null
  overrideReason: string | null
  createdAt: string
}

export interface Tag {
  id: string
  name: string
  color: string | null
  icon: string | null
  description: string
  favorite: boolean
  createdAt: string
  updatedAt: string
}

export interface SearchResult {
  entityType: string
  entityId: string
  title: string
  snippet: string
}

export type CreateProjectInput = z.infer<typeof createProjectInputSchema>
export type UpdateProjectInput = z.infer<typeof updateProjectInputSchema>
export type CreateTaskInput = z.infer<typeof createTaskInputSchema>
export type UpdateTaskInput = z.infer<typeof updateTaskInputSchema>
export type CreateGoalInput = z.infer<typeof createGoalInputSchema>
export type UpdateGoalInput = z.infer<typeof updateGoalInputSchema>
export type CreateMilestoneInput = z.infer<typeof createMilestoneInputSchema>
export type UpdateMilestoneInput = z.infer<typeof updateMilestoneInputSchema>
export type AddTaskDependencyInput = z.infer<typeof addTaskDependencyInputSchema>
export type TaskListInput = z.infer<typeof taskListInputSchema>
export type CreateTagInput = z.infer<typeof createTagInputSchema>
export type AssignTagInput = z.infer<typeof assignTagInputSchema>
export type SearchInput = z.infer<typeof searchInputSchema>
