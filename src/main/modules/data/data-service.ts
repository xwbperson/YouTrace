import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  statfs,
  unlink,
  writeFile
} from 'node:fs/promises'
import { basename, dirname, extname, join, parse, relative, resolve, sep } from 'node:path'
import Database from 'better-sqlite3'
import packageMetadata from '../../../../package.json'
import {
  recoveryDraftSchema,
  saveRecoveryDraftInputSchema,
  type BackupInfo,
  type BackupStorageStatus,
  type BackupVerification,
  type EvidenceAttachment,
  type ImportedEvidence,
  type ImportEvidenceFileInput,
  type MigrationRecoveryAction,
  type MigrationRecoveryState,
  type ReadableExport,
  type RecoveryDraft,
  type RestoreResult,
  type SaveRecoveryDraftInput,
  type TrashItem,
  type WorkspaceCheck
} from '../../../shared/contracts'
import { YouTraceError } from '../../../shared/errors'
import { CURRENT_SCHEMA_VERSION } from '../../database/schema'
import type { WorkspaceManager } from '../../workspace/workspace-manager'
import { DataRepository } from './data-repository'
import {
  collectRecordCounts,
  PackageService,
  type PackageManifest
} from './package-service'

const APPLICATION_VERSION = packageMetadata.version
const INCOMPLETE_MIGRATION_FILE = '.youtrace-incomplete-migration.json'
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

  async getPendingMigration(): Promise<MigrationRecoveryState | null> {
    return this.workspaceManager.getPendingMigration()
  }

  async saveRecoveryDraft(input: SaveRecoveryDraftInput): Promise<RecoveryDraft> {
    const value = saveRecoveryDraftInputSchema.parse(input)
    const workspace = this.workspaceManager.getCurrent()
    if (!workspace) {
      throw new YouTraceError({
        code: 'WORKSPACE_NOT_OPEN',
        message: '当前没有打开的工作区。'
      })
    }
    if (workspace.readOnly) {
      throw new YouTraceError({
        code: 'WORKSPACE_READ_ONLY',
        message: '只读工作区不会保存草稿。'
      })
    }
    this.workspaceManager.getDatabase()
    const draft: RecoveryDraft = {
      ...value,
      workspaceId: workspace.id,
      updatedAt: new Date().toISOString()
    }
    const path = recoveryDraftPath(workspace.path, value.key)
    await mkdir(dirname(path), { recursive: true })
    const temporaryPath = `${path}.tmp-${randomUUID()}`
    await writeFile(temporaryPath, JSON.stringify(draft, null, 2), 'utf8')
    await rename(temporaryPath, path)
    return draft
  }

  async listRecoveryDrafts(): Promise<RecoveryDraft[]> {
    const workspace = this.workspaceManager.getCurrent()
    if (!workspace) return []
    const directory = join(workspace.path, 'recovery', 'drafts')
    let entries: string[]
    try {
      entries = await readdir(directory)
    } catch {
      return []
    }
    const drafts: RecoveryDraft[] = []
    for (const entry of entries.filter((name) => name.endsWith('.json'))) {
      try {
        const draft = recoveryDraftSchema.parse(
          JSON.parse(await readFile(join(directory, entry), 'utf8'))
        )
        if (draft.workspaceId === workspace.id) drafts.push(draft)
      } catch {
        // 损坏的单个草稿不会阻止其他可恢复草稿显示。
      }
    }
    return drafts.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  }

  async discardRecoveryDraft(key: string): Promise<void> {
    const value = saveRecoveryDraftInputSchema.shape.key.parse(key)
    const root = this.workspaceManager.getCurrentPath()
    await unlink(recoveryDraftPath(root, value)).catch((error) => {
      if ((error as NodeJS.ErrnoException | null)?.code !== 'ENOENT') throw error
    })
  }

  async getPendingMigrationReportDirectory(): Promise<string> {
    const pending = await this.workspaceManager.getPendingMigration()
    if (!pending) {
      throw new YouTraceError({
        code: 'MIGRATION_RECOVERY_NOT_FOUND',
        message: '当前没有待处理的迁移恢复状态。'
      })
    }
    return pending.reportPath
      ? dirname(pending.reportPath)
      : join(pending.sourcePath, 'migration-reports')
  }

  async resolvePendingMigration(
    action: MigrationRecoveryAction
  ): Promise<RestoreResult | null> {
    const pending = await this.workspaceManager.getPendingMigration()
    if (!pending) {
      throw new YouTraceError({
        code: 'MIGRATION_RECOVERY_NOT_FOUND',
        message: '当前没有待处理的迁移恢复状态。'
      })
    }
    const current = this.workspaceManager.getCurrent()
    if (
      !current ||
      current.id !== pending.workspaceId ||
      resolve(current.path) !== resolve(pending.sourcePath)
    ) {
      throw new YouTraceError({
        code: 'MIGRATION_RECOVERY_SOURCE_MISMATCH',
        message: '当前工作区不是失败迁移记录中的源工作区。',
        recovery: '请先打开迁移记录中的源工作区。'
      })
    }
    if (action === 'return') {
      await this.workspaceManager.setPendingMigration(null)
      return null
    }

    await removeIncompleteMigrationTarget(pending)
    if (action === 'discard') {
      await this.workspaceManager.setPendingMigration(null)
      return null
    }
    return this.migrateWorkspace(pending.targetPath)
  }

  rebuildSearchIndex(): { indexedCount: number } {
    return { indexedCount: this.repository.rebuildSearchIndex() }
  }

  getEvidenceOpenTarget(id: string): { type: 'external' | 'file'; target: string } {
    const source = this.repository.getEvidenceOpenTarget(id)
    if (!source) throw notFound('成果证据')
    if (source.relativePath) {
      return {
        type: 'file',
        target: resolveWithin(this.workspaceManager.getCurrentPath(), source.relativePath)
      }
    }
    if (source.kind === 'link' && source.source) {
      let url: URL
      try {
        url = new URL(source.source)
      } catch {
        throw new YouTraceError({
          code: 'EVIDENCE_LINK_INVALID',
          message: '成果来源不是有效链接。'
        })
      }
      if (!['https:', 'http:', 'mailto:'].includes(url.protocol)) {
        throw new YouTraceError({
          code: 'EVIDENCE_LINK_PROTOCOL_BLOCKED',
          message: '这个链接协议不在允许列表中。'
        })
      }
      return { type: 'external', target: url.toString() }
    }
    throw new YouTraceError({
      code: 'EVIDENCE_SOURCE_NOT_OPENABLE',
      message: '这项成果没有可打开的文件或链接。'
    })
  }

  getEvidenceAttachmentOpenTarget(attachmentId: string): string {
    const relativePath = this.repository.getEvidenceAttachmentPath(attachmentId)
    if (!relativePath) throw notFound('成果附件')
    return resolveWithin(this.workspaceManager.getCurrentPath(), relativePath)
  }

  async maybeCreateAutomaticBackup(
    intervalHours: number,
    retention: BackupRetentionPolicy,
    timezone: string
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
    const allBackups = this.repository.listBackups()
    const automaticBackups = allBackups
      .filter((backup) => backup.kind === 'automatic')
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    const retainedIds = new Set(
      selectAutomaticBackupsToRetain(automaticBackups, retention, timezone)
    )
    const newestVerified = allBackups.find((backup) => backup.verifiedAt !== null)
    if (newestVerified) retainedIds.add(newestVerified.id)
    for (const expired of automaticBackups.filter((backup) => !retainedIds.has(backup.id))) {
      const path = resolveWithin(root, expired.relativePath)
      try {
        await unlink(path)
        this.repository.deleteBackupRecord(expired.id)
      } catch (error) {
        if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') {
          this.repository.deleteBackupRecord(expired.id)
        }
      }
    }
    return created
  }

  async getBackupStorageStatus(): Promise<BackupStorageStatus> {
    const root = this.workspaceManager.getCurrentPath()
    const backups = this.repository.listBackups()
    const nextEstimatedBytes = Math.max(1, await this.packages.estimateSourceBytes(root))
    const filesystem = await statfs(root, { bigint: true })
    const freeBytes = bigintToSafeNumber(filesystem.bavail * filesystem.bsize)
    const reserveBytes = Math.max(16 * 1024 * 1024, Math.ceil(nextEstimatedBytes * 0.1))
    const requiredFreeBytes = Math.min(
      Number.MAX_SAFE_INTEGER,
      nextEstimatedBytes * 2 + reserveBytes
    )
    return {
      backupCount: backups.length,
      totalBytes: backups.reduce((total, backup) => total + backup.sizeBytes, 0),
      nextEstimatedBytes,
      freeBytes,
      requiredFreeBytes,
      canCreate: freeBytes >= requiredFreeBytes
    }
  }

  async createBackup(
    label: string,
    kind: BackupInfo['kind'] = 'manual',
    directory = 'backups'
  ): Promise<BackupInfo> {
    const root = this.workspaceManager.getCurrentPath()
    const storage = await this.getBackupStorageStatus()
    if (!storage.canCreate) {
      throw new YouTraceError({
        code: 'BACKUP_SPACE_INSUFFICIENT',
        message: '可用空间不足，未创建新备份。',
        details: { ...storage },
        recovery: '请释放工作区所在磁盘空间或迁移工作区；现有已验证备份没有被删除。'
      })
    }
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
    const normalizedTarget = validateDestination(targetRoot, sourceRoot)
    const startedAt = new Date().toISOString()
    await this.workspaceManager.setPendingMigration({
      operationId: randomUUID(),
      workspaceId: this.workspaceManager.getCurrent()!.id,
      sourcePath: sourceRoot,
      targetPath: normalizedTarget,
      stage: 'preflight',
      startedAt,
      updatedAt: startedAt,
      reportPath: null,
      failureCode: null,
      failureReason: null
    })
    let result: RestoreResult
    try {
      const backup = await this.createBackup('根目录迁移前恢复点', 'pre_migration')
      const archivePath = resolveWithin(sourceRoot, backup.relativePath)
      result = await this.restoreArchive(
        archivePath,
        normalizedTarget,
        sourceRoot,
        'migration'
      )
    } catch (error) {
      const pending = await this.workspaceManager.getPendingMigration()
      if (pending && pending.stage !== 'failed') {
        await this.workspaceManager
          .setPendingMigration({
            ...pending,
            stage: 'failed',
            updatedAt: new Date().toISOString(),
            failureCode: storageErrorCode(error),
            failureReason: error instanceof Error ? error.message : String(error)
          })
          .catch(() => undefined)
      }
      throw error
    }
    await this.workspaceManager.setPendingMigration(null).catch(() => undefined)
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
    ).catch(() => undefined)
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
    const candidate = this.repository.listTrash().find((item) => item.id === id)
    if (
      candidate &&
      !candidate.parentAvailable &&
      (candidate.entityType === 'goal' || candidate.entityType === 'milestone')
    ) {
      throw new YouTraceError({
        code: 'TRASH_PARENT_RESTORE_REQUIRED',
        message: '请先恢复这个内容所属的项目，再恢复当前内容。'
      })
    }
    const item = this.repository.restoreTrash(id, new Date().toISOString())
    if (!item) throw notFound('回收站内容')
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
    if (!result) throw notFound('回收站内容')
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
    const evidenceId = randomUUID()
    const prepared = await this.prepareEvidenceAttachment(sourcePath)
    try {
      const evidence = this.repository.insertEvidenceFile(
        evidenceId,
        prepared.attachment,
        input,
        new Date().toISOString()
      )
      return { evidence, attachment: prepared.attachment }
    } catch (error) {
      if (prepared.createdFile) await unlink(prepared.destination).catch(() => undefined)
      throw error
    }
  }

  listEvidenceAttachments(evidenceId: string): EvidenceAttachment[] {
    if (!this.repository.hasEvidence(evidenceId)) throw notFound('成果')
    return this.repository.listEvidenceAttachments(evidenceId)
  }

  async attachEvidenceFile(
    sourcePath: string,
    evidenceId: string
  ): Promise<ImportedEvidence['attachment']> {
    if (!this.repository.hasEvidence(evidenceId)) throw notFound('成果')
    const prepared = await this.prepareEvidenceAttachment(sourcePath)
    try {
      if (
        !this.repository.attachEvidenceFile(
          evidenceId,
          prepared.attachment,
          new Date().toISOString()
        )
      ) {
        throw notFound('成果')
      }
      return prepared.attachment
    } catch (error) {
      if (prepared.createdFile) await unlink(prepared.destination).catch(() => undefined)
      throw error
    }
  }

  private async prepareEvidenceAttachment(sourcePath: string): Promise<{
    attachment: ImportedEvidence['attachment'] & { mimeType: string | null }
    destination: string
    createdFile: boolean
  }> {
    const sourceInfo = await stat(sourcePath)
    if (!sourceInfo.isFile()) {
      throw new YouTraceError({
        code: 'FILE_NOT_REGULAR',
        message: '选择的内容不是普通文件。'
      })
    }
    const hash = await hashFile(sourcePath)
    const existing = this.repository.findAttachmentByHash(hash)
    const root = this.workspaceManager.getCurrentPath()
    const attachmentId = existing?.id ?? randomUUID()
    const originalName = basename(sourcePath)
    const extension = safeExtension(extname(originalName))
    const month = new Date().toISOString().slice(0, 7).replace('-', '/')
    const relativePath =
      existing?.relativePath ?? `evidence/${month}/${attachmentId}${extension}`
    const destination = resolveWithin(root, relativePath)
    let createdFile = false
    if (!existing) {
      await mkdir(dirname(destination), { recursive: true })
      const temporary = resolveWithin(root, `temp/import-${randomUUID()}${extension}`)
      await copyFile(sourcePath, temporary)
      const copiedHash = await hashFile(temporary)
      if (copiedHash !== hash) {
        await unlink(temporary).catch(() => undefined)
        throw new YouTraceError({
          code: 'FILE_COPY_VERIFY_FAILED',
          message: '文件复制后的哈希不一致。'
        })
      }
      await rename(temporary, destination)
      createdFile = true
    }
    return {
      attachment: {
        id: attachmentId,
        relativePath,
        originalName: existing?.originalName ?? originalName,
        contentHash: hash,
        sizeBytes: existing?.sizeBytes ?? sourceInfo.size,
        mimeType: mimeFromExtension(extension),
        reused: Boolean(existing)
      },
      destination,
      createdFile
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
      await preflightDestination(targetRoot, verification.totalBytes)
      if (operation === 'migration') {
        await this.writeIncompleteMigrationMarker(targetRoot)
        await this.updateMigrationStage('copying')
      }
      await this.packages.extractVerified(archivePath, targetRoot)
      for (const directory of REQUIRED_DIRECTORIES) {
        await mkdir(join(targetRoot, directory), { recursive: true })
      }
      if (operation === 'migration') await this.updateMigrationStage('verifying')
      await validateExtractedWorkspace(targetRoot, verification.manifest)
      const reportPath = join(targetRoot, 'migration-reports', reportName)
      await writeFile(
        reportPath,
        JSON.stringify(
          {
            operation,
            status: 'validated',
            validatedAt: new Date().toISOString(),
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
      if (operation === 'migration') {
        await this.updateMigrationStage('opening', reportPath)
      }
      const workspace = await this.workspaceManager.open(targetRoot, false)
      if (operation === 'migration') {
        await unlink(join(targetRoot, INCOMPLETE_MIGRATION_FILE)).catch(() => undefined)
      }
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
      ).catch(() => undefined)
      return { workspace, sourcePreservedAt: sourceRoot, reportPath }
    } catch (error) {
      const recoverableError = toRecoverableStorageError(error)
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
            reason:
              recoverableError instanceof Error
                ? recoverableError.message
                : String(recoverableError)
          },
          null,
          2
        ),
        'utf8'
      ).catch(() => undefined)
      if (operation === 'migration') {
        const pending = await this.workspaceManager.getPendingMigration()
        if (pending) {
          await this.workspaceManager
            .setPendingMigration({
              ...pending,
              stage: 'failed',
              updatedAt: new Date().toISOString(),
              reportPath: sourceReport,
              failureCode: storageErrorCode(recoverableError),
              failureReason:
                recoverableError instanceof Error
                  ? recoverableError.message
                  : String(recoverableError)
            })
            .catch(() => undefined)
        }
      }
      throw recoverableError
    }
  }

  private async updateMigrationStage(
    stage: MigrationRecoveryState['stage'],
    reportPath: string | null = null
  ): Promise<void> {
    const pending = await this.workspaceManager.getPendingMigration()
    if (!pending) return
    await this.workspaceManager.setPendingMigration({
      ...pending,
      stage,
      updatedAt: new Date().toISOString(),
      reportPath: reportPath ?? pending.reportPath,
      failureCode: null,
      failureReason: null
    })
  }

  private async writeIncompleteMigrationMarker(targetRoot: string): Promise<void> {
    const pending = await this.workspaceManager.getPendingMigration()
    if (!pending) return
    await writeFile(
      join(targetRoot, INCOMPLETE_MIGRATION_FILE),
      JSON.stringify(
        {
          product: 'YouTrace',
          operationId: pending.operationId,
          workspaceId: pending.workspaceId,
          sourcePath: pending.sourcePath,
          targetPath: pending.targetPath,
          startedAt: pending.startedAt
        },
        null,
        2
      ),
      { encoding: 'utf8', flag: 'wx' }
    )
  }

  private requireBackup(id: string): BackupInfo {
    const backup = this.repository.getBackup(id)
    if (!backup) throw notFound('备份')
    return backup
  }
}

