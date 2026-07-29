import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
  writeFile
} from 'node:fs/promises'
import { basename, dirname, extname, join, parse, relative, resolve, sep } from 'node:path'
import Database from 'better-sqlite3'
import type {
  BackupInfo,
  BackupVerification,
  ImportedEvidence,
  ImportEvidenceFileInput,
  ReadableExport,
  RestoreResult,
  TrashItem,
  WorkspaceCheck
} from '../../../shared/contracts'
import { YouTraceError } from '../../../shared/errors'
import { CURRENT_SCHEMA_VERSION } from '../../database/schema'
import type { WorkspaceManager } from '../../workspace/workspace-manager'
import { DataRepository } from './data-repository'
import { PackageService, type PackageManifest } from './package-service'

const APPLICATION_VERSION = '0.1.0'
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
]

export class DataService {
  constructor(
    private readonly workspaceManager: WorkspaceManager,
    private readonly repository: DataRepository,
    private readonly packages = new PackageService()
  ) {}

  listBackups(): BackupInfo[] {
    return this.repository.listBackups()
  }

  async maybeCreateAutomaticBackup(
    intervalHours: number,
    retentionCount: number
  ): Promise<BackupInfo | null> {
    const automatic = this.repository
      .listBackups()
      .filter((backup) => backup.kind === 'automatic')
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    const latest = automatic[0]
    if (
      latest &&
      Date.now() - Date.parse(latest.createdAt) < intervalHours * 60 * 60 * 1_000
    ) {
      return null
    }
    const created = await this.createBackup('自动备份', 'automatic')
    const root = this.workspaceManager.getCurrentPath()
    const retained = this.repository
      .listBackups()
      .filter((backup) => backup.kind === 'automatic')
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    for (const expired of retained.slice(retentionCount)) {
      const path = resolveWithin(root, expired.relativePath)
      await unlink(path).catch(() => undefined)
      this.repository.deleteBackupRecord(expired.id)
    }
    return created
  }

  async createBackup(
    label: string,
    kind: BackupInfo['kind'] = 'manual',
    directory = 'backups'
  ): Promise<BackupInfo> {
    const root = this.workspaceManager.getCurrentPath()
    const id = randomUUID()
    const timestamp = fileTimestamp(new Date())
    const relativePath = `${directory}/${timestamp}-${id}.ytrace`
    const destination = resolveWithin(root, relativePath)
    const result = await this.packages.create(
      root,
      this.workspaceManager.getDatabase(),
      destination,
      APPLICATION_VERSION
    )
    return this.repository.insertBackup(
      id,
      relativePath,
      kind,
      label.trim() || defaultBackupLabel(kind),
      result.manifest.createdAt,
      result.manifestHash,
      result.sizeBytes,
      result.manifest.schemaVersion
    )
  }

  async verifyBackup(id: string): Promise<BackupVerification> {
    const backup = this.requireBackup(id)
    const root = this.workspaceManager.getCurrentPath()
    const result = await this.packages.verify(resolveWithin(root, backup.relativePath))
    if (result.manifestHash !== backup.manifestHash) {
      throw new YouTraceError({
        code: 'BACKUP_CATALOG_MISMATCH',
        message: '备份文件与工作区登记的校验值不一致。'
      })
    }
    return {
      valid: true,
      backup,
      fileCount: result.manifest.files.length,
      totalBytes: result.totalBytes,
      workspaceId: result.manifest.workspaceId,
      schemaVersion: result.manifest.schemaVersion
    }
  }

  async checkWorkspace(): Promise<WorkspaceCheck> {
    const root = this.workspaceManager.getCurrentPath()
    const database = this.workspaceManager.getDatabase()
    const integrity = database.pragma('quick_check', { simple: true })
    if (integrity !== 'ok') {
      throw new YouTraceError({
        code: 'DATABASE_INTEGRITY_FAILED',
        message: '当前工作区数据库未通过完整性检查。'
      })
    }
    const migration = database
      .prepare('SELECT MAX(version) AS version FROM schema_migrations')
      .get() as { version: number }
    const references = this.repository.listReferencedFiles()
    const missingFiles: string[] = []
    for (const file of references) {
      try {
        const path = resolveWithin(root, file.relativePath)
        if (!(await stat(path)).isFile()) missingFiles.push(file.relativePath)
      } catch {
        missingFiles.push(file.relativePath)
      }
    }
    const summary = await directorySummary(root)
    return {
      workspaceId: this.workspaceManager.getCurrent()!.id,
      databaseIntegrity: 'ok',
      schemaVersion: migration.version,
      referencedFiles: references.length,
      missingFiles,
      fileCount: summary.fileCount,
      totalBytes: summary.totalBytes
    }
  }

