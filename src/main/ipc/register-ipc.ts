import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import { dialog, ipcMain, shell } from 'electron'
import { z } from 'zod'
import {
  createWorkspaceInputSchema,
  openWorkspaceInputSchema,
  type AppBootstrapState,
  type IpcResult,
  type WindowState
} from '../../shared/contracts'
import { toAppError, YouTraceError } from '../../shared/errors'
import type { WorkspaceManager } from '../workspace/workspace-manager'

interface RegisterIpcOptions {
  getWindow: () => BrowserWindow | null
  workspaceManager: WorkspaceManager
  getBootstrapState: () => AppBootstrapState
  setBootstrapState: (state: AppBootstrapState) => void
}

export function registerIpc(options: RegisterIpcOptions): void {
  const { getWindow, workspaceManager, getBootstrapState, setBootstrapState } = options

  const trusted = (event: IpcMainInvokeEvent): BrowserWindow => {
    const window = getWindow()
    if (!window || event.sender.id !== window.webContents.id) {
      throw new YouTraceError({
        code: 'IPC_SENDER_REJECTED',
        message: '请求不是来自当前有迹窗口。'
      })
    }
    return window
  }

  const wrap = async <T>(operation: () => T | Promise<T>): Promise<IpcResult<T>> => {
    try {
      return { ok: true, data: await operation() }
    } catch (error) {
      if (error instanceof z.ZodError) {
        return {
          ok: false,
          error: {
            code: 'INVALID_INPUT',
            message: '输入内容不完整或格式不正确。',
            details: { issues: error.issues.map((issue) => issue.path.join('.')) }
          }
        }
      }
      return { ok: false, error: toAppError(error) }
    }
  }

  ipcMain.handle('app:get-bootstrap-state', (event) =>
    wrap(() => {
      trusted(event)
      return getBootstrapState()
    })
  )

  ipcMain.handle('dialog:select-directory', (event) =>
    wrap(async () => {
      const window = trusted(event)
      const result = await dialog.showOpenDialog(window, {
        title: '选择有迹工作区文件夹',
        properties: ['openDirectory', 'createDirectory', 'promptToCreate'],
        buttonLabel: '选择此文件夹'
      })
      return result.canceled ? null : (result.filePaths[0] ?? null)
    })
  )

  ipcMain.handle('workspace:create', (event, rawInput) =>
    wrap(async () => {
      trusted(event)
      const input = createWorkspaceInputSchema.parse(rawInput)
      const workspace = await workspaceManager.create(input.rootPath, input.name)
      setBootstrapState({ status: 'ready', workspace })
      return workspace
    })
  )

  ipcMain.handle('workspace:open', (event, rawInput) =>
    wrap(async () => {
      trusted(event)
      const input = openWorkspaceInputSchema.parse(rawInput)
      const workspace = await workspaceManager.open(input.rootPath, input.readOnly)
      setBootstrapState({ status: 'ready', workspace })
      return workspace
    })
  )

  ipcMain.handle('workspace:reveal', (event) =>
    wrap(async () => {
      trusted(event)
      const error = await shell.openPath(workspaceManager.getCurrentPath())
      if (error) {
        throw new YouTraceError({
          code: 'WORKSPACE_REVEAL_FAILED',
          message: '无法在资源管理器中打开当前工作区。',
          details: { reason: error }
        })
      }
    })
  )

  ipcMain.handle('window:minimize', (event) =>
    wrap(() => {
      trusted(event).minimize()
    })
  )

  ipcMain.handle('window:toggle-maximize', (event) =>
    wrap(() => {
      const window = trusted(event)
      if (window.isMaximized()) window.unmaximize()
      else window.maximize()
      return windowState(window)
    })
  )

  ipcMain.handle('window:close', (event) =>
    wrap(() => {
      trusted(event).close()
    })
  )

  ipcMain.handle('window:get-state', (event) =>
    wrap(() => {
      return windowState(trusted(event))
    })
  )
}

export function windowState(window: BrowserWindow): WindowState {
  return {
    maximized: window.isMaximized(),
    focused: window.isFocused()
  }
}
