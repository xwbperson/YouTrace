import { z } from 'zod'
import type { WorkspaceSummary } from './app'
import { evidenceKindSchema, type Evidence } from './execution'

export const restoreBackupInputSchema = z.object({
  backupId: z.string().uuid(),
  targetRoot: z.string().trim().min(1)
})

export const migrateWorkspaceInputSchema = z.object({
  targetRoot: z.string().trim().min(1)
})

export const importEvidenceFileInputSchema = z.object({
  kind: evidenceKindSchema.default('file'),
  title: z.string().trim().min(1).max(240),
  note: z.string().max(20_000).default(''),
  source: z.string().max(4_000).nullable().optional(),
  verificationStatus: z.enum(['prepared', 'completed', 'verified', 'accepted']).default('prepared'),
  entityType: z.string().max(60).nullable().default(null),
  entityId: z.string().uuid().nullable().default(null),
  tagIds: z.array(z.string().uuid()).max(50).default([])
})

export const trashActionInputSchema = z.object({
  id: z.string().uuid(),
  confirmation: z.string().max(200).default('')
})

export const migrationRecoveryStateSchema = z.object({
  operationId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  sourcePath: z.string().min(1),
  targetPath: z.string().min(1),
  stage: z.enum(['preflight', 'copying', 'verifying', 'opening', 'failed']),
  startedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  reportPath: z.string().min(1).nullable(),
  failureCode: z.string().min(1).nullable(),
  failureReason: z.string().min(1).nullable()
})

export type MigrationRecoveryState = z.infer<typeof migrationRecoveryStateSchema>

export const migrationRecoveryActionSchema = z.enum(['return', 'retry', 'discard'])
export type MigrationRecoveryAction = z.infer<typeof migrationRecoveryActionSchema>

const recoveryDraftContextValueSchema = z.union([
  z.string().max(20_000),
  z.array(z.string().max(200)).max(100)
])

export const saveRecoveryDraftInputSchema = z.object({
  key: z.string().trim().min(1).max(120),
  label: z.string().trim().min(1).max(120),
  content: z.string().max(50_000),
  context: z.record(z.string().max(80), recoveryDraftContextValueSchema).default({})
})

export const recoveryDraftSchema = saveRecoveryDraftInputSchema.extend({
  workspaceId: z.string().uuid(),
  updatedAt: z.string().datetime()
})

export type SaveRecoveryDraftInput = z.infer<typeof saveRecoveryDraftInputSchema>
export type RecoveryDraft = z.infer<typeof recoveryDraftSchema>

export const databaseRecoveryStateSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  sourcePath: z.string().min(1),
  preservedDatabasePath: z.string().min(1).nullable(),
  candidateBackupPath: z.string().min(1).nullable(),
  candidateWorkspacePath: z.string().min(1).nullable(),
  reportPath: z.string().min(1),
  preparedAt: z.string().datetime(),
  affectedScope: z.array(z.string()).min(1),
  failures: z.array(z.string())
})

export type DatabaseRecoveryState = z.infer<typeof databaseRecoveryStateSchema>

export interface BackupInfo {
  id: string
  relativePath: string
  kind: 'manual' | 'automatic' | 'pre_migration' | 'pre_restore' | 'export'
  label: string
  createdAt: string
  verifiedAt: string | null
  manifestHash: string
  sizeBytes: number
  sourceSchemaVersion: number
}

export interface BackupVerification {
  valid: boolean
  backup: BackupInfo
  fileCount: number
  totalBytes: number
  workspaceId: string
  schemaVersion: number
}

export interface BackupStorageStatus {
  backupCount: number
  totalBytes: number
  nextEstimatedBytes: number
  freeBytes: number
  requiredFreeBytes: number
  canCreate: boolean
}

export interface WorkspaceCheck {
  workspaceId: string
  databaseIntegrity: 'ok'
  schemaVersion: number
  referencedFiles: number
  missingFiles: string[]
  fileCount: number
  totalBytes: number
}

export interface ReadableExport {
  directory: string
  files: string[]
}

export interface TrashItem {
  id: string
  entityType:
    | 'area'
    | 'project'
    | 'goal'
    | 'milestone'
    | 'task'
    | 'habit'
    | 'metric'
    | 'course'
    | 'knowledge'
    | 'mistake'
    | 'learning_test'
    | 'review'
    | 'evidence'
  entityId: string
  title: string
  deletedAt: string
  parentAvailable: boolean
  attachmentCount: number
  sharedAttachmentCount: number
}

export interface RestoreResult {
  workspace: WorkspaceSummary
  sourcePreservedAt: string
  reportPath: string
}

export interface EvidenceAttachment {
  id: string
  originalName: string
  relativePath: string
  sizeBytes: number
  contentHash: string
}

export interface ImportedEvidence {
  evidence: Evidence
  attachment: EvidenceAttachment & {
    reused: boolean
  }
}

export type RestoreBackupInput = z.infer<typeof restoreBackupInputSchema>
export type MigrateWorkspaceInput = z.infer<typeof migrateWorkspaceInputSchema>
export type ImportEvidenceFileInput = z.infer<typeof importEvidenceFileInputSchema>
export type TrashActionInput = z.infer<typeof trashActionInputSchema>
