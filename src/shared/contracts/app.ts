import { z } from 'zod'

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
  window: {
    minimize(): Promise<IpcResult<void>>
    toggleMaximize(): Promise<IpcResult<WindowState>>
    close(): Promise<IpcResult<void>>
    getState(): Promise<IpcResult<WindowState>>
    onStateChanged(callback: (state: WindowState) => void): () => void
  }
}
