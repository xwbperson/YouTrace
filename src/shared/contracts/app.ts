import { z } from 'zod'
import type {
  AddTaskDependencyInput,
  Area,
  AssignTagInput,
  CreateAreaInput,
  CreateChecklistItemInput,
  CreateGoalInput,
  CreateMilestoneInput,
  CreateProjectInput,
  CreateTagInput,
  CreateTaskInput,
  Goal,
  Milestone,
  Project,
  ProjectHistoryReport,
  MergeTagsInput,
  SavedView,
  SaveViewInput,
  SearchInput,
  SearchResult,
  SetTaskRecurrenceInput,
  SetChecklistProgressInput,
  Tag,
  TagStats,
  Task,
  TaskChecklistItem,
  TaskDependency,
  TaskListInput,
  TaskRecurrence,
  UpdateAreaInput,
  UpdateChecklistItemInput,
  UpdateGoalInput,
  UpdateMilestoneInput,
  UpdateProjectInput,
  UpdateSavedViewInput,
  UpdateTagInput,
  UpdateTaskInput
} from './planning'
import type {
  ConvertMemoToTaskInput,
  ConvertMemoToLearningInput,
  CorrectEffortInput,
  CreateEvidenceInput,
  CreateManualEffortInput,
  CreateMemoInput,
  EffortEntry,
  EffortRevision,
  EffortSummary,
  EffortListInput,
  Evidence,
  InterruptedEffortRecovery,
  InterruptedEffortRecoveryAction,
  Memo,
  StartEffortInput,
  StopEffortInput,
  UpdateMemoInput,
  UpdateEvidenceInput,
  UpdateEvidenceStatusInput
} from './execution'
import type {
  Course,
  CourseMaterial,
  CreateCourseMaterialInput,
  CreateCourseInput,
  CreateHabitInput,
  CreateKnowledgeInput,
  CreateLearningTestInput,
  CreateMetricInput,
  CreateMistakeInput,
  Habit,
  KnowledgeItem,
  LearningTest,
  Metric,
  MetricEntry,
  Mistake,
  RecordHabitInput,
  RecordMetricInput,
  RecordReviewResultInput,
  ReviewQueueItem,
  UpdateCourseInput,
  UpdateCourseMaterialInput,
  UpdateHabitInput,
  UpdateKnowledgeInput,
  UpdateLearningTestInput,
  UpdateMetricInput,
  UpdateMetricEntryInput,
  UpdateMistakeInput
} from './practice'
import type {
  Countdown,
  CreateCountdownInput,
  CreatePlanInput,
  CreateTimeBlockInput,
  MoveTimeBlockInput,
  PlanPeriod,
  TimeBlock,
  TimeRangeInput,
  UpdateCountdownInput,
  UpdatePlanInput,
  UpdateTimeBlockInput
} from './temporal'
import type {
  AppliedTemplate,
  ApplyReviewAdjustmentsInput,
  CreateReviewInput,
  PreviewTemplateInput,
  ProjectTemplate,
  Review,
  SaveProjectTemplateInput,
  TemplatePreview,
  UpdateProjectTemplateInput,
  UpdateReviewInput
} from './workflow'
import type {
  NotificationSettings,
  ReminderNotice,
  ReminderNavigation,
  UpcomingReminder
} from './reminders'
import type {
  BackupInfo,
  BackupStorageStatus,
  BackupVerification,
  DatabaseRecoveryState,
  EvidenceAttachment,
  ImportedEvidence,
  ImportEvidenceFileInput,
  MigrationRecoveryAction,
  MigrationRecoveryState,
  MigrateWorkspaceInput,
  ReadableExport,
  RecoveryDraft,
  RestoreBackupInput,
  RestoreResult,
  SaveRecoveryDraftInput,
  TrashActionInput,
  TrashItem,
  WorkspaceCheck
} from './data'
import { databaseRecoveryStateSchema } from './data'
import type { UserPreferences } from './preferences'

export const workspaceSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  path: z.string().min(1),
  createdAt: z.string().datetime(),
  formatVersion: z.number().int().positive(),
  readOnly: z.boolean()
})

export type WorkspaceSummary = z.infer<typeof workspaceSummarySchema>

export const appBootstrapStateSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('needs-workspace'),
    workspace: z.null()
  }),
  z.object({
    status: z.literal('ready'),
    workspace: workspaceSummarySchema
  }),
  z.object({
    status: z.literal('workspace-unavailable'),
    workspace: z.null(),
    lastPath: z.string(),
    reason: z.string(),
    code: z.string().nullable().optional()
  }),
  z.object({
    status: z.literal('database-recovery'),
    workspace: z.null(),
    lastPath: z.string(),
    reason: z.string(),
    recovery: databaseRecoveryStateSchema
  })
])

