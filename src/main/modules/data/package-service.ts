import { createHash, randomUUID } from 'node:crypto'
import {
  createReadStream,
  createWriteStream
} from 'node:fs'
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
} from 'node:fs/promises'
import { dirname, join, posix, relative, resolve, sep } from 'node:path'
import { pipeline } from 'node:stream/promises'
import archiver from 'archiver'
import Database from 'better-sqlite3'
import * as unzipper from 'unzipper'
import { CURRENT_SCHEMA_VERSION } from '../../database/schema'
import { YouTraceError } from '../../../shared/errors'

export interface PackageManifest {
  product: 'YouTrace'
  packageFormat: 1
  workspaceId: string
  workspaceName: string
  workspaceFormatVersion: number
  schemaVersion: number
  applicationVersion: string
  createdAt: string
  files: Array<{ path: string; size: number; sha256: string }>
}

interface PackageSource {
  absolutePath: string
  archivePath: string
}

const EXCLUDED_TOP_LEVEL = new Set(['backups', 'exports', 'logs', 'temp'])

export class PackageService {
  async create(
    workspaceRoot: string,
    database: Database.Database,
    destinationPath: string,
    applicationVersion: string
  ): Promise<{ manifest: PackageManifest; manifestHash: string; sizeBytes: number }> {
    const marker = JSON.parse(
      await readFile(join(workspaceRoot, '.youtrace-workspace.json'), 'utf8')
    ) as {
      workspaceId: string
      name: string
      formatVersion: number
    }
    const temporaryRoot = join(workspaceRoot, 'temp', `package-${randomUUID()}`)
    const snapshotPath = join(temporaryRoot, 'database', 'youtrace.sqlite3')
    await mkdir(dirname(snapshotPath), { recursive: true })
    await database.backup(snapshotPath)
    const snapshotIntegrity = new Database(snapshotPath, { readonly: true })
    try {
      if (snapshotIntegrity.pragma('quick_check', { simple: true }) !== 'ok') {
        throw new YouTraceError({
          code: 'BACKUP_DATABASE_INVALID',
          message: '备份数据库快照未通过完整性检查。'
        })
      }
    } finally {
      snapshotIntegrity.close()
    }

    const sources = await this.collectSources(workspaceRoot)
    sources.push({ absolutePath: snapshotPath, archivePath: 'database/youtrace.sqlite3' })
    const files: PackageManifest['files'] = []
    for (const source of sources) {
      const info = await stat(source.absolutePath)
      files.push({
        path: source.archivePath,
        size: info.size,
        sha256: await hashFile(source.absolutePath)
      })
    }
    files.sort((left, right) => left.path.localeCompare(right.path))
    const manifest: PackageManifest = {
      product: 'YouTrace',
      packageFormat: 1,
      workspaceId: marker.workspaceId,
      workspaceName: marker.name,
      workspaceFormatVersion: marker.formatVersion,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      applicationVersion,
      createdAt: new Date().toISOString(),
      files
    }
    const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2), 'utf8')
    const manifestHash = createHash('sha256').update(manifestBytes).digest('hex')
    await mkdir(dirname(destinationPath), { recursive: true })
    const temporaryArchive = `${destinationPath}.tmp-${randomUUID()}`
    await this.writeArchive(temporaryArchive, sources, manifestBytes)
    const verification = await this.verify(temporaryArchive)
    if (verification.manifestHash !== manifestHash) {
      throw new YouTraceError({
        code: 'BACKUP_VERIFY_FAILED',
        message: '备份生成后校验不一致，未登记为可用备份。'
      })
    }
    await rename(temporaryArchive, destinationPath)
    await rm(temporaryRoot, { recursive: true, force: true })
    return {
      manifest,
      manifestHash,
      sizeBytes: (await stat(destinationPath)).size
    }
  }

  async verify(archivePath: string): Promise<{
    manifest: PackageManifest
    manifestHash: string
    totalBytes: number
  }> {
    let archive: unzipper.CentralDirectory
    try {
      archive = await unzipper.Open.file(archivePath)
    } catch {
      throw invalidPackage('无法打开压缩包。')
    }
    for (const entry of archive.files) assertSafeArchivePath(entry.path)
    const manifestEntry = archive.files.find((entry) => entry.path === 'manifest.json')
    if (!manifestEntry) throw invalidPackage('压缩包缺少 manifest.json。')
    const manifestBytes = await manifestEntry.buffer()
    let manifest: PackageManifest
    try {
      manifest = JSON.parse(manifestBytes.toString('utf8')) as PackageManifest
    } catch {
      throw invalidPackage('压缩包清单不是有效 JSON。')
    }
    if (manifest.product !== 'YouTrace' || manifest.packageFormat !== 1) {
      throw invalidPackage('压缩包产品标识或格式版本不受支持。')
    }
    const entries = new Map(archive.files.map((entry) => [entry.path, entry]))
    let totalBytes = 0
    for (const expected of manifest.files) {
      assertSafeArchivePath(expected.path)
      const entry = entries.get(expected.path)
      if (!entry || entry.type === 'Directory') {
        throw invalidPackage(`压缩包缺少文件：${expected.path}`)
      }
      const actual = await hashStream(entry.stream())
      if (actual.size !== expected.size || actual.sha256 !== expected.sha256) {
        throw invalidPackage(`文件校验失败：${expected.path}`)
      }
      totalBytes += actual.size
    }
    return {
      manifest,
      manifestHash: createHash('sha256').update(manifestBytes).digest('hex'),
      totalBytes
    }
  }

  async extractVerified(archivePath: string, targetRoot: string): Promise<PackageManifest> {
    const verification = await this.verify(archivePath)
    const archive = await unzipper.Open.file(archivePath)
    const entries = new Map(archive.files.map((entry) => [entry.path, entry]))
    const resolvedRoot = resolve(targetRoot)
    await mkdir(resolvedRoot, { recursive: true })
    for (const file of verification.manifest.files) {
      const destination = resolve(resolvedRoot, ...file.path.split('/'))
      const allowedPrefix = `${resolvedRoot}${sep}`
      if (!destination.startsWith(allowedPrefix)) throw invalidPackage('压缩包路径逃逸目标目录。')
      await mkdir(dirname(destination), { recursive: true })
      const entry = entries.get(file.path)
      if (!entry) throw invalidPackage(`解包时缺少文件：${file.path}`)
      await pipeline(entry.stream(), createWriteStream(destination, { flags: 'wx' }))
    }
    return verification.manifest
  }

  private async collectSources(workspaceRoot: string): Promise<PackageSource[]> {
    const output: PackageSource[] = []
    const visit = async (directory: string): Promise<void> => {
      const entries = await readdir(directory, { withFileTypes: true })
      for (const entry of entries) {
        const absolutePath = join(directory, entry.name)
        const archivePath = relative(workspaceRoot, absolutePath).split(sep).join('/')
        const topLevel = archivePath.split('/')[0] ?? ''
        if (
          EXCLUDED_TOP_LEVEL.has(topLevel) ||
          archivePath === '.youtrace.lock' ||
          archivePath === 'database/youtrace.sqlite3' ||
          archivePath.startsWith('database/youtrace.sqlite3-')
        ) {
          continue
        }
        if (entry.isSymbolicLink()) {
          throw new YouTraceError({
            code: 'WORKSPACE_SYMLINK_UNSUPPORTED',
            message: `备份拒绝跟随工作区符号链接：${archivePath}`
          })
        }
        if (entry.isDirectory()) await visit(absolutePath)
        else if (entry.isFile()) output.push({ absolutePath, archivePath })
      }
    }
    await visit(workspaceRoot)
    return output
  }

  private async writeArchive(
    archivePath: string,
    sources: PackageSource[],
    manifest: Buffer
  ): Promise<void> {
    await new Promise<void>((resolvePromise, reject) => {
      const output = createWriteStream(archivePath, { flags: 'wx' })
      const archive = archiver('zip', { zlib: { level: 6 } })
      output.on('close', resolvePromise)
      output.on('error', reject)
      archive.on('error', reject)
      archive.pipe(output)
      for (const source of sources) {
        archive.file(source.absolutePath, { name: source.archivePath })
      }
      archive.append(manifest, { name: 'manifest.json' })
      void archive.finalize()
    })
  }
}

async function hashFile(path: string): Promise<string> {
  return (await hashStream(createReadStream(path))).sha256
}

async function hashStream(stream: NodeJS.ReadableStream): Promise<{ sha256: string; size: number }> {
  const hash = createHash('sha256')
  let size = 0
  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string)
    size += bytes.length
    hash.update(bytes)
  }
  return { sha256: hash.digest('hex'), size }
}

function assertSafeArchivePath(value: string): void {
  const normalized = posix.normalize(value.replaceAll('\\', '/'))
  if (
    value.includes('\0') ||
    normalized.startsWith('../') ||
    normalized === '..' ||
    normalized.startsWith('/') ||
    /^[A-Za-z]:/.test(normalized)
  ) {
    throw invalidPackage(`压缩包包含不安全路径：${value}`)
  }
}

function invalidPackage(reason: string): YouTraceError {
  return new YouTraceError({
    code: 'YTRACE_PACKAGE_INVALID',
    message: '有迹便携包未通过校验。',
    details: { reason },
    recovery: '请选择由有迹生成且未被修改的 .ytrace 文件。'
  })
}
