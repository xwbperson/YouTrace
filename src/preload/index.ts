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
    listTasks: (input) => ipcRenderer.invoke('planning:list-tasks', input),
    createTask: (input) => ipcRenderer.invoke('planning:create-task', input),
    updateTask: (input) => ipcRenderer.invoke('planning:update-task', input),
    trashTask: (id) => ipcRenderer.invoke('planning:trash-task', id),
    listTags: () => ipcRenderer.invoke('planning:list-tags'),
    createTag: (input) => ipcRenderer.invoke('planning:create-tag', input),
    assignTag: (input) => ipcRenderer.invoke('planning:assign-tag', input),
    search: (input) => ipcRenderer.invoke('planning:search', input)
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