  async restoreBackup(backupId: string, targetRoot: string): Promise<RestoreResult> {
    const backup = this.requireBackup(backupId)
    const sourceRoot = this.workspaceManager.getCurrentPath()
    const archivePath = resolveWithin(sourceRoot, backup.relativePath)
    await this.packages.verify(archivePath)
    await this.createBackup('恢复前自动恢复点', 'pre_restore')
    return this.restoreArchive(archivePath, targetRoot, sourceRoot, 'restore')
  }

  async migrateWorkspace(targetRoot: string): Promise<RestoreResult> {
    const sourceRoot = this.workspaceManager.getCurrentPath()
    const backup = await this.createBackup('根目录迁移前恢复点', 'pre_migration')
    const archivePath = resolveWithin(sourceRoot, backup.relativePath)
    const result = await this.restoreArchive(archivePath, targetRoot, sourceRoot, 'migration')
    await writeFile(
      join(sourceRoot, '.youtrace-migrated.json'),
      JSON.stringify(
        {
          product: 'YouTrace',
          workspaceId: result.workspace.id,
          migratedAt: new Date().toISOString(),
          targetPath: result.workspace.path,
          sourcePreserved: true
        },
        null,
        2
      ),
      'utf8'
    )
    return result
  }

  async exportPortable(): Promise<BackupInfo> {
    return this.createBackup('便携工作区导出', 'export', 'exports')
  }

  async importPortable(archivePath: string, targetRoot: string): Promise<RestoreResult> {
    const sourceRoot = this.workspaceManager.getCurrentPath()
    await this.packages.verify(archivePath)
    await this.createBackup('导入便携包前恢复点', 'pre_restore')
    return this.restoreArchive(archivePath, targetRoot, sourceRoot, 'import')
  }

  async exportReadable(): Promise<ReadableExport> {
    const root = this.workspaceManager.getCurrentPath()
    const database = this.workspaceManager.getDatabase()
    const directory = join(root, 'exports', `readable-${fileTimestamp(new Date())}`)
    await mkdir(directory, { recursive: false })
    const projects = database
      .prepare(
        `SELECT id, name, status, start_date, target_date, success_criteria
           FROM projects WHERE deleted_at IS NULL ORDER BY name`
      )
      .all() as Array<Record<string, unknown>>
    const tasks = database
      .prepare(
        `SELECT id, project_id, title, status, difficulty, priority,
                estimated_minutes, due_at, completed_at
           FROM tasks WHERE deleted_at IS NULL ORDER BY created_at`
      )
      .all() as Array<Record<string, unknown>>
    const efforts = database
      .prepare(
        `SELECT id, entity_type, entity_id, started_at, ended_at,
                effective_minutes, result, obstacles, next_step
           FROM effort_entries WHERE deleted_at IS NULL ORDER BY started_at`
      )
      .all() as Array<Record<string, unknown>>
    const markdown = [
      '# 有迹工作区可读导出',
      '',
      `- 导出时间：${new Date().toISOString()}`,
      `- 工作区：${this.workspaceManager.getCurrent()!.name}`,
      `- 项目：${projects.length}`,
      `- 任务：${tasks.length}`,
      `- 努力记录：${efforts.length}`,
      '',
      '## 项目',
      '',
      ...projects.map((project) => `- ${String(project['name'])}（${String(project['status'])}）`)
    ].join('\n')
    const files = ['README.md', 'projects.csv', 'tasks.csv', 'efforts.csv']
    await Promise.all([
      writeFile(join(directory, 'README.md'), markdown, 'utf8'),
      writeFile(join(directory, 'projects.csv'), toCsv(projects), 'utf8'),
      writeFile(join(directory, 'tasks.csv'), toCsv(tasks), 'utf8'),
      writeFile(join(directory, 'efforts.csv'), toCsv(efforts), 'utf8')
    ])
    return { directory, files }
  }

  listTrash(): TrashItem[] {
    return this.repository.listTrash()
  }

  restoreTrash(id: string): TrashItem {
    const item = this.repository.restoreTrash(id, new Date().toISOString())
    if (!item) throw notFound('回收站项目')
    return item
  }

