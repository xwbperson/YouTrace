import { z } from 'zod'
import type {
  AddTaskDependencyInput,
  AssignTagInput,
  CreateGoalInput,
  CreateMilestoneInput,
  CreateProjectInput,
  CreateTagInput,
  CreateTaskInput,
  Goal,
  Milestone,
  Project,
  SearchInput,
  SearchResult,
  Tag,
  Task,
  TaskDependency,
  TaskListInput,
  UpdateGoalInput,
  UpdateMilestoneInput,
  UpdateProjectInput,
  UpdateTaskInput
} from './planning'
import type {
  ConvertMemoToTaskInput,
  CreateEvidenceInput,
  CreateManualEffortInput,
  CreateMemoInput,
  EffortEntry,
  EffortListInput,
  Evidence,
  Memo,
  StartEffortInput,
  StopEffortInput,
  UpdateEvidenceStatusInput
} from './execution'

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
    reason: z.string()
  })
])

export type AppBootstrapState = z.infer<typeof appBootstrapStateSchema>

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

export interface YouTraceApi {
  app: {
    getBootstrapState(): Promise<IpcResult<AppBootstrapState>>
  }
  dialog: {
    selectDirectory(): Promise<IpcResult<string | null>>
  }
  workspace: {
    create(input: CreateWorkspaceInput): Promise<IpcResult<WorkspaceSummary>>
    open(input: OpenWorkspaceInput): Promise<IpcResult<WorkspaceSummary>>
    reveal(): Promise<IpcResult<void>>
  }
  planning: {
    listProjects(): Promise<IpcResult<Project[]>>
    createProject(input: CreateProjectInput): Promise<IpcResult<Project>>
    updateProject(input: UpdateProjectInput): Promise<IpcResult<Project>>
    trashProject(id: string): Promise<IpcResult<void>>
    listGoals(projectId: string | null): Promise<IpcResult<Goal[]>>
    createGoal(input: CreateGoalInput): Promise<IpcResult<Goal>>
    updateGoal(input: UpdateGoalInput): Promise<IpcResult<Goal>>
    listMilestones(projectId: string): Promise<IpcResult<Milestone[]>>
    createMilestone(input: CreateMilestoneInput): Promise<IpcResult<Milestone>>
    updateMilestone(input: UpdateMilestoneInput): Promise<IpcResult<Milestone>>
    listTasks(input: TaskListInput): Promise<IpcResult<Task[]>>
    createTask(input: CreateTaskInput): Promise<IpcResult<Task>>
    updateTask(input: UpdateTaskInput): Promise<IpcResult<Task>>
    trashTask(id: string): Promise<IpcResult<void>>
    addTaskDependency(input: AddTaskDependencyInput): Promise<IpcResult<void>>
    listTaskDependencies(taskId: string): Promise<IpcResult<TaskDependency[]>>
    listTags(): Promise<IpcResult<Tag[]>>
    createTag(input: CreateTagInput): Promise<IpcResult<Tag>>
    assignTag(input: AssignTagInput): Promise<IpcResult<void>>
    search(input: SearchInput): Promise<IpcResult<SearchResult[]>>
  }
  execution: {
    getActiveEffort(): Promise<IpcResult<EffortEntry | null>>
    startEffort(input: StartEffortInput): Promise<IpcResult<EffortEntry>>
    stopEffort(input: StopEffortInput): Promise<IpcResult<EffortEntry>>
    createManualEffort(input: CreateManualEffortInput): Promise<IpcResult<EffortEntry>>
    listEfforts(input: EffortListInput): Promise<IpcResult<EffortEntry[]>>
    createEvidence(input: CreateEvidenceInput): Promise<IpcResult<Evidence>>
    listEvidence(entityType: string | null, entityId: string | null): Promise<IpcResult<Evidence[]>>
    updateEvidenceStatus(input: UpdateEvidenceStatusInput): Promise<IpcResult<Evidence>>
    createMemo(input: CreateMemoInput): Promise<IpcResult<Memo>>
    listMemos(inboxOnly: boolean): Promise<IpcResult<Memo[]>>
    convertMemoToTask(input: ConvertMemoToTaskInput): Promise<IpcResult<Task>>
  }
  window: {
    minimize(): Promise<IpcResult<void>>
    toggleMaximize(): Promise<IpcResult<WindowState>>
    close(): Promise<IpcResult<void>>
    getState(): Promise<IpcResult<WindowState>>
    onStateChanged(callback: (state: WindowState) => void): () => void
  }
}