export interface BackupRetentionPolicy {
  daily: number
  weekly: number
  monthly: number
}

export function selectAutomaticBackupsToRetain(
  backups: BackupInfo[],
  policy: BackupRetentionPolicy,
  timezone: string
): string[] {
  const sorted = [...backups]
    .filter((backup) => backup.kind === 'automatic' && backup.verifiedAt !== null)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  const retained = new Set<string>()
  retainNewestBuckets(sorted, policy.daily, (value) => calendarParts(value, timezone).day, retained)
  retainNewestBuckets(sorted, policy.weekly, (value) => weekKey(value, timezone), retained)
  retainNewestBuckets(
    sorted,
    policy.monthly,
    (value) => calendarParts(value, timezone).month,
    retained
  )
  if (sorted[0]) retained.add(sorted[0].id)
  return [...retained]
}

function retainNewestBuckets(
  backups: BackupInfo[],
  limit: number,
  keyFor: (createdAt: string) => string,
  retained: Set<string>
): void {
  const buckets = new Set<string>()
  for (const backup of backups) {
    const key = keyFor(backup.createdAt)
    if (buckets.has(key)) continue
    if (buckets.size >= limit) break
    buckets.add(key)
    retained.add(backup.id)
  }
}

function calendarParts(
  value: string,
  timezone: string
): { year: number; monthNumber: number; dayNumber: number; day: string; month: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date(value))
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? ''
  const year = Number(get('year'))
  const month = get('month')
  const day = get('day')
  return {
    year,
    monthNumber: Number(month),
    dayNumber: Number(day),
    day: `${year}-${month}-${day}`,
    month: `${year}-${month}`
  }
}

