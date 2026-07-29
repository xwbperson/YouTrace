import { join, normalize, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  app,
  BrowserWindow,
  Menu,
  nativeImage,
  net,
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
import { PracticeRepository } from './modules/practice/practice-repository'
import { PracticeService } from './modules/practice/practice-service'

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
  const planningRepository = new PlanningRepository(() => workspaceManager.getDatabase())
  const planningService = new PlanningService(planningRepository)
  const executionService = new ExecutionService(
    new ExecutionRepository(() => workspaceManager.getDatabase()),
    planningRepository,
    planningService
  )
  const practiceService = new PracticeService(
    new PracticeRepository(() => workspaceManager.getDatabase()),
    planningRepository
  )

  registerApplicationProtocol()
  registerIpc({
    getWindow: () => mainWindow,
    workspaceManager,
    planningService,
    executionService,
    practiceService,
    getBootstrapState: () => bootstrapState,
    setBootstrapState: (state) => {
      bootstrapState = state
    }
  })

  createMainWindow()
  createTray()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    else showMainWindow()
  })
})

app.on('before-quit', () => {
  isQuitting = true
})

app.on('will-quit', (event) => {
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
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">
      <rect width="32" height="32" rx="8" fill="#216E65"/>
      <path d="M9 8v8.5a7 7 0 0 0 14 0V8" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/>
      <circle cx="16" cy="23" r="2" fill="#F1A85A"/>
    </svg>`
  const icon = nativeImage.createFromBuffer(Buffer.from(svg)).resize({ width: 20, height: 20 })
  tray = new Tray(icon)
  tray.setToolTip('有迹 · 让每一次努力都有迹可循')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '打开有迹', click: showMainWindow },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          isQuitting = true
          app.quit()
        }
      }
    ])
  )
  tray.on('double-click', showMainWindow)
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