  async purgeTrash(id: string, confirmation: string): Promise<void> {
    if (confirmation !== '永久删除') {
      throw new YouTraceError({
        code: 'PURGE_CONFIRMATION_REQUIRED',
        message: '永久删除前需要输入“永久删除”。'
      })
    }
    if (!this.repository.listBackups().some((backup) => backup.verifiedAt !== null)) {
      throw new YouTraceError({
        code: 'PURGE_BACKUP_REQUIRED',
        message: '永久删除前至少需要一个已验证备份。'
      })
    }
    const result = this.repository.purgeTrash(id, new Date().toISOString())
    if (!result) throw notFound('回收站项目')
    const root = this.workspaceManager.getCurrentPath()
    for (const relativePath of result.orphanPaths) {
      const path = resolveWithin(root, relativePath)
      await unlink(path).catch(() => undefined)
    }
  }

  async importEvidenceFile(
    sourcePath: string,
    input: ImportEvidenceFileInput
  ): Promise<ImportedEvidence> {
    if ((input.entityType === null) !== (input.entityId === null)) {
      throw new YouTraceError({
        code: 'EVIDENCE_RELATION_INCOMPLETE',
        message: '成果关联类型和对象需要同时设置。'
      })
    }
    const sourceInfo = await stat(sourcePath)
    if (!sourceInfo.isFile()) throw new YouTraceError({ code: 'FILE_NOT_REGULAR', message: '选择的内容不是普通文件。' })
    const hash = await hashFile(sourcePath)
    const existing = this.repository.findAttachmentByHash(hash)
    const root = this.workspaceManager.getCurrentPath()
    const evidenceId = randomUUID()
    const attachmentId = existing?.id ?? randomUUID()
    const originalName = basename(sourcePath)
    const extension = safeExtension(extname(originalName))
    const month = new Date().toISOString().slice(0, 7).replace('-', '/')
    const relativePath = existing?.relativePath ?? `evidence/${month}/${attachmentId}${extension}`
    const destination = resolveWithin(root, relativePath)
    let createdFile = false
    if (!existing) {
      await mkdir(dirname(destination), { recursive: true })
      const temporary = resolveWithin(root, `temp/import-${randomUUID()}${extension}`)
      await copyFile(sourcePath, temporary)
      const copiedHash = await hashFile(temporary)
      if (copiedHash !== hash) {
        await unlink(temporary).catch(() => undefined)
        throw new YouTraceError({ code: 'FILE_COPY_VERIFY_FAILED', message: '文件复制后的哈希不一致。' })
      }
      await rename(temporary, destination)
      createdFile = true
    }
    const attachment = {
      id: attachmentId,
      relativePath,
      originalName: existing?.originalName ?? originalName,
      contentHash: hash,
      sizeBytes: existing?.sizeBytes ?? sourceInfo.size,
      mimeType: mimeFromExtension(extension),
      reused: Boolean(existing)
    }
    try {
      const evidence = this.repository.insertEvidenceFile(
        evidenceId,
        attachment,
        input,
        new Date().toISOString()
      )
      return { evidence, attachment }
    } catch (error) {
      if (createdFile) await unlink(destination).catch(() => undefined)
      throw error
    }
  }

  private async restoreArchive(
    archivePath: string,
    targetInput: string,
    sourceRoot: string,
    operation: 'restore' | 'migration' | 'import'
  ): Promise<RestoreResult> {
    const verification = await this.packages.verify(archivePath)
    if (verification.manifest.schemaVersion > CURRENT_SCHEMA_VERSION) {
      throw new YouTraceError({
        code: 'PACKAGE_VERSION_TOO_NEW',
        message: '这个便携包由更高版本的有迹创建，当前版本不会导入。'
      })
    }
    const targetRoot = validateDestination(targetInput, sourceRoot)
    await assertEmptyOrMissing(targetRoot)
    const reportName = `${operation}-${fileTimestamp(new Date())}-${randomUUID()}.json`
    try {
      await this.packages.extractVerified(archivePath, targetRoot)
      for (const directory of REQUIRED_DIRECTORIES) {
        await mkdir(join(targetRoot, directory), { recursive: true })
      }
      await validateExtractedWorkspace(targetRoot, verification.manifest)
      const workspace = await this.workspaceManager.open(targetRoot, false)
      const reportPath = join(targetRoot, 'migration-reports', reportName)
      await writeFile(
        reportPath,
        JSON.stringify(
          {
            operation,
            status: 'completed',
            completedAt: new Date().toISOString(),
            sourcePath: sourceRoot,
            targetPath: targetRoot,
            sourcePreserved: true,
            packageManifestHash: verification.manifestHash,
            filesVerified: verification.manifest.files.length
          },
          null,
          2
        ),
        'utf8'
      )
      return { workspace, sourcePreservedAt: sourceRoot, reportPath }
    } catch (error) {
      const sourceReport = join(sourceRoot, 'migration-reports', reportName)
      await writeFile(
        sourceReport,
        JSON.stringify(
          {
            operation,
            status: 'failed',
            failedAt: new Date().toISOString(),
            sourcePath: sourceRoot,
            incompleteTargetPath: targetRoot,
            sourcePreserved: true,
            reason: error instanceof Error ? error.message : String(error)
          },
          null,
          2
        ),
        'utf8'
      ).catch(() => undefined)
      throw error
    }
  }

