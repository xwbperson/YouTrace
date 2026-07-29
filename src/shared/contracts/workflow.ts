import { z } from 'zod'
import type { Project, Task } from './planning'

const localDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export const createReviewInputSchema = z.object({
  reviewType: z.enum(['daily', 'weekly', 'monthly']),
  startDate: localDateSchema,
  endDate: localDateSchema,
  title: z.string().trim().min(1).max(200)
})

export const updateReviewInputSchema = z.object({
  id: z.string().uuid(),
  importantOutcomes: z.string().max(50_000).optional(),
  incompleteItems: z.string().max(50_000).optional(),
  blockers: z.string().max(50_000).optional(),
  nextFirstStep: z.string().max(20_000).optional(),
  nextCommitments: z.string().max(50_000).optional(),
  status: z.enum(['draft', 'completed']).optional()
})

export const applyReviewAdjustmentsInputSchema = z.object({
  reviewId: z.string().uuid(),
  reason: z.string().trim().min(1).max(2_000),
  adjustments: z.array(z.discriminatedUnion('action', [
    z.object({
      taskId: z.string().uuid(),
      action: z.literal('reschedule'),
      newDueAt: z.string().datetime()
    }),
    z.object({
      taskId: z.string().uuid(),
      action: z.literal('cancel')
    }),
    z.object({
      taskId: z.string().uuid(),
      action: z.literal('split'),
      newTitle: z.string().trim().min(1).max(240),
      estimatedMinutes: z.number().int().positive().max(525_600).nullable().default(null),
      newDueAt: z.string().datetime().nullable().default(null)
    })
  ])).min(1).max(100)
})

export const previewTemplateInputSchema = z.object({
  templateId: z.string().min(1).max(100),
  projectName: z.string().trim().min(1).max(120)
})

export const saveProjectTemplateInputSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  description: z.string().max(5_000).default('')
})

export interface ReviewSnapshot {
  generatedAt: string
  period: { startDate: string; endDate: string }
  plans: Array<{
    id: string
    title: string
    focusResult: string
    items: Array<{ entityType: string; entityId: string; titleSnapshot: string }>
  }>
  tasks: Array<Pick<Task, 'id' | 'title' | 'status' | 'projectId' | 'dueAt' | 'estimatedMinutes' | 'actualMinutes'>>
  efforts: Array<{ id: string; entityId: string | null; effectiveMinutes: number; result: string }>
  evidence: Array<{ id: string; title: string; verificationStatus: string }>
}

export interface Review {
  id: string
  reviewType: 'daily' | 'weekly' | 'monthly'
  startDate: string
  endDate: string
  title: string
  importantOutcomes: string
  incompleteItems: string
  blockers: string
  nextFirstStep: string
  nextCommitments: string
  status: 'draft' | 'completed'
  snapshot: ReviewSnapshot
  adjustmentCount: number
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

export interface ProjectTemplate {
  id: string
  name: string
  description: string
  builtIn: boolean
  sourceProjectId: string | null
  milestoneCount: number
  taskCount: number
}

export interface TemplatePreview {
  template: ProjectTemplate
  projectName: string
  milestones: Array<{
    title: string
    tasks: Array<{ title: string; estimatedMinutes: number | null }>
  }>
}

export type CreateReviewInput = z.infer<typeof createReviewInputSchema>
export type UpdateReviewInput = z.infer<typeof updateReviewInputSchema>
export type ApplyReviewAdjustmentsInput = z.infer<typeof applyReviewAdjustmentsInputSchema>
export type PreviewTemplateInput = z.infer<typeof previewTemplateInputSchema>
export type SaveProjectTemplateInput = z.infer<typeof saveProjectTemplateInputSchema>

export interface AppliedTemplate {
  project: Project
  milestoneIds: string[]
  taskIds: string[]
}
