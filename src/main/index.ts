import { join, normalize, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  app,
  BrowserWindow,
  Menu,
  nativeImage,
  net,
  Notification,
  powerMonitor,
  protocol,
  Tray
} from 'electron'
import type { AppBootstrapState } from '../shared/contracts'
import { registerIpc, windowState } from './ipc/register-ipc'
import { WorkspaceManager } from './workspace/workspace-manager'
import { PlanningRepository } from './modules/planning/planning-repository'
import { PlanningService } from './modules/planning/planning-service'
import { ExecutionRepository } from './modules/execution/execution-repository'
import { ExecutionService } from './modules/execution/execution-service'
import { EffortRecoveryService } from './modules/execution/effort-recovery-service'
import { PracticeRepository } from './modules/practice/practice-repository'
import { PracticeService } from './modules/practice/practice-service'
import { TemporalRepository } from './modules/temporal/temporal-repository'
import { TemporalService } from './modules/temporal/temporal-service'
import { WorkflowRepository } from './modules/workflow/workflow-repository'
import { WorkflowService } from './modules/workflow/workflow-service'
import { ReminderRepository } from './modules/reminders/reminder-repository'
import { ReminderService } from './modules/reminders/reminder-service'
import { DataRepository } from './modules/data/data-repository'
import { DataService } from './modules/data/data-service'
import { DatabaseRecoveryService } from './modules/data/database-recovery-service'
import { SettingsRepository } from './modules/settings/settings-repository'
import { SettingsService } from './modules/settings/settings-service'

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'youtrace',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: false
    }
  }
])

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
let bootstrapState: AppBootstrapState = { status: 'needs-workspace', workspace: null }
let workspaceManager: WorkspaceManager
let reminderService: ReminderService | null = null
let reminderTimer: NodeJS.Timeout | null = null
let maintenanceTimer: NodeJS.Timeout | null = null
let workspaceHealthTimer: NodeJS.Timeout | null = null
let dataService: DataService | null = null
let settingsService: SettingsService | null = null
let executionService: ExecutionService | null = null
let effortRecoveryService: EffortRecoveryService | null = null
let effortHeartbeatTimer: NodeJS.Timeout | null = null
let lastBackupMaintenanceError = ''
let databaseRecoveryService: DatabaseRecoveryService

if (process.env['YOUTRACE_E2E'] === '1') {
  ;(
    globalThis as unknown as {
      __youtraceE2E: { requestApplicationQuit(): Promise<void> }
    }
  ).__youtraceE2E = { requestApplicationQuit }
}

const singleInstanceLock = app.requestSingleInstanceLock()
if (!singleInstanceLock) {
  app.quit()
}

app.on('second-instance', () => {
  showMainWindow()
})