  private requireBackup(id: string): BackupInfo {
    const backup = this.repository.getBackup(id)
    if (!backup) throw notFound('备份')
    return backup
  }
}

async function validateExtractedWorkspace(root: string, manifest: PackageManifest): Promise<void> {
  const marker = JSON.parse(
    await readFile(join(root, '.youtrace-workspace.json'), 'utf8')
  ) as { workspaceId: string; formatVersion: number }
  if (
    marker.workspaceId !== manifest.workspaceId ||
    marker.formatVersion !== manifest.workspaceFormatVersion
  ) {
    throw new YouTraceError({
      code: 'RESTORE_MARKER_MISMATCH',
      message: '恢复出的工作区标记与包清单不一致。'
    })
  }
  const database = new Database(join(root, 'database', 'youtrace.sqlite3'), {
    readonly: true,
    fileMustExist: true
  })
  try {
    if (database.pragma('quick_check', { simple: true }) !== 'ok') {
      throw new YouTraceError({
        code: 'RESTORE_DATABASE_INVALID',
        message: '恢复出的数据库未通过完整性检查。'
      })
    }
  } finally {
    database.close()
  }
}

function validateDestination(input: string, sourceRoot: string): string {
  const target = resolve(input.trim())
  if (!target || target === parse(target).root) {
    throw new YouTraceError({ code: 'TARGET_PATH_UNSAFE', message: '不能把磁盘根目录作为目标工作区。' })
  }
  const source = resolve(sourceRoot)
  if (target === source || target.startsWith(`${source}${sep}`)) {
    throw new YouTraceError({
      code: 'TARGET_INSIDE_SOURCE',
      message: '目标目录不能等于或位于当前工作区内部。'
    })
  }
  return target
}

async function assertEmptyOrMissing(path: string): Promise<void> {
  try {
    const info = await stat(path)
    if (!info.isDirectory() || (await readdir(path)).length > 0) {
      throw new YouTraceError({
        code: 'TARGET_NOT_EMPTY',
        message: '恢复或迁移目标必须是空文件夹。'
      })
    }
  } catch (error) {
    if (error instanceof YouTraceError) throw error
    // 不存在时由解包流程创建。
  }
}

function resolveWithin(root: string, relativePath: string): string {
  const base = resolve(root)
  const target = resolve(base, relativePath)
  if (target === base || !target.startsWith(`${base}${sep}`)) {
    throw new YouTraceError({
      code: 'WORKSPACE_PATH_ESCAPE',
      message: '文件路径超出当前工作区，操作已拒绝。'
    })
  }
  return target
}

async function directorySummary(root: string): Promise<{ fileCount: number; totalBytes: number }> {
  let fileCount = 0
  let totalBytes = 0
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) await visit(path)
      else if (entry.isFile()) {
        fileCount += 1
        totalBytes += (await stat(path)).size
      }
    }
  }
  await visit(root)
  return { fileCount, totalBytes }
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

function toCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return '\uFEFF'
  const columns = Object.keys(rows[0]!)
  return `\uFEFF${[
    columns.map(csvCell).join(','),
    ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(','))
  ].join('\r\n')}`
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value)
  return `"${text.replaceAll('"', '""')}"`
}

function fileTimestamp(date: Date): string {
  return date.toISOString().replaceAll(':', '-').replaceAll('.', '-')
}

function defaultBackupLabel(kind: BackupInfo['kind']): string {
  const labels: Record<BackupInfo['kind'], string> = {
    manual: '手动备份',
    automatic: '自动备份',
    pre_migration: '迁移前恢复点',
    pre_restore: '恢复前恢复点',
    export: '便携导出'
  }
  return labels[kind]
}

function safeExtension(value: string): string {
  const normalized = value.toLowerCase()
  return /^\.[a-z0-9]{1,10}$/.test(normalized) ? normalized : ''
}

function mimeFromExtension(extension: string): string | null {
  const values: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.csv': 'text/csv'
  }
  return values[extension] ?? null
}

function notFound(label: string): YouTraceError {
  return new YouTraceError({ code: 'ENTITY_NOT_FOUND', message: `${label}不存在。` })
}
