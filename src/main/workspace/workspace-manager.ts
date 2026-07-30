import { randomUUID } from 'node:crypto'
import {
  constants,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
  writeFile
} from 'node:fs/promises'
import { basename, join, parse, resolve } from 'node:path'
import { z } from 'zod'
import type { AppBootstrapState, WorkspaceSummary } from '../../shared/contracts'
import { YouTraceError } from '../../shared/errors'
import { DatabaseManager } from '../database/database-manager'
import type Database from 'better-sqlite3'

const WORKSPACE_FORMAT_VERSION = 1
const MARKER_FILE = '.youtrace-workspace.json'
const LOCK_FILE = '.youtrace.lock'

const REQUIRED_DIRECTORIES = [
  'database',
  'attachments',
  'evidence',
  'backups',
  'exports',
  'templates',
  'recovery',
  'trash',
  'settings',
  'logs',
  'temp',
  'migration-reports'
] as const

const markerSchema = z.object({
  product: z.literal('YouTrace'),
  workspaceId: z.string().uuid(),
  name: z.string().min(1),
  formatVersion: z.number().int().positive(),
  createdAt: z.string().datetime()
})

const bootstrapSchema = z.object({
  workspacePath: z.string().min(1),
  workspaceId: z.string().uuid(),
  lastOpenedAt: z.string().datetime()
})

const lockSchema = z.object({
  workspaceId: z.string().uuid(),
  processId: z.number().int().positive(),
  startedAt: z.string().datetime(),
  token: z.string().uuid()
})

type WorkspaceMarker = z.infer<typeof markerSchema>

interface OpenWorkspace {
  summary: WorkspaceSummary
  database: DatabaseManager
  lockToken: string | null
  unavailableReason: string | null
}

export interface WorkspaceAvailability {
  available: boolean
  workspaceId: string
  path: string
  reason: string | null
}

export class WorkspaceManager {
  private readonly bootstrapPath: string
  private current: OpenWorkspace | null = null

  constructor(userDataPath: string) {
    this.bootstrapPath = join(userDataPath, 'bootstrap.json')
  }

  async bootstrap(): Promise<AppBootstrapState> {
    const pointer = await this.readBootstrap()
    if (!pointer) {
      return { status: 'needs-workspace', workspace: null }
    }

    try {
      const workspace = await this.open(pointer.workspacePath, false)
      return { status: 'ready', workspace }
    } catch (error) {
      return {
        status: 'workspace-unavailable',
        workspace: null,
        lastPath: pointer.workspacePath,
        reason: error instanceof Error ? error.message : '工作区无法打开'
      }
    }
  }

  getCurrent(): WorkspaceSummary | null {
    return this.current?.summary ?? null
  }

  getCurrentPath(): string {
    const workspace = this.current?.summary
    if (!workspace) {
      throw new YouTraceError({
        code: 'WORKSPACE_NOT_OPEN',
        message: '当前没有打开的工作区。',
        recovery: '请先创建或打开工作区。'
      })
    }
    return workspace.path
  }

  getDatabase(): Database.Database {
    if (!this.current) {
      throw new YouTraceError({
        code: 'WORKSPACE_NOT_OPEN',
        message: '当前没有打开的工作区。',
        recovery: '请先创建或打开工作区。'
      })
    }
    if (this.current.unavailableReason) {
      throw new YouTraceError({
        code: 'WORKSPACE_UNAVAILABLE',
        message: '工作区连接已中断，当前写入已停止。',
        details: {
          path: this.current.summary.path,
          reason: this.current.unavailableReason
        },
        recovery: '请保留当前页面中的草稿，并重新定位原工作区。'
      })
    }
    return this.current.database.get()
  }