function weekKey(value: string, timezone: string): string {
  const parts = calendarParts(value, timezone)
  const date = new Date(Date.UTC(parts.year, parts.monthNumber - 1, parts.dayNumber))
  const daysSinceMonday = (date.getUTCDay() + 6) % 7
  date.setUTCDate(date.getUTCDate() - daysSinceMonday)
  return date.toISOString().slice(0, 10)
}

function bigintToSafeNumber(value: bigint): number {
  return value > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(value)
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
    if (manifest.recordCounts) {
      const actualCounts = collectRecordCounts(database)
      const mismatches = Object.keys({ ...manifest.recordCounts, ...actualCounts })
        .sort()
        .filter((table) => manifest.recordCounts?.[table] !== actualCounts[table])
        .map((table) => ({
          table,
          expected: manifest.recordCounts?.[table] ?? null,
          actual: actualCounts[table] ?? null
        }))
      if (mismatches.length > 0) {
        throw new YouTraceError({
          code: 'RESTORE_RECORD_COUNT_MISMATCH',
          message: '恢复出的数据库记录数量与备份清单不一致。',
          details: { mismatches },
          recovery: '请继续使用源工作区，并重新创建备份后重试。'
        })
      }
    }
    const references = database
      .prepare(
        `SELECT DISTINCT relative_path
           FROM attachments
          WHERE pending_cleanup_at IS NULL`
      )
      .all() as Array<{ relative_path: string }>
    const missingReferences: string[] = []
    for (const reference of references) {
      try {
        const referenceInfo = await stat(resolveWithin(root, reference.relative_path))
        if (!referenceInfo.isFile()) missingReferences.push(reference.relative_path)
      } catch {
        missingReferences.push(reference.relative_path)
      }
    }
    if (missingReferences.length > 0) {
      throw new YouTraceError({
        code: 'RESTORE_REFERENCE_MISSING',
        message: '恢复出的工作区缺少数据库引用的文件。',
        details: { missingReferences },
        recovery: '请继续使用源工作区，并检查备份中的附件和证据文件。'
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

async function removeIncompleteMigrationTarget(
  pending: MigrationRecoveryState
): Promise<void> {
  const targetRoot = validateDestination(pending.targetPath, pending.sourcePath)
  try {
    const targetInfo = await stat(targetRoot)
    if (!targetInfo.isDirectory()) {
      throw new YouTraceError({
        code: 'MIGRATION_TARGET_IDENTITY_MISMATCH',
        message: '失败迁移的目标路径现在不是文件夹，未执行清理。'
      })
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') return
    throw error
  }

  const entries = await readdir(targetRoot)
  if (entries.length === 0) {
    await rm(targetRoot, { recursive: true, force: true })
    return
  }

  let marker: {
    product?: string
    operationId?: string
    workspaceId?: string
    sourcePath?: string
    targetPath?: string
  }
  try {
    marker = JSON.parse(
      await readFile(join(targetRoot, INCOMPLETE_MIGRATION_FILE), 'utf8')
    ) as typeof marker
  } catch {
    throw new YouTraceError({
      code: 'MIGRATION_TARGET_IDENTITY_MISMATCH',
      message: '目标目录缺少匹配的失败迁移标识，未执行清理。',
      recovery: '请检查目录内容；有迹不会删除无法确认身份的目录。'
    })
  }
  if (
    marker.product !== 'YouTrace' ||
    marker.operationId !== pending.operationId ||
    marker.workspaceId !== pending.workspaceId ||
    resolve(marker.sourcePath ?? '') !== resolve(pending.sourcePath) ||
    resolve(marker.targetPath ?? '') !== targetRoot
  ) {
    throw new YouTraceError({
      code: 'MIGRATION_TARGET_IDENTITY_MISMATCH',
      message: '目标目录与失败迁移记录不匹配，未执行清理。',
      recovery: '请返回源工作区，或手动检查目标目录。'
    })
  }
  await rm(targetRoot, { recursive: true, force: true })
}

function toRecoverableStorageError(error: unknown): unknown {
  if (error instanceof YouTraceError) return error
  const code = (error as NodeJS.ErrnoException | null)?.code
  if (code === 'ENOSPC') {
    return new YouTraceError({
      code: 'TARGET_SPACE_INSUFFICIENT',
      message: '目标磁盘空间不足，工作区未切换。',
      recovery: '请释放目标磁盘空间或改选目录后重试；当前工作区仍可继续使用。'
    })
  }
  if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') {
    return new YouTraceError({
      code: 'TARGET_NOT_WRITABLE',
      message: '目标目录不可写，工作区未切换。',
      recovery: '请检查目录权限或改选可写目录；当前工作区仍可继续使用。'
    })
  }
  return error
}

function storageErrorCode(error: unknown): string {
  if (error instanceof YouTraceError) return error.code
  return (error as NodeJS.ErrnoException | null)?.code ?? 'MIGRATION_FAILED'
}

async function preflightDestination(targetRoot: string, packageBytes: number): Promise<void> {
  await mkdir(targetRoot, { recursive: true })
  const probePath = join(targetRoot, `.youtrace-target-probe-${randomUUID()}`)
  try {
    await writeFile(probePath, 'probe', { encoding: 'utf8', flag: 'wx' })
    await unlink(probePath)
  } catch (error) {
    await unlink(probePath).catch(() => undefined)
    throw toRecoverableStorageError(
      Object.assign(error instanceof Error ? error : new Error(String(error)), {
        code: (error as NodeJS.ErrnoException | null)?.code ?? 'EACCES'
      })
    )
  }

  const volume = await statfs(targetRoot, { bigint: true })
  const extractedBytes = BigInt(Math.ceil(packageBytes))
  const reserveBytes =
    extractedBytes / 10n > 16n * 1024n * 1024n
      ? extractedBytes / 10n
      : 16n * 1024n * 1024n
  const requiredBytes = extractedBytes + reserveBytes
  const availableBytes = volume.bavail * volume.bsize
  if (availableBytes < requiredBytes) {
    throw new YouTraceError({
      code: 'TARGET_SPACE_INSUFFICIENT',
      message: '目标磁盘空间不足，工作区未切换。',
      details: {
        requiredBytes: requiredBytes.toString(),
        availableBytes: availableBytes.toString()
      },
      recovery: '请释放目标磁盘空间或改选目录后重试；当前工作区仍可继续使用。'
    })
  }
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

function recoveryDraftPath(root: string, key: string): string {
  const fileName = `${createHash('sha256').update(key, 'utf8').digest('hex')}.json`
  return join(root, 'recovery', 'drafts', fileName)
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
