import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppBootstrapState,
  CreateWorkspaceInput,
  IpcResult,
  OpenWorkspaceInput,
  WindowState,
  WorkspaceSummary,
  YouTraceApi
} from '../shared/contracts'

const api: YouTraceApi = {
  app: {
    getBootstrapState: () =>
      ipcRenderer.invoke('app:get-bootstrap-state') as Promise<IpcResult<AppBootstrapState>>
  },
  dialog: {
    selectDirectory: () =>
      ipcRenderer.invoke('dialog:select-directory') as Promise<IpcResult<string | null>>
  },
  workspace: {
    create: (input: CreateWorkspaceInput) =>
      ipcRenderer.invoke('workspace:create', input) as Promise<IpcResult<WorkspaceSummary>>,
    open: (input: OpenWorkspaceInput) =>
      ipcRenderer.invoke('workspace:open', input) as Promise<IpcResult<WorkspaceSummary>>,
    reveal: () => ipcRenderer.invoke('workspace:reveal') as Promise<IpcResult<void>>
  },
  planning: {
    listProjects: () => ipcRenderer.invoke('planning:list-projects'),
    createProject: (input) => ipcRenderer.invoke('planning:create-project', input),
    updateProject: (input) => ipcRenderer.invoke('planning:update-project', input),
    trashProject: (id) => ipcRenderer.invoke('planning:trash-project', id),
    listGoals: (projectId) => ipcRenderer.invoke('planning:list-goals', projectId),
    createGoal: (input) => ipcRenderer.invoke('planning:create-goal', input),
    updateGoal: (input) => ipcRenderer.invoke('planning:update-goal', input),
    listMilestones: (projectId) => ipcRenderer.invoke('planning:list-milestones', projectId),
    createMilestone: (input) => ipcRenderer.invoke('planning:create-milestone', input),
    updateMilestone: (input) => ipcRenderer.invoke('planning:update-milestone', input),
    listTasks: (input) => ipcRenderer.invoke('planning:list-tasks', input),
    createTask: (input) => ipcRenderer.invoke('planning:create-task', input),
    updateTask: (input) => ipcRenderer.invoke('planning:update-task', input),
    trashTask: (id) => ipcRenderer.invoke('planning:trash-task', id),
    addTaskDependency: (input) => ipcRenderer.invoke('planning:add-task-dependency', input),
    listTaskDependencies: (taskId) =>
      ipcRenderer.invoke('planning:list-task-dependencies', taskId),
    listTags: () => ipcRenderer.invoke('planning:list-tags'),
    createTag: (input) => ipcRenderer.invoke('planning:create-tag', input),
    assignTag: (input) => ipcRenderer.invoke('planning:assign-tag', input),
    search: (input) => ipcRenderer.invoke('planning:search', input)
  },
  execution: {
    getActiveEffort: () => ipcRenderer.invoke('execution:get-active-effort'),
    startEffort: (input) => ipcRenderer.invoke('execution:start-effort', input),
    stopEffort: (input) => ipcRenderer.invoke('execution:stop-effort', input),
    createManualEffort: (input) => ipcRenderer.invoke('execution:create-manual-effort', input),
    listEfforts: (input) => ipcRenderer.invoke('execution:list-efforts', input),
    createEvidence: (input) => ipcRenderer.invoke('execution:create-evidence', input),
    listEvidence: (entityType, entityId) =>
      ipcRenderer.invoke('execution:list-evidence', entityType, entityId),
    updateEvidenceStatus: (input) =>
      ipcRenderer.invoke('execution:update-evidence-status', input),
    createMemo: (input) => ipcRenderer.invoke('execution:create-memo', input),
    listMemos: (inboxOnly) => ipcRenderer.invoke('execution:list-memos', inboxOnly),
    convertMemoToTask: (input) => ipcRenderer.invoke('execution:convert-memo-to-task', input)
  },
  practice: {
    listHabits: (projectId, date) =>
      ipcRenderer.invoke('practice:list-habits', projectId, date),
    createHabit: (input) => ipcRenderer.invoke('practice:create-habit', input),
    recordHabit: (input) => ipcRenderer.invoke('practice:record-habit', input),
    listMetrics: (projectId) => ipcRenderer.invoke('practice:list-metrics', projectId),
    createMetric: (input) => ipcRenderer.invoke('practice:create-metric', input),
    recordMetric: (input) => ipcRenderer.invoke('practice:record-metric', input),
    listCourses: () => ipcRenderer.invoke('practice:list-courses'),
    createCourse: (input) => ipcRenderer.invoke('practice:create-course', input),
    listKnowledge: (projectId) => ipcRenderer.invoke('practice:list-knowledge', projectId),
    createKnowledge: (input) => ipcRenderer.invoke('practice:create-knowledge', input),
    listMistakes: (projectId) => ipcRenderer.invoke('practice:list-mistakes', projectId),
    createMistake: (input) => ipcRenderer.invoke('practice:create-mistake', input)
  },
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize') as Promise<IpcResult<void>>,
    toggleMaximize: () =>
      ipcRenderer.invoke('window:toggle-maximize') as Promise<IpcResult<WindowState>>,
    close: () => ipcRenderer.invoke('window:close') as Promise<IpcResult<void>>,
    getState: () => ipcRenderer.invoke('window:get-state') as Promise<IpcResult<WindowState>>,
    onStateChanged: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, state: WindowState): void => {
        callback(state)
      }
      ipcRenderer.on('window:state-changed', listener)
      return () => ipcRenderer.removeListener('window:state-changed', listener)
    }
  }
}

contextBridge.exposeInMainWorld('youtrace', api)
