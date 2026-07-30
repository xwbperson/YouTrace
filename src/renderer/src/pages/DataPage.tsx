import * as Dialog from '@radix-ui/react-dialog'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArchiveRestore,
  CheckCircle2,
  DatabaseBackup,
  Download,
  FileArchive,
  FileCheck2,
  FolderInput,
  HardDrive,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Upload,
  X
} from 'lucide-react'
import { useState } from 'react'
import type { BackupInfo, IpcResult, TrashItem, WorkspaceCheck } from '../../../shared/contracts'

function unwrap<T>(result: IpcResult<T>): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.data
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`
  if (bytes < 1024 ** 3) return `${Math.round(bytes / 1024 ** 2 * 10) / 10} MB`
  return `${Math.round(bytes / 1024 ** 3 * 10) / 10} GB`
}

export function DataPage(): React.JSX.Element {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<'safety' | 'trash'>('safety')
  const [check, setCheck] = useState<WorkspaceCheck | null>(null)
  const [selectedBackupId, setSelectedBackupId] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [purgeItem, setPurgeItem] = useState<TrashItem | null>(null)
  const backupsQuery = useQuery({
    queryKey: ['backups'],
    queryFn: async () => unwrap(await window.youtrace.data.listBackups())
  })
  const trashQuery = useQuery({
    queryKey: ['trash'],
    queryFn: async () => unwrap(await window.youtrace.data.listTrash())
  })
  const backups = backupsQuery.data ?? []
  const trash = trashQuery.data ?? []

  const run = async (label: string, operation: () => Promise<IpcResult<unknown>>): Promise<boolean> => {
    setBusy(label)
    setError('')
    setMessage('')
    const result = await operation()
    setBusy('')
    if (!result.ok) {
      setError(result.error.message)
      return false
    }
    setMessage(`${label}已完成。`)
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['backups'] }),
      queryClient.invalidateQueries({ queryKey: ['trash'] })
    ])
    return true
  }

  const chooseEmptyDirectory = async (): Promise<string | null> => {
    const result = await window.youtrace.dialog.selectDirectory()
    return result.ok ? result.data : null
  }

  const restore = async (): Promise<void> => {
    if (!selectedBackupId) return
    const targetRoot = await chooseEmptyDirectory()
    if (!targetRoot) return
    if (await run('恢复', () => window.youtrace.data.restoreBackup({ backupId: selectedBackupId, targetRoot }))) {
      window.location.reload()
    }
  }

  const migrate = async (): Promise<void> => {
    const targetRoot = await chooseEmptyDirectory()
    if (!targetRoot) return
    if (await run('迁移', () => window.youtrace.data.migrateWorkspace({ targetRoot }))) {
      window.location.reload()
    }
  }

  const importPortable = async (): Promise<void> => {
    const targetRoot = await chooseEmptyDirectory()
    if (!targetRoot) return
    if (await run('导入', () => window.youtrace.data.importPortable(targetRoot))) {
      window.location.reload()
    }
  }

  const restoreTrashItem = async (item: TrashItem): Promise<void> => {
    if (
      await run('恢复', () =>
        window.youtrace.data.restoreTrash({ id: item.id, confirmation: '' })
      )
    ) {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['projects'] }),
        queryClient.invalidateQueries({ queryKey: ['tasks'] }),
        queryClient.invalidateQueries({ queryKey: ['reviews'] }),
        queryClient.invalidateQueries({ queryKey: ['evidence'] }),
        queryClient.invalidateQueries({ queryKey: ['project-history'] }),
        queryClient.invalidateQueries({ queryKey: ['all-tasks-for-records'] })
      ])
    }
  }

  return (
    <div className="data-page">
      <header className="data-toolbar">
        <div><span className="page-kicker">验证后才算安全</span><h1>数据中心</h1><p>备份、迁移和恢复始终保留源工作区，不自动合并或删除。</p></div>
      </header>
      <div className="data-tabs" role="tablist" aria-label="数据管理视图">
        <button role="tab" aria-selected={tab === 'safety'} className={tab === 'safety' ? 'active' : ''} onClick={() => setTab('safety')}>备份与迁移</button>
        <button role="tab" aria-selected={tab === 'trash'} className={tab === 'trash' ? 'active' : ''} onClick={() => setTab('trash')}>回收站 <span>{trash.length}</span></button>
      </div>

      {tab === 'safety' ? (
        <div className="data-safety-grid">
          <section className="data-actions-panel panel">
            <header><span><ShieldCheck size={18} /></span><div><h2>工作区检查</h2><p>检查 SQLite、schema 和附件引用。</p></div></header>
            <button className="data-operation" type="button" onClick={async () => {
              setBusy('检查')
              const result = await window.youtrace.data.checkWorkspace()
              setBusy('')
              if (result.ok) { setCheck(result.data); setMessage('工作区检查已完成。') } else setError(result.error.message)
            }}><RefreshCw size={17} /><span><strong>运行完整性检查</strong><small>{busy === '检查' ? '正在检查…' : '只读检查，不修改业务数据'}</small></span></button>
            <button className="data-operation" type="button" onClick={() => void run('备份', () => window.youtrace.data.createBackup('手动备份'))}><DatabaseBackup size={17} /><span><strong>创建已验证备份</strong><small>在线 SQLite 快照 + 文件清单 SHA-256</small></span></button>
            <button className="data-operation" type="button" onClick={() => void run('可读导出', () => window.youtrace.data.exportReadable())}><Download size={17} /><span><strong>导出 Markdown / CSV</strong><small>用于查看和分析，不作为实时数据库</small></span></button>
            <button className="data-operation" type="button" onClick={() => void run('便携导出', () => window.youtrace.data.exportPortable())}><FileArchive size={17} /><span><strong>导出 .ytrace 便携包</strong><small>完整工作区传输载体</small></span></button>
            <button className="data-operation" type="button" onClick={() => void migrate()}><FolderInput size={17} /><span><strong>迁移工作区根目录</strong><small>复制—校验—试开—切换，源目录保留</small></span></button>
            <button className="data-operation" type="button" onClick={() => void importPortable()}><Upload size={17} /><span><strong>导入 .ytrace 到新工作区</strong><small>隔离校验，不与当前工作区合并</small></span></button>
          </section>
          <section className="backup-panel panel">
            <header><div><span className="section-label">已验证恢复点</span><h2>备份</h2></div><strong>{backups.length}</strong></header>
            {check && <div className={`workspace-check ${check.missingFiles.length > 0 ? 'warning' : ''}`}><CheckCircle2 size={16} /><div><strong>数据库 {check.databaseIntegrity} · schema v{check.schemaVersion}</strong><span>{check.fileCount} 个文件 · {formatBytes(check.totalBytes)} · {check.missingFiles.length} 个缺失引用</span></div></div>}
            <div className="backup-list">
              {backups.map((backup) => <label key={backup.id} className={backup.id === selectedBackupId ? 'selected' : ''}><input type="radio" name="backup" checked={backup.id === selectedBackupId} onChange={() => setSelectedBackupId(backup.id)} /><FileCheck2 size={16} /><span><strong>{backup.label}</strong><small>{new Date(backup.createdAt).toLocaleString('zh-CN')} · {formatBytes(backup.sizeBytes)}</small></span><em>{backup.verifiedAt ? '已验证' : '未验证'}</em></label>)}
              {backups.length === 0 && <div className="backup-empty"><HardDrive size={24} /><strong>还没有备份</strong><p>创建第一份备份后，可以在这里验证和恢复。</p></div>}
            </div>
            <footer>
              <button className="button button-secondary" disabled={!selectedBackupId} onClick={() => void run('校验', () => window.youtrace.data.verifyBackup(selectedBackupId))}><ShieldCheck size={14} />重新校验</button>
              <button className="button button-primary" disabled={!selectedBackupId} onClick={() => void restore()}><ArchiveRestore size={14} />恢复到新目录</button>
            </footer>
          </section>
        </div>
      ) : (
        <section className="trash-panel panel">
          <header><div><span className="section-label">软删除与可恢复关系</span><h2>回收站</h2><p>努力记录不会随任务或项目删除，复盘调整也不会因删除复盘而撤销。</p></div></header>
          {trash.length === 0 ? <div className="trash-empty"><Trash2 size={27} /><strong>回收站为空</strong><p>删除的项目、任务、成果和复盘会先来到这里。</p></div> : <div className="trash-list">{trash.map((item) => <article key={item.id}><span><Trash2 size={16} /></span><div><strong>{item.title}</strong><small>{trashEntityLabel(item.entityType)} · {new Date(item.deletedAt).toLocaleString('zh-CN')}</small>{!item.parentAvailable && <em>原父对象不可用，恢复后进入未归属内容</em>}</div><div className="trash-relations">{item.entityType === 'review' ? <span>正文与原快照保留</span> : <><span>{item.attachmentCount} 个附件</span>{item.sharedAttachmentCount > 0 && <span>{item.sharedAttachmentCount} 个共享附件受保护</span>}</>}</div><button className="button button-secondary" type="button" onClick={() => void restoreTrashItem(item)}><ArchiveRestore size={13} />恢复</button><button className="trash-purge" type="button" onClick={() => setPurgeItem(item)}>永久删除</button></article>)}</div>}
        </section>
      )}
      {(message || error) && <div className={`data-feedback ${error ? 'error' : ''}`} role={error ? 'alert' : 'status'} aria-live={error ? 'assertive' : 'polite'}>{error || message}<button aria-label="关闭提示" onClick={() => { setError(''); setMessage('') }}><X size={13} /></button></div>}
      <PurgeDialog item={purgeItem} onOpenChange={(open) => { if (!open) setPurgeItem(null) }} onPurged={async () => { setPurgeItem(null); await queryClient.invalidateQueries({ queryKey: ['trash'] }) }} />
    </div>
  )
}

function PurgeDialog(props: { item: TrashItem | null; onOpenChange: (open: boolean) => void; onPurged: () => Promise<void> }): React.JSX.Element {
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')
  const submit = async (): Promise<void> => {
    if (!props.item) return
    const result = await window.youtrace.data.purgeTrash({ id: props.item.id, confirmation })
    if (!result.ok) return setError(result.error.message)
    setConfirmation('')
    await props.onPurged()
  }
  return <Dialog.Root open={props.item !== null} onOpenChange={props.onOpenChange}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="dialog-content destructive-dialog"><div className="dialog-heading"><div><span className="section-label">不可恢复操作</span><Dialog.Title>永久删除“{props.item?.title}”</Dialog.Title><Dialog.Description>{props.item?.entityType === 'review' ? '复盘正文、快照和调整记录会被清除；已经作用到任务上的调整不会撤销。' : '共享附件仍会保留；独占文件只有在存在已验证备份时才允许清理。'}</Dialog.Description></div><Dialog.Close className="dialog-close" aria-label="关闭"><X size={18} /></Dialog.Close></div><div className="dialog-form"><label><span>输入“永久删除”确认</span><input autoFocus value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>{error && <div className="inline-error">{error}</div>}</div><div className="dialog-actions"><Dialog.Close className="button button-secondary">取消</Dialog.Close><button className="button button-danger" disabled={confirmation !== '永久删除'} onClick={() => void submit()}>永久删除</button></div></Dialog.Content></Dialog.Portal></Dialog.Root>
}

function trashEntityLabel(entityType: TrashItem['entityType']): string {
  return { project: '项目', task: '任务', review: '复盘', evidence: '成果' }[entityType]
}