  async checkAvailability(): Promise<WorkspaceAvailability> {
    const current = this.current
    if (!current) {
      throw new YouTraceError({
        code: 'WORKSPACE_NOT_OPEN',
        message: '当前没有打开的工作区。',
        recovery: '请先创建或打开工作区。'
      })
    }
    if (current.unavailableReason) {
      return {
        available: false,
        workspaceId: current.summary.id,
        path: current.summary.path,
        reason: current.unavailableReason
      }
    }

    try {
      const marker = await this.readMarker(current.summary.path)
      if (marker.workspaceId !== current.summary.id) {
        throw new YouTraceError({
          code: 'WORKSPACE_ID_CHANGED',
          message: '原路径现在指向另一个工作区，有迹已停止写入。',
          recovery: '请重新连接包含原工作区标识的目录。'
        })
      }
      await this.assertDatabaseFile(current.summary.path)
      return {
        available: true,
        workspaceId: current.summary.id,
        path: current.summary.path,
        reason: null
      }
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : '工作区介质不可访问，有迹已停止写入。'
      current.unavailableReason = reason
      try {
        current.database.close()
      } catch {
        // 即使介质突然失联导致 SQLite 关闭失败，也保持逻辑写入锁定。
      }
      return {
        available: false,
        workspaceId: current.summary.id,
        path: current.summary.path,
        reason
      }
    }
  }

  async create(rootPath: string, name: string): Promise<WorkspaceSummary> {
    const root = this.validateRoot(rootPath)
    const rootExists = await this.exists(root)

    if (!rootExists) {
      await mkdir(root, { recursive: true })
    } else {
      const rootStat = await stat(root)
      if (!rootStat.isDirectory()) {
        throw new YouTraceError({
          code: 'WORKSPACE_PATH_NOT_DIRECTORY',
          message: '选择的位置不是文件夹。',
          recovery: '请选择一个空文件夹作为工作区。'
        })
      }

      const entries = await readdir(root)
      if (entries.length > 0) {
        throw new YouTraceError({
          code: 'WORKSPACE_DIRECTORY_NOT_EMPTY',
          message: '所选文件夹不是空文件夹，未在其中创建工作区。',
          recovery: '请选择空文件夹，或先新建一个专用子文件夹。'
        })
      }
    }

    await this.assertWritable(root)

    const marker: WorkspaceMarker = {
      product: 'YouTrace',
      workspaceId: randomUUID(),
      name: name.trim(),
      formatVersion: WORKSPACE_FORMAT_VERSION,
      createdAt: new Date().toISOString()
    }

    const temporaryMarker = join(root, `${MARKER_FILE}.tmp-${randomUUID()}`)
    await writeFile(temporaryMarker, JSON.stringify(marker, null, 2), {
      encoding: 'utf8',
      flag: 'wx'
    })

    for (const directory of REQUIRED_DIRECTORIES) {
      await mkdir(join(root, directory), { recursive: true })
    }

    const database = new DatabaseManager()
    let lockToken: string | null = null

    try {
      database.open(join(root, 'database', 'youtrace.sqlite3'))
      lockToken = await this.acquireLock(root, marker.workspaceId)
      await rename(temporaryMarker, join(root, MARKER_FILE))

      const summary = this.toSummary(root, marker, false)
      await this.switchCurrent({ summary, database, lockToken, unavailableReason: null })
      await this.writeBootstrap(summary)
      return summary
    } catch (error) {
      database.close()
      if (lockToken) await this.releaseLock(root, lockToken)
      if (await this.exists(temporaryMarker)) await unlink(temporaryMarker)
      throw error
    }
  }

  async open(rootPath: string, readOnly: boolean): Promise<WorkspaceSummary> {
    const root = this.validateRoot(rootPath)
    const marker = await this.readMarker(root)

    if (marker.formatVersion > WORKSPACE_FORMAT_VERSION) {
      throw new YouTraceError({
        code: 'WORKSPACE_VERSION_TOO_NEW',
        message: '这个工作区由更高版本的有迹创建，当前版本不会写入。',
        recovery: '请使用较新版本打开该工作区。'
      })
    }

    if (!readOnly) {
      await this.assertWritable(root)
    }

    const database = new DatabaseManager()
    let lockToken: string | null = null

    try {
      if (!readOnly) lockToken = await this.acquireLock(root, marker.workspaceId)
      database.open(join(root, 'database', 'youtrace.sqlite3'), readOnly)

      const summary = this.toSummary(root, marker, readOnly)
      await this.switchCurrent({ summary, database, lockToken, unavailableReason: null })
      await this.writeBootstrap(summary)
      return summary
    } catch (error) {
      database.close()
      if (lockToken) await this.releaseLock(root, lockToken)
      throw error
    }
  }