app.whenReady().then(async () => {
  app.setAppUserModelId('com.youtrace.desktop')
  workspaceManager = new WorkspaceManager(app.getPath('userData'))
  bootstrapState = await workspaceManager.bootstrap()
  databaseRecoveryService = new DatabaseRecoveryService(workspaceManager)
  if (
    bootstrapState.status === 'workspace-unavailable' &&
    bootstrapState.code === 'DATABASE_INTEGRITY_FAILED'
  ) {
    try {
      const recovery = await databaseRecoveryService.prepare(bootstrapState.lastPath)
      bootstrapState = {
        status: 'database-recovery',
        workspace: null,
        lastPath: recovery.sourcePath,
        reason: bootstrapState.reason,
        recovery
      }
    } catch {
      // 保持“工作区不可用”状态；源数据库和备份都不会因此被改写或删除。
    }
  }
  const planningRepository = new PlanningRepository(() => workspaceManager.getDatabase())
  const planningService = new PlanningService(planningRepository)
  const practiceRepository = new PracticeRepository(() => workspaceManager.getDatabase())
  const practiceService = new PracticeService(
    practiceRepository,
    planningRepository
  )
  executionService = new ExecutionService(
    new ExecutionRepository(() => workspaceManager.getDatabase()),
    planningRepository,
    planningService,
    practiceService
  )
  effortRecoveryService = new EffortRecoveryService(workspaceManager, executionService)
  if (bootstrapState.status === 'ready') {
    await effortRecoveryService.recoverInterruptedEffort()
  }
  const temporalService = new TemporalService(
    new TemporalRepository(() => workspaceManager.getDatabase()),
    planningRepository
  )
  const workflowService = new WorkflowService(
    new WorkflowRepository(() => workspaceManager.getDatabase()),
    planningService
  )
  reminderService = new ReminderService(
    new ReminderRepository(() => workspaceManager.getDatabase())
  )
  dataService = new DataService(
    workspaceManager,
    new DataRepository(() => workspaceManager.getDatabase())
  )
  settingsService = new SettingsService(
    new SettingsRepository(() => workspaceManager.getDatabase())
  )

  registerApplicationProtocol()
  registerIpc({
    getWindow: () => mainWindow,
    workspaceManager,
    planningService,
    executionService,
    effortRecoveryService,
    practiceService,
    temporalService,
    workflowService,
    reminderService,
    dataService,
    databaseRecoveryService,
    settingsService,
    getBootstrapState: () => bootstrapState,
    setBootstrapState: (state) => {
      bootstrapState = state
    }
  })

  createMainWindow()
  createTray()
  dispatchReminders()
  reminderTimer = setInterval(dispatchReminders, 60_000)
  void runWorkspaceMaintenance()
  maintenanceTimer = setInterval(() => void runWorkspaceMaintenance(), 5 * 60_000)
  workspaceHealthTimer = setInterval(
    () => void monitorWorkspaceAvailability(),
    process.env['YOUTRACE_E2E'] === '1' ? 250 : 2_000
  )
  void recordEffortHeartbeat()
  effortHeartbeatTimer = setInterval(
    () => void recordEffortHeartbeat(),
    process.env['YOUTRACE_E2E'] === '1' ? 250 : 15_000
  )
  powerMonitor.on('resume', dispatchReminders)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    else showMainWindow()
  })
})

app.on('before-quit', () => {
  isQuitting = true
})

app.on('will-quit', (event) => {
  if (reminderTimer) {
    clearInterval(reminderTimer)
    reminderTimer = null
  }
  if (maintenanceTimer) {
    clearInterval(maintenanceTimer)
    maintenanceTimer = null
  }
  if (workspaceHealthTimer) {
    clearInterval(workspaceHealthTimer)
    workspaceHealthTimer = null
  }
  if (effortHeartbeatTimer) {
    clearInterval(effortHeartbeatTimer)
    effortHeartbeatTimer = null
  }
  if (!workspaceManager) return
  event.preventDefault()
  workspaceManager
    .close()
    .catch(() => undefined)
    .finally(() => {
      workspaceManager = undefined as unknown as WorkspaceManager
      app.quit()
    })
})

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 720,
    show: false,
    frame: false,
    thickFrame: false,
    transparent: false,
    backgroundColor: '#F3F6F5',
    title: '有迹',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: true
    }
  })

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowedPrefix = process.env['ELECTRON_RENDERER_URL'] ?? 'youtrace://app/'
    if (!url.startsWith(allowedPrefix)) event.preventDefault()
  })

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      if (settingsService?.getPreferences().closeBehavior === 'quit') {
        event.preventDefault()
        void requestApplicationQuit()
        return
      }
      event.preventDefault()
      mainWindow?.hide()
    }
  })

  const emitWindowState = (): void => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    mainWindow.webContents.send('window:state-changed', windowState(mainWindow))
  }

  mainWindow.on('maximize', emitWindowState)
  mainWindow.on('unmaximize', emitWindowState)
  mainWindow.on('focus', emitWindowState)
  mainWindow.on('blur', emitWindowState)
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadURL('youtrace://app/index.html')
  }

  mainWindow.once('ready-to-show', () => mainWindow?.show())
}

function registerApplicationProtocol(): void {
  const rendererRoot = resolve(__dirname, '../renderer')

  protocol.handle('youtrace', (request) => {
    const url = new URL(request.url)
    const requestedPath = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)
    const filePath = normalize(join(rendererRoot, requestedPath))
    const allowedRoot = `${rendererRoot}${sep}`

    if (filePath !== join(rendererRoot, 'index.html') && !filePath.startsWith(allowedRoot)) {
      return new Response('Bad request', { status: 400 })
    }

    return net.fetch(pathToFileURL(filePath).toString())
  })
}

