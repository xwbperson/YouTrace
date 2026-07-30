import { randomUUID } from 'node:crypto'
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  unlink,
  writeFile
} from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { z } from 'zod'
import {
  databaseRecoveryStateSchema,
  type DatabaseRecoveryState,
  type WorkspaceSummary
} from '../../../shared/contracts'
import { YouTraceError } from '../../../shared/errors'
import { DatabaseManager } from '../../database/database-manager'
import type { WorkspaceManager } from '../../workspace/workspace-manager'
import { PackageService } from './package-service'

const markerSchema = z.object({
  workspaceId: z.string().uuid()
})

export class DatabaseRecoveryService {
  private current: DatabaseRecoveryState | null = null

  constructor(
    private readonly workspaceManager: WorkspaceManager,
    private readonly packages = new PackageService()
  ) {}

  async prepare(sourcePath: string): Promise<DatabaseRecoveryState> {
    const existing = await this.readState(sourcePath)
    if (
      existing &&
      (await pathExists(existing.reportPath)) &&
      (!existing.candidateWorkspacePath ||
        (await pathExists(existing.candidateWorkspacePath)))
    ) {
      this.current = existing
      return existing
    }

    const marker = markerSchema.parse(
      JSON.parse(await readFile(join(sourcePath, '.youtrace-workspace.json'), 'utf8'))
    )
    const id = randomUUID()
    const preparedAt = new Date().toISOString()
    const recoveryDirectory = join(
      sourcePath,
      'recovery',
      'database-corruption',
      `${fileTimestamp(new Date(preparedAt))}-${id}`
    )
    await mkdir(recoveryDirectory, { recursive: true })
    const preservedDatabasePath = await preserveDatabaseFiles(sourcePath, recoveryDirectory)
    const failures: string[] = []
    let candidateBackupPath: string | null = null
    let candidateWorkspacePath: string | null = null

    const backupsDirectory = join(sourcePath, 'backups')
    const candidates = await listBackupCandidates(backupsDirectory)
    for (const backupPath of candidates) {
      const targetPath = await uniqueRecoveryTarget(sourcePath, preparedAt)
      try {
        const verification = await this.packages.verify(backupPath)
        if (verification.manifest.workspaceId !== marker.workspaceId) {
          failures.push(`${basename(backupPath)}：工作区标识不匹配`)
          continue
        }
        await this.packages.extractVerified(backupPath, targetPath)
        const database = new DatabaseManager()
        try {
          database.open(join(targetPath, 'database', 'youtrace.sqlite3'), true)
        } finally {
          database.close()
        }
        candidateBackupPath = backupPath
        candidateWorkspacePath = targetPath
        break
      } catch (error) {
        failures.push(
          `${basename(backupPath)}：${error instanceof Error ? error.message : '无法验证'}`
        )
        await rm(targetPath, { recursive: true, force: true })
      }
    }

    const reportPath = join(recoveryDirectory, 'recovery-report.json')
    const state = databaseRecoveryStateSchema.parse({
      id,
      workspaceId: marker.workspaceId,
      sourcePath,
      preservedDatabasePath,
      candidateBackupPath,
      candidateWorkspacePath,
      reportPath,
      preparedAt,
      affectedScope: [
        '原工作区数据库无法通过完整性检查，所有依赖数据库的记录暂不可读。',
        candidateWorkspacePath
          ? '恢复副本只包含所选备份创建时已经写入并打包的数据。'
          : '没有找到可独立打开的已验证备份，附件文件仍保留在原工作区。'
      ],
      failures
    })
    await writeJsonAtomic(reportPath, state)
    await writeJsonAtomic(this.statePath(sourcePath), state)
    this.current = state
    return state
  }

  getPending(): DatabaseRecoveryState | null {
    return this.current
  }

  async confirm(id: string): Promise<WorkspaceSummary> {
    const state = this.current
    if (!state || state.id !== id || !state.candidateWorkspacePath) {
      throw new YouTraceError({
        code: 'DATABASE_RECOVERY_NOT_READY',
        message: '当前没有可确认切换的数据库恢复副本。'
      })
    }

    const database = new DatabaseManager()
    try {
      database.open(join(state.candidateWorkspacePath, 'database', 'youtrace.sqlite3'), true)
    } finally {
      database.close()
    }
    const workspace = await this.workspaceManager.open(state.candidateWorkspacePath, false)
    await writeJsonAtomic(state.reportPath, {
      ...state,
      confirmedAt: new Date().toISOString(),
      switchedTo: workspace.path
    })
    await unlink(this.statePath(state.sourcePath)).catch((error) => {
      if ((error as NodeJS.ErrnoException | null)?.code !== 'ENOENT') throw error
    })
    this.current = null
    return workspace
  }

  private async readState(sourcePath: string): Promise<DatabaseRecoveryState | null> {
    try {
      return databaseRecoveryStateSchema.parse(
        JSON.parse(await readFile(this.statePath(sourcePath), 'utf8'))
      )
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException | null)?.code === 'ENOENT' ||
        error instanceof SyntaxError ||
        error instanceof z.ZodError
      ) {
        return null
      }
      throw error
    }
  }

  private statePath(sourcePath: string): string {
    return join(sourcePath, 'recovery', 'database-recovery.json')
  }
}

async function preserveDatabaseFiles(
  sourcePath: string,
  recoveryDirectory: string
): Promise<string | null> {
  const sourceDatabase = join(sourcePath, 'database', 'youtrace.sqlite3')
  let preservedDatabase: string | null = null
  for (const suffix of ['', '-wal', '-shm']) {
    const source = `${sourceDatabase}${suffix}`
    if (!(await pathExists(source))) continue
    const destination = join(recoveryDirectory, `damaged-youtrace.sqlite3${suffix}`)
    await copyFile(source, destination)
    await chmod(destination, 0o444).catch(() => undefined)
    if (!suffix) preservedDatabase = destination
  }
  return preservedDatabase
}

async function listBackupCandidates(directory: string): Promise<string[]> {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch {
    return []
  }
  const candidates = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.ytrace'))
      .map(async (entry) => {
        const path = join(directory, entry.name)
        return { path, modifiedAt: (await stat(path)).mtimeMs }
      })
  )
  return candidates
    .sort((left, right) => right.modifiedAt - left.modifiedAt)
    .map((candidate) => candidate.path)
}

async function uniqueRecoveryTarget(sourcePath: string, preparedAt: string): Promise<string> {
  const parent = dirname(sourcePath)
  const stem = `${basename(sourcePath)}-recovered-${fileTimestamp(new Date(preparedAt))}`
  for (let suffix = 0; ; suffix += 1) {
    const candidate = join(parent, suffix === 0 ? stem : `${stem}-${suffix}`)
    if (!(await pathExists(candidate))) return candidate
  }
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.tmp-${randomUUID()}`
  await writeFile(temporary, JSON.stringify(value, null, 2), 'utf8')
  await rename(temporary, path)
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

function fileTimestamp(date: Date): string {
  return date.toISOString().replaceAll(':', '-').replaceAll('.', '-')
}