  async reconnect(rootPath: string): Promise<WorkspaceSummary> {
    const previous = this.current
    if (!previous) {
      throw new YouTraceError({
        code: 'WORKSPACE_NOT_OPEN',
        message: '当前没有等待重新连接的工作区。',
        recovery: '请改用“打开已有工作区”。'
      })
    }

    const root = this.validateRoot(rootPath)
    const marker = await this.readMarker(root)
    if (marker.workspaceId !== previous.summary.id) {
      throw new YouTraceError({
        code: 'WORKSPACE_RECONNECT_MISMATCH',
        message: '所选目录不是刚才失联的工作区。',
        details: {
          expectedWorkspaceId: previous.summary.id,
          actualWorkspaceId: marker.workspaceId
        },
        recovery: '请选择原工作区或它的完整副本；不会把空目录或其他工作区当作原工作区。'
      })
    }
    await this.assertDatabaseFile(root)
    if (!previous.summary.readOnly) await this.assertWritable(root)

    const database = new DatabaseManager()
    let lockToken: string | null = null
    try {
      if (!previous.summary.readOnly) {
        lockToken = await this.acquireLock(root, marker.workspaceId, previous.lockToken)
      }
      database.open(
        join(root, 'database', 'youtrace.sqlite3'),
        previous.summary.readOnly
      )
      const summary = this.toSummary(root, marker, previous.summary.readOnly)
      await this.switchCurrent({
        summary,
        database,
        lockToken,
        unavailableReason: null
      })
      await this.writeBootstrap(summary)
      return summary
    } catch (error) {
      database.close()
      if (lockToken && (root !== previous.summary.path || lockToken !== previous.lockToken)) {
        await this.releaseLock(root, lockToken)
      }
      throw error
    }
  }

  async close(): Promise<void> {
    if (!this.current) return
    const closing = this.current
    this.current = null
    closing.database.close()
    if (closing.lockToken) {
      await this.releaseLock(closing.summary.path, closing.lockToken)
    }
  }

  private async switchCurrent(next: OpenWorkspace): Promise<void> {
    const previous = this.current
    this.current = next
    if (!previous) return

    previous.database.close()
    if (
      previous.lockToken &&
      (previous.summary.path !== next.summary.path || previous.lockToken !== next.lockToken)
    ) {
      await this.releaseLock(previous.summary.path, previous.lockToken)
    }
  }

  private validateRoot(input: string): string {
    const root = resolve(input.trim())
    if (!root || root === parse(root).root) {
      throw new YouTraceError({
        code: 'WORKSPACE_PATH_UNSAFE',
        message: '不能把磁盘根目录直接作为工作区。',
        recovery: '请创建并选择一个专用文件夹。'
      })
    }
    return root
  }

  private async readMarker(root: string): Promise<WorkspaceMarker> {
    try {
      const contents = await readFile(join(root, MARKER_FILE), 'utf8')
      return markerSchema.parse(JSON.parse(contents))
    } catch (error) {
      if (error instanceof z.ZodError || error instanceof SyntaxError) {
        throw new YouTraceError({
          code: 'WORKSPACE_MARKER_INVALID',
          message: '工作区标记损坏或格式不受支持。',
          recovery: '请选择正确的工作区，或从备份恢复。'
        })
      }

      throw new YouTraceError({
        code: 'WORKSPACE_MARKER_MISSING',
        message: '所选文件夹不是有效的有迹工作区。',
        recovery: `请选择包含 ${MARKER_FILE} 的文件夹。`
      })
    }
  }