function createTray(): void {
  const icon = loadTrayIcon()
  tray = new Tray(icon)
  tray.setToolTip('有迹 · 让每一次努力都有迹可循')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '打开有迹', click: showMainWindow },
      { type: 'separator' },
      {
        label: '退出',
        click: () => void requestApplicationQuit()
      }
    ])
  )
  tray.on('double-click', showMainWindow)
}

function loadTrayIcon(): Electron.NativeImage {
  const iconPaths = app.isPackaged
    ? [join(process.resourcesPath, 'youtrace-tray.png')]
    : [
        join(app.getAppPath(), 'resources', 'icon.png'),
        join(process.cwd(), 'resources', 'icon.png')
      ]
  for (const iconPath of iconPaths) {
    const fileIcon = nativeImage.createFromPath(iconPath)
    if (!fileIcon.isEmpty()) return fileIcon.resize({ width: 20, height: 20 })
  }

  const fallbackSvg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">
      <rect width="32" height="32" rx="8" fill="#216E65"/>
      <path d="M9 8v8.5a7 7 0 0 0 14 0V8" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/>
      <circle cx="16" cy="23" r="2" fill="#F1A85A"/>
    </svg>`
  return nativeImage.createFromBuffer(Buffer.from(fallbackSvg)).resize({ width: 20, height: 20 })
}

async function requestApplicationQuit(): Promise<void> {
  if (isQuitting) return
  showMainWindow()
  if (!mainWindow || mainWindow.isDestroyed()) return
  const sendRequest = (): void => mainWindow?.webContents.send('window:quit-requested')
  if (mainWindow.webContents.isLoading()) mainWindow.webContents.once('did-finish-load', sendRequest)
  else sendRequest()
}

async function recordEffortHeartbeat(): Promise<void> {
  if (!effortRecoveryService || bootstrapState.status !== 'ready') return
  try {
    await effortRecoveryService.recordHeartbeat()
  } catch {
    // 工作区健康检查负责展示介质失联；心跳失败不能让应用退出。
  }
}

function showMainWindow(): void {
  if (!mainWindow) {
    createMainWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function dispatchReminders(): void {
  if (!reminderService) return
  try {
    const notices = reminderService.refreshAndProcess(new Date().toISOString())
    if (!Notification.isSupported()) return
    for (const notice of notices) {
      const notification = new Notification({
        title: notice.title,
        body: notice.body,
        silent: false
      })
      notification.on('click', () => {
        showMainWindow()
        mainWindow?.webContents.send('reminder:navigate', {
          sourceType: notice.sourceType,
          sourceId: notice.sourceId
        })
      })
      notification.show()
    }
  } catch {
    // 工作区尚未打开或通知生成失败时，不影响业务数据和主窗口。
  }
}

async function runWorkspaceMaintenance(): Promise<void> {
  if (!dataService || !settingsService || bootstrapState.status !== 'ready') return
  try {
    const preferences = settingsService.getPreferences()
    if (!preferences.automaticBackupEnabled || bootstrapState.workspace.readOnly) return
    await dataService.maybeCreateAutomaticBackup(
      preferences.automaticBackupIntervalHours,
      {
        daily: preferences.backupDailyRetention,
        weekly: preferences.backupWeeklyRetention,
        monthly: preferences.backupMonthlyRetention
      },
      preferences.timezone
    )
    lastBackupMaintenanceError = ''
  } catch (error) {
    const message = error instanceof Error ? error.message : '自动备份暂时无法创建。'
    if (message !== lastBackupMaintenanceError && Notification.isSupported()) {
      new Notification({
        title: '自动备份已暂停',
        body: message
      }).show()
    }
    lastBackupMaintenanceError = message
  }
}

async function monitorWorkspaceAvailability(): Promise<void> {
  if (!workspaceManager || bootstrapState.status !== 'ready') return
  try {
    const availability = await workspaceManager.checkAvailability()
    if (availability.available) return
    const state: AppBootstrapState = {
      status: 'workspace-unavailable',
      workspace: null,
      lastPath: availability.path,
      reason: availability.reason ?? '工作区介质不可访问，有迹已停止写入。'
    }
    bootstrapState = state
    mainWindow?.webContents.send('workspace:unavailable', state)
  } catch {
    // 工作区尚未打开时不发送失联事件。
  }
}
