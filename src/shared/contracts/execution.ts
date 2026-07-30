import { z } from 'zod'

export const effortEntityTypeSchema = z.enum([
  'task',
  'habit',
  'milestone',
  'project',
  'goal',
  'memo'
])

export const startEffortInputSchema = z.object({
  entityType: effortEntityTypeSchema,
  entityId: z.string().uuid(),
  dependencyOverrideReason: z.string().trim().min(1).max(2_000).nullable().optional(),
  tagIds: z.array(z.string().uuid()).max(50).default([])
})

export const stopEffortInputSchema = z.object({
  id: z.string().uuid(),
  result: z.string().max(10_000).default(''),
  interruptions: z.string().max(5_000).default(''),
  obstacles: z.string().max(5_000).default(''),
  nextStep: z.string().max(5_000).default(''),
  energy: z.number().int().min(1).max(5).nullable().default(null),
  perceivedDifficulty: z.number().int().min(1).max(5).nullable().default(null)
})

export const interruptedEffortRecoverySchema = z.object({
  workspaceId: z.string().uuid(),
  effortId: z.string().uuid(),
  entityTitle: z.string().nullable(),
  startedAt: z.string().datetime(),
  lastHeartbeatAt: z.string().datetime(),
  detectedAt: z.string().datetime()
})

export const interruptedEffortRecoveryActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('retain') }),
  z.object({ action: z.literal('resume') }),
  z.object({
    action: z.literal('stop'),
    endedAt: z.string().datetime()
  })
])

export const createManualEffortInputSchema = z.object({
  entityType: effortEntityTypeSchema,
  entityId: z.string().uuid(),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime(),
  effectiveMinutes: z.number().int().min(0).max(525_600),
  result: z.string().max(10_000).default(''),
  interruptions: z.string().max(5_000).default(''),
  obstacles: z.string().max(5_000).default(''),
  nextStep: z.string().max(5_000).default(''),
  energy: z.number().int().min(1).max(5).nullable().default(null),
  perceivedDifficulty: z.number().int().min(1).max(5).nullable().default(null),
  tagIds: z.array(z.string().uuid()).max(50).default([])
})

export const effortListInputSchema = z.object({
  entityType: effortEntityTypeSchema.nullable().default(null),
  entityId: z.string().uuid().nullable().default(null),
  from: z.string().datetime().nullable().default(null),
  to: z.string().datetime().nullable().default(null),
  limit: z.number().int().min(1).max(500).default(100),
  offset: z.number().int().min(0).default(0)
})

export const correctEffortInputSchema = z.object({
  id: z.string().uuid(),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime(),
  effectiveMinutes: z.number().int().min(0).max(525_600),
  reason: z.string().trim().min(1).max(2_000)
})

export const evidenceStatusSchema = z.enum(['prepared', 'completed', 'verified', 'accepted'])
export const evidenceKindSchema = z.enum(['file', 'image', 'link', 'note', 'score', 'feedback'])

export const createEvidenceInputSchema = z.object({
  kind: evidenceKindSchema,
  title: z.string().trim().min(1).max(240),
  note: z.string().max(20_000).default(''),
  source: z.string().max(4_000).nullable().default(null),
  verificationStatus: evidenceStatusSchema.default('prepared'),
  entityType: z.string().max(60).nullable().default(null),
  entityId: z.string().uuid().nullable().default(null),
  tagIds: z.array(z.string().uuid()).max(50).default([])
})

export const updateEvidenceStatusInputSchema = z.object({
  id: z.string().uuid(),
  status: evidenceStatusSchema,
  reason: z.string().max(2_000).default('')
})

export const memoKindSchema = z.enum(['memo', 'knowledge', 'question', 'mistake', 'idea', 'meeting'])
export const createMemoInputSchema = z.object({
  kind: memoKindSchema.default('memo'),
  title: z.string().max(240).default(''),
  body: z.string().trim().min(1).max(100_000),
  projectId: z.string().uuid().nullable().default(null),
  sourceLink: z.string().url().max(4_000).nullable().default(null),
  tagIds: z.array(z.string().uuid()).max(50).default([])
})

export const convertMemoToTaskInputSchema = z.object({
  memoId: z.string().uuid(),
  projectId: z.string().uuid().nullable().default(null),
  title: z.string().trim().min(1).max(240),
  estimatedMinutes: z.number().int().positive().nullable().default(null)
})

export const convertMemoToLearningInputSchema = z.object({
  memoId: z.string().uuid(),
  projectId: z.string().uuid(),
  target: z.enum(['knowledge', 'mistake']),
  title: z.string().trim().min(1).max(240)
})

export interface EffortEntry {
  id: string
  entityType: z.infer<typeof effortEntityTypeSchema>
  entityId: string | null
  entityTitle: string | null
  source: 'timer' | 'manual'
  startedAt: string
  endedAt: string | null
  effectiveMinutes: number
  suspendedAt: string | null
  pausedMinutes: number
  energy: number | null
  perceivedDifficulty: number | null
  result: string
  interruptions: string
  obstacles: string
  nextStep: string
  tagIds: string[]
  createdAt: string
  updatedAt: string
}

export interface Evidence {
  id: string
  kind: z.infer<typeof evidenceKindSchema>
  title: string
  note: string
  source: string | null
  verificationStatus: z.infer<typeof evidenceStatusSchema>
  entityType: string | null
  entityId: string | null
  tagIds: string[]
  createdAt: string
  updatedAt: string
}

export interface EffortRevision {
  id: string
  effortId: string
  before: {
    startedAt: string
    endedAt: string | null
    effectiveMinutes: number
  }
  after: {
    startedAt: string
    endedAt: string
    effectiveMinutes: number
  }
  reason: string
  occurredAt: string
}

export interface EffortSummary {
  entryCount: number
  totalMinutes: number
  firstStartedAt: string | null
  lastStartedAt: string | null
}

export interface Memo {
  id: string
  kind: z.infer<typeof memoKindSchema>
  title: string
  body: string
  inbox: boolean
  processedAt: string | null
  projectId: string | null
  convertedTo: { entityType: string; entityId: string } | null
  evidenceCount: number
  archived: boolean
  tagIds: string[]
  createdAt: string
  updatedAt: string
}

export type StartEffortInput = z.infer<typeof startEffortInputSchema>
export type StopEffortInput = z.infer<typeof stopEffortInputSchema>
export type InterruptedEffortRecovery = z.infer<typeof interruptedEffortRecoverySchema>
export type InterruptedEffortRecoveryAction = z.infer<
  typeof interruptedEffortRecoveryActionSchema
>
export type CreateManualEffortInput = z.infer<typeof createManualEffortInputSchema>
export type EffortListInput = z.infer<typeof effortListInputSchema>
export type CorrectEffortInput = z.infer<typeof correctEffortInputSchema>
export type CreateEvidenceInput = z.infer<typeof createEvidenceInputSchema>
export type UpdateEvidenceStatusInput = z.infer<typeof updateEvidenceStatusInputSchema>
export type CreateMemoInput = z.infer<typeof createMemoInputSchema>
export type ConvertMemoToTaskInput = z.infer<typeof convertMemoToTaskInputSchema>
export type ConvertMemoToLearningInput = z.infer<typeof convertMemoToLearningInputSchema>