  private async acquireLock(
    root: string,
    workspaceId: string,
    reusableToken: string | null = null
  ): Promise<string> {
    const lockPath = join(root, LOCK_FILE)
    const existing = await this.readLock(lockPath)
    if (existing && this.isProcessAlive(existing.processId)) {
      if (
        reusableToken &&
        existing.workspaceId === workspaceId &&
        existing.processId === process.pid &&
        existing.token === reusableToken
      ) {
        return reusableToken
      }
      throw new YouTraceError({
        code: 'WORKSPACE_LOCKED',
        message: '这个工作区正在被另一个有迹进程写入。',
        recovery: '请返回已打开的程序，或以只读方式打开。'
      })
    }

    if (existing) await unlink(lockPath)

    const token = randomUUID()
    const handle = await open(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY)
    try {
      await handle.writeFile(
        JSON.stringify({
          workspaceId,
          processId: process.pid,
          startedAt: new Date().toISOString(),
          token
        }),
        'utf8'
      )
    } finally {
      await handle.close()
    }
    return token
  }

  private async releaseLock(root: string, token: string): Promise<void> {
    const lockPath = join(root, LOCK_FILE)
    const existing = await this.readLock(lockPath)
    if (existing?.token === token) {
      await unlink(lockPath).catch(() => undefined)
    }
  }

  private async readLock(lockPath: string): Promise<z.infer<typeof lockSchema> | null> {
    try {
      const contents = await readFile(lockPath, 'utf8')
      return lockSchema.parse(JSON.parse(contents))
    } catch {
      return null
    }
  }

  private isProcessAlive(processId: number): boolean {
    try {
      process.kill(processId, 0)
      return true
    } catch {
      return false
    }
  }

  private async assertWritable(root: string): Promise<void> {
    const probe = join(root, `.youtrace-write-probe-${randomUUID()}`)
    try {
      await writeFile(probe, 'probe', { encoding: 'utf8', flag: 'wx' })
      await unlink(probe)
    } catch {
      throw new YouTraceError({
        code: 'WORKSPACE_READ_ONLY',
        message: '所选文件夹当前不可写，有迹没有创建或修改数据。',
        recovery: '请检查权限，或选择其他文件夹。'
      })
    }
  }

  private async assertDatabaseFile(root: string): Promise<void> {
    try {
      const databaseStat = await stat(join(root, 'database', 'youtrace.sqlite3'))
      if (databaseStat.isFile()) return
    } catch {
      // 使用统一的工作区错误，避免把系统路径细节直接暴露到界面。
    }
    throw new YouTraceError({
      code: 'WORKSPACE_DATABASE_MISSING',
      message: '工作区数据库不可用，有迹没有创建新的空数据库。',
      recovery: '请重新连接包含原数据库的完整工作区。'
    })
  }

  private async readBootstrap(): Promise<z.infer<typeof bootstrapSchema> | null> {
    try {
      const contents = await readFile(this.bootstrapPath, 'utf8')
      return bootstrapSchema.parse(JSON.parse(contents))
    } catch {
      return null
    }
  }

  private async writeBootstrap(workspace: WorkspaceSummary): Promise<void> {
    await mkdir(resolve(this.bootstrapPath, '..'), { recursive: true })
    const temporaryPath = `${this.bootstrapPath}.tmp-${randomUUID()}`
    await writeFile(
      temporaryPath,
      JSON.stringify(
        {
          workspacePath: workspace.path,
          workspaceId: workspace.id,
          lastOpenedAt: new Date().toISOString()
        },
        null,
        2
      ),
      'utf8'
    )
    await rename(temporaryPath, this.bootstrapPath)
  }

  private toSummary(root: string, marker: WorkspaceMarker, readOnly: boolean): WorkspaceSummary {
    return {
      id: marker.workspaceId,
      name: marker.name || basename(root),
      path: root,
      createdAt: marker.createdAt,
      formatVersion: marker.formatVersion,
      readOnly
    }
  }

  private async exists(path: string): Promise<boolean> {
    try {
      await stat(path)
      return true
    } catch {
      return false
    }
  }
}