export type AppBootstrapState = z.infer<typeof appBootstrapStateSchema>
export type WorkspaceUnavailableState = Extract<
  AppBootstrapState,
  { status: 'workspace-unavailable' }
>

export const createWorkspaceInputSchema = z.object({
  rootPath: z.string().min(1),
  name: z.string().trim().min(1).max(80)
})

export const openWorkspaceInputSchema = z.object({
  rootPath: z.string().min(1),
  readOnly: z.boolean().default(false)
})

export type CreateWorkspaceInput = z.infer<typeof createWorkspaceInputSchema>
export type OpenWorkspaceInput = z.infer<typeof openWorkspaceInputSchema>
export type ReconnectWorkspaceInput = Pick<OpenWorkspaceInput, 'rootPath'>

export interface AppError {
  code: string
  message: string
  details?: Record<string, unknown>
  recovery?: string
}

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: AppError }

export interface WindowState {
  maximized: boolean
  focused: boolean
}

export type WindowResizeEdge =
  | 'north'
  | 'south'
  | 'east'
  | 'west'
  | 'north-east'
  | 'north-west'
  | 'south-east'
  | 'south-west'

export interface YouTraceApi {
  app: {
    getBootstrapState(): Promise<IpcResult<AppBootstrapState>>
    onWorkspaceUnavailable(callback: (state: WorkspaceUnavailableState) => void): () => void
  }
  dialog: {
    selectDirectory(): Promise<IpcResult<string | null>>
  }
  workspace: {
    create(input: CreateWorkspaceInput): Promise<IpcResult<WorkspaceSummary>>
    open(input: OpenWorkspaceInput): Promise<IpcResult<WorkspaceSummary>>
    reconnect(input: ReconnectWorkspaceInput): Promise<IpcResult<WorkspaceSummary>>
    reveal(): Promise<IpcResult<void>>
    getDatabaseRecovery(): Promise<IpcResult<DatabaseRecoveryState | null>>
    confirmDatabaseRecovery(id: string): Promise<IpcResult<WorkspaceSummary>>
    revealDatabaseRecoveryReport(): Promise<IpcResult<void>>
  }
  planning: {
    listAreas(includeArchived?: boolean): Promise<IpcResult<Area[]>>
    createArea(input: CreateAreaInput): Promise<IpcResult<Area>>
    updateArea(input: UpdateAreaInput): Promise<IpcResult<Area>>
    trashArea(id: string): Promise<IpcResult<void>>
    listProjects(includeArchived?: boolean): Promise<IpcResult<Project[]>>
    createProject(input: CreateProjectInput): Promise<IpcResult<Project>>
    updateProject(input: UpdateProjectInput): Promise<IpcResult<Project>>
    trashProject(id: string): Promise<IpcResult<void>>
    listProjectHistory(projectId: string): Promise<IpcResult<ProjectHistoryReport>>
    listGoals(projectId: string | null): Promise<IpcResult<Goal[]>>
    createGoal(input: CreateGoalInput): Promise<IpcResult<Goal>>
    updateGoal(input: UpdateGoalInput): Promise<IpcResult<Goal>>
    trashGoal(id: string): Promise<IpcResult<void>>
    listMilestones(projectId: string): Promise<IpcResult<Milestone[]>>
    createMilestone(input: CreateMilestoneInput): Promise<IpcResult<Milestone>>
    updateMilestone(input: UpdateMilestoneInput): Promise<IpcResult<Milestone>>
    trashMilestone(id: string): Promise<IpcResult<void>>
    listTasks(input: TaskListInput): Promise<IpcResult<Task[]>>
    createTask(input: CreateTaskInput): Promise<IpcResult<Task>>
    updateTask(input: UpdateTaskInput): Promise<IpcResult<Task>>
    trashTask(id: string): Promise<IpcResult<void>>
    addTaskDependency(input: AddTaskDependencyInput): Promise<IpcResult<void>>
    removeTaskDependency(taskId: string, prerequisiteTaskId: string): Promise<IpcResult<void>>
    listTaskDependencies(taskId: string): Promise<IpcResult<TaskDependency[]>>
    listChecklist(taskId: string): Promise<IpcResult<TaskChecklistItem[]>>
    createChecklistItem(input: CreateChecklistItemInput): Promise<IpcResult<TaskChecklistItem>>
    updateChecklistItem(input: UpdateChecklistItemInput): Promise<IpcResult<TaskChecklistItem>>
    deleteChecklistItem(id: string): Promise<IpcResult<void>>
    setChecklistProgress(input: SetChecklistProgressInput): Promise<IpcResult<Task>>
    getTaskRecurrence(taskId: string): Promise<IpcResult<TaskRecurrence | null>>
    setTaskRecurrence(input: SetTaskRecurrenceInput): Promise<IpcResult<TaskRecurrence | null>>
    listTags(includeArchived?: boolean): Promise<IpcResult<Tag[]>>
    createTag(input: CreateTagInput): Promise<IpcResult<Tag>>
    updateTag(input: UpdateTagInput): Promise<IpcResult<Tag>>
    archiveTag(id: string, archived: boolean): Promise<IpcResult<Tag>>
    trashTag(id: string): Promise<IpcResult<void>>
    assignTag(input: AssignTagInput): Promise<IpcResult<void>>
    getTagStats(id: string): Promise<IpcResult<TagStats>>
    mergeTags(input: MergeTagsInput): Promise<IpcResult<Tag>>
    search(input: SearchInput): Promise<IpcResult<SearchResult[]>>
    listSavedViews(): Promise<IpcResult<SavedView[]>>
    saveView(input: SaveViewInput): Promise<IpcResult<SavedView>>
    updateSavedView(input: UpdateSavedViewInput): Promise<IpcResult<SavedView>>
    deleteSavedView(id: string): Promise<IpcResult<void>>
  }
  execution: {
    getActiveEffort(): Promise<IpcResult<EffortEntry | null>>
    startEffort(input: StartEffortInput): Promise<IpcResult<EffortEntry>>
    suspendEffort(id: string): Promise<IpcResult<EffortEntry>>
    resumeEffort(id: string): Promise<IpcResult<EffortEntry>>
    stopEffort(input: StopEffortInput): Promise<IpcResult<EffortEntry>>
    getPendingRecovery(): Promise<IpcResult<InterruptedEffortRecovery | null>>
    resolvePendingRecovery(
      input: InterruptedEffortRecoveryAction
    ): Promise<IpcResult<EffortEntry>>
    createManualEffort(input: CreateManualEffortInput): Promise<IpcResult<EffortEntry>>
    listEfforts(input: EffortListInput): Promise<IpcResult<EffortEntry[]>>
    summarizeEfforts(from: string | null, to: string | null): Promise<IpcResult<EffortSummary>>
    correctEffort(input: CorrectEffortInput): Promise<IpcResult<EffortEntry>>
    listEffortHistory(id: string): Promise<IpcResult<EffortRevision[]>>
    createEvidence(input: CreateEvidenceInput): Promise<IpcResult<Evidence>>
    listEvidence(entityType: string | null, entityId: string | null): Promise<IpcResult<Evidence[]>>
    updateEvidence(input: UpdateEvidenceInput): Promise<IpcResult<Evidence>>
    trashEvidence(id: string): Promise<IpcResult<void>>
    updateEvidenceStatus(input: UpdateEvidenceStatusInput): Promise<IpcResult<Evidence>>
    createMemo(input: CreateMemoInput): Promise<IpcResult<Memo>>
    updateMemo(input: UpdateMemoInput): Promise<IpcResult<Memo>>
    listMemos(inboxOnly: boolean, includeArchived?: boolean): Promise<IpcResult<Memo[]>>
    convertMemoToTask(input: ConvertMemoToTaskInput): Promise<IpcResult<Task>>
    convertMemoToLearning(input: ConvertMemoToLearningInput): Promise<IpcResult<KnowledgeItem | Mistake>>
    archiveMemo(id: string, archived: boolean): Promise<IpcResult<Memo>>
    deleteArchivedMemo(id: string): Promise<IpcResult<void>>
  }
  practice: {
    listHabits(projectId: string | null, date: string): Promise<IpcResult<Habit[]>>
    createHabit(input: CreateHabitInput): Promise<IpcResult<Habit>>
    updateHabit(input: UpdateHabitInput): Promise<IpcResult<Habit>>
    trashHabit(id: string): Promise<IpcResult<void>>
    recordHabit(input: RecordHabitInput): Promise<IpcResult<Habit>>
    clearHabitRecord(habitId: string, date: string): Promise<IpcResult<Habit>>
    listMetrics(projectId: string | null): Promise<IpcResult<Metric[]>>
    createMetric(input: CreateMetricInput): Promise<IpcResult<Metric>>
    updateMetric(input: UpdateMetricInput): Promise<IpcResult<Metric>>
    trashMetric(id: string): Promise<IpcResult<void>>
    recordMetric(input: RecordMetricInput): Promise<IpcResult<Metric>>
    listMetricEntries(metricId: string): Promise<IpcResult<MetricEntry[]>>
    updateMetricEntry(input: UpdateMetricEntryInput): Promise<IpcResult<MetricEntry>>
    deleteMetricEntry(id: string): Promise<IpcResult<void>>
    listCourses(): Promise<IpcResult<Course[]>>
    createCourse(input: CreateCourseInput): Promise<IpcResult<Course>>
    updateCourse(input: UpdateCourseInput): Promise<IpcResult<Course>>
    trashCourse(id: string): Promise<IpcResult<void>>
    listCourseMaterials(courseId: string): Promise<IpcResult<CourseMaterial[]>>
    createCourseMaterial(input: CreateCourseMaterialInput): Promise<IpcResult<CourseMaterial>>
    updateCourseMaterial(input: UpdateCourseMaterialInput): Promise<IpcResult<CourseMaterial>>
    listKnowledge(projectId: string): Promise<IpcResult<KnowledgeItem[]>>
    createKnowledge(input: CreateKnowledgeInput): Promise<IpcResult<KnowledgeItem>>
    updateKnowledge(input: UpdateKnowledgeInput): Promise<IpcResult<KnowledgeItem>>
    trashKnowledge(id: string): Promise<IpcResult<void>>
    listMistakes(projectId: string): Promise<IpcResult<Mistake[]>>
    createMistake(input: CreateMistakeInput): Promise<IpcResult<Mistake>>
    updateMistake(input: UpdateMistakeInput): Promise<IpcResult<Mistake>>
    trashMistake(id: string): Promise<IpcResult<void>>
    listLearningTests(projectId: string): Promise<IpcResult<LearningTest[]>>
    createLearningTest(input: CreateLearningTestInput): Promise<IpcResult<LearningTest>>
    updateLearningTest(input: UpdateLearningTestInput): Promise<IpcResult<LearningTest>>
    trashLearningTest(id: string): Promise<IpcResult<void>>
    listReviewQueue(projectId: string): Promise<IpcResult<ReviewQueueItem[]>>
    recordReviewResult(input: RecordReviewResultInput): Promise<IpcResult<ReviewQueueItem>>
  }
  temporal: {
    listPlans(startDate: string, endDate: string): Promise<IpcResult<PlanPeriod[]>>
    createPlan(input: CreatePlanInput): Promise<IpcResult<PlanPeriod>>
    updatePlan(input: UpdatePlanInput): Promise<IpcResult<PlanPeriod>>
    trashPlan(id: string): Promise<IpcResult<void>>
    listTimeBlocks(input: TimeRangeInput): Promise<IpcResult<TimeBlock[]>>
    createTimeBlock(input: CreateTimeBlockInput): Promise<IpcResult<TimeBlock>>
    updateTimeBlock(input: UpdateTimeBlockInput): Promise<IpcResult<TimeBlock>>
    moveTimeBlock(input: MoveTimeBlockInput): Promise<IpcResult<TimeBlock>>
    trashTimeBlock(id: string): Promise<IpcResult<void>>
    listCountdowns(now: string): Promise<IpcResult<Countdown[]>>
    createCountdown(input: CreateCountdownInput): Promise<IpcResult<Countdown>>
    updateCountdown(input: UpdateCountdownInput): Promise<IpcResult<Countdown>>
    trashCountdown(id: string): Promise<IpcResult<void>>
  }
  workflow: {
    listReviews(): Promise<IpcResult<Review[]>>
    createReview(input: CreateReviewInput): Promise<IpcResult<Review>>
    updateReview(input: UpdateReviewInput): Promise<IpcResult<Review>>
    trashReview(id: string): Promise<IpcResult<void>>
    applyReviewAdjustments(input: ApplyReviewAdjustmentsInput): Promise<IpcResult<Review>>
    listTemplates(includeArchived?: boolean): Promise<IpcResult<ProjectTemplate[]>>
    previewTemplate(input: PreviewTemplateInput): Promise<IpcResult<TemplatePreview>>
    applyTemplate(input: PreviewTemplateInput): Promise<IpcResult<AppliedTemplate>>
    saveProjectTemplate(input: SaveProjectTemplateInput): Promise<IpcResult<ProjectTemplate>>
    updateProjectTemplate(input: UpdateProjectTemplateInput): Promise<IpcResult<ProjectTemplate>>
    archiveTemplate(id: string, archived: boolean): Promise<IpcResult<ProjectTemplate>>
    trashTemplate(id: string): Promise<IpcResult<void>>
  }
  reminders: {
    getSettings(): Promise<IpcResult<NotificationSettings>>
    updateSettings(input: NotificationSettings): Promise<IpcResult<NotificationSettings>>
    listUpcoming(): Promise<IpcResult<UpcomingReminder[]>>
    refresh(now: string): Promise<IpcResult<ReminderNotice[]>>
    snooze(id: string, minutes: number): Promise<IpcResult<UpcomingReminder>>
    dismiss(id: string): Promise<IpcResult<void>>
    muteSource(sourceType: string, sourceId: string): Promise<IpcResult<void>>
    onNavigate(callback: (navigation: ReminderNavigation) => void): () => void
  }
  data: {
    checkWorkspace(): Promise<IpcResult<WorkspaceCheck>>
    rebuildSearchIndex(): Promise<IpcResult<{ indexedCount: number }>>
    openEvidence(id: string): Promise<IpcResult<void>>
    listBackups(): Promise<IpcResult<BackupInfo[]>>
    getBackupStorageStatus(): Promise<IpcResult<BackupStorageStatus>>
    createBackup(label: string): Promise<IpcResult<BackupInfo>>
    verifyBackup(id: string): Promise<IpcResult<BackupVerification>>
    restoreBackup(input: RestoreBackupInput): Promise<IpcResult<RestoreResult>>
    migrateWorkspace(input: MigrateWorkspaceInput): Promise<IpcResult<RestoreResult>>
    getPendingMigration(): Promise<IpcResult<MigrationRecoveryState | null>>
    resolvePendingMigration(
      action: MigrationRecoveryAction
    ): Promise<IpcResult<RestoreResult | null>>
    revealPendingMigrationReport(): Promise<IpcResult<void>>
    saveRecoveryDraft(input: SaveRecoveryDraftInput): Promise<IpcResult<RecoveryDraft>>
    listRecoveryDrafts(): Promise<IpcResult<RecoveryDraft[]>>
    discardRecoveryDraft(key: string): Promise<IpcResult<void>>
    exportReadable(): Promise<IpcResult<ReadableExport>>
    exportPortable(): Promise<IpcResult<BackupInfo>>
    importPortable(targetRoot: string): Promise<IpcResult<RestoreResult | null>>
    importEvidenceFile(input: ImportEvidenceFileInput): Promise<IpcResult<ImportedEvidence | null>>
    importDroppedEvidenceFile(
      file: File,
      input: ImportEvidenceFileInput
    ): Promise<IpcResult<ImportedEvidence>>
    attachDroppedEvidenceFile(
      file: File,
      evidenceId: string
    ): Promise<IpcResult<ImportedEvidence['attachment']>>
    listEvidenceAttachments(evidenceId: string): Promise<IpcResult<EvidenceAttachment[]>>
    openEvidenceAttachment(attachmentId: string): Promise<IpcResult<void>>
    attachDroppedCourseMaterialFile(
      file: File,
      materialId: string
    ): Promise<IpcResult<EvidenceAttachment & { reused: boolean }>>
    listCourseMaterialAttachments(materialId: string): Promise<IpcResult<EvidenceAttachment[]>>
    openCourseMaterialAttachment(attachmentId: string): Promise<IpcResult<void>>
    listTrash(): Promise<IpcResult<TrashItem[]>>
    restoreTrash(input: TrashActionInput): Promise<IpcResult<TrashItem>>
    purgeTrash(input: TrashActionInput): Promise<IpcResult<void>>
  }
  settings: {
    getPreferences(): Promise<IpcResult<UserPreferences>>
    updatePreferences(input: UserPreferences): Promise<IpcResult<UserPreferences>>
  }
  window: {
    minimize(): Promise<IpcResult<void>>
    toggleMaximize(): Promise<IpcResult<WindowState>>
    close(): Promise<IpcResult<void>>
    quit(): Promise<IpcResult<void>>
    getState(): Promise<IpcResult<WindowState>>
    startResize(edge: WindowResizeEdge, screenX: number, screenY: number): void
    moveResize(screenX: number, screenY: number): void
    endResize(): void
    onQuitRequested(callback: () => void): () => void
    onStateChanged(callback: (state: WindowState) => void): () => void
  }
}
