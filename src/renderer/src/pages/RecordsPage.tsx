import * as Dialog from '@radix-ui/react-dialog'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Award,
  CheckCircle2,
  Clock3,
  ExternalLink,
  FileCheck2,
  Image,
  Link2,
  History,
  Paperclip,
  Pencil,
  Plus,
  TimerReset,
  Trash2,
  X
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type {
  EffortEntry,
  Evidence,
  EvidenceAttachment,
  IpcResult,
  Task
} from '../../../shared/contracts'
import { QueryFailure } from '../components/QueryFeedback'

function unwrap<T>(result: IpcResult<T>): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.data
}

export function RecordsPage(): React.JSX.Element {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<'effort' | 'evidence'>('effort')
  const [manualDialogOpen, setManualDialogOpen] = useState(false)
  const [evidenceDialogOpen, setEvidenceDialogOpen] = useState(false)
  const [editingEvidence, setEditingEvidence] = useState<Evidence | null>(null)
  const [deletingEvidence, setDeletingEvidence] = useState<Evidence | null>(null)
  const [selectedEffort, setSelectedEffort] = useState<EffortEntry | null>(null)

  const effortsQuery = useQuery({
    queryKey: ['efforts'],
    queryFn: async () =>
      unwrap(
        await window.youtrace.execution.listEfforts({
          entityType: null,
          entityId: null,
          from: null,
          to: null,
          limit: 200,
          offset: 0
        })
      )
  })
  const summaryQuery = useQuery({
    queryKey: ['effort-summary'],
    queryFn: async () => unwrap(await window.youtrace.execution.summarizeEfforts(null, null))
  })
  const evidenceQuery = useQuery({
    queryKey: ['evidence'],
    queryFn: async () => unwrap(await window.youtrace.execution.listEvidence(null, null))
  })
  const tasksQuery = useQuery({
    queryKey: ['all-tasks-for-records'],
    queryFn: async () =>
      unwrap(
        await window.youtrace.planning.listTasks({
          projectId: null,
          statuses: [],
          tagIds: [],
          includeDeleted: false,
          limit: 500,
          offset: 0
        })
      )
  })

  const totalMinutes = summaryQuery.data?.totalMinutes ?? 0
  const verified = (evidenceQuery.data ?? []).filter((item) =>
    ['verified', 'accepted'].includes(item.verificationStatus)
  ).length

  return (
    <main className="records-page">
      <header className="records-header">
        <div>
          <span className="page-kicker">永久努力账本</span>
          <h1>记录</h1>
          <p>投入是已经发生的事实，任务取消或归档也不会抹掉它。</p>
        </div>
        <div className="toolbar-actions">
          <button
            className="button button-secondary"
            onClick={() => {
              setEditingEvidence(null)
              setEvidenceDialogOpen(true)
            }}
          >
            <Award size={16} />
            添加成果
          </button>
          <button className="button button-primary" onClick={() => setManualDialogOpen(true)}>
            <Plus size={16} />
            补录投入
          </button>
        </div>
      </header>

      {(effortsQuery.isError || summaryQuery.isError || evidenceQuery.isError || tasksQuery.isError) && (
        <QueryFailure
          title="记录页面读取不完整"
          detail="投入和成果仍保存在工作区中，请重新读取后再判断是否为空。"
          onRetry={() => void Promise.all([
            effortsQuery.refetch(),
            summaryQuery.refetch(),
            evidenceQuery.refetch(),
            tasksQuery.refetch()
          ])}
        />
      )}

      <div className="record-stats">
        <article>
          <Clock3 size={18} />
          <span>
            <strong>{formatMinutes(totalMinutes)}</strong>
            累计有效投入
          </span>
        </article>
        <article>
          <TimerReset size={18} />
          <span>
            <strong>{summaryQuery.data?.entryCount ?? 0}</strong>
            努力记录
          </span>
        </article>
        <article>
          <FileCheck2 size={18} />
          <span>
            <strong>{evidenceQuery.data?.length ?? 0}</strong>
            成果证据
          </span>
        </article>
        <article>
          <CheckCircle2 size={18} />
          <span>
            <strong>{verified}</strong>
            已验证或认可
          </span>
        </article>
      </div>

      <section className="records-panel panel">
        <div className="record-tabs" role="tablist">
          <button className={tab === 'effort' ? 'active' : ''} onClick={() => setTab('effort')}>
            努力轨迹
          </button>
          <button className={tab === 'evidence' ? 'active' : ''} onClick={() => setTab('evidence')}>
            成果证据
          </button>
        </div>

        {tab === 'effort' ? (
          <div className="effort-timeline">
            {effortsQuery.isPending ? (
              <p className="rail-message" role="status">正在读取努力记录…</p>
            ) : effortsQuery.isError ? (
              <QueryFailure title="努力记录读取失败" onRetry={() => void effortsQuery.refetch()} />
            ) : (effortsQuery.data ?? []).length === 0 ? (
              <div className="record-empty">
                <TimerReset size={24} />
                <strong>还没有努力记录</strong>
                <p>从“今日”开始计时，或补录一段已经发生的投入。</p>
              </div>
            ) : (
              (effortsQuery.data ?? []).map((effort) => (
                <article key={effort.id}>
                  <span className="effort-node" />
                  <div className="effort-time">
                    <strong>{formatDate(effort.startedAt)}</strong>
                    <small>{formatTime(effort.startedAt)}</small>
                  </div>
                  <div className="effort-card">
                    <header>
                      <div>
                        <strong>{effort.entityTitle ?? '已删除来源'}</strong>
                        <span>{effort.source === 'timer' ? '计时记录' : '手动补录'}</span>
                      </div>
                      <div className="effort-card-actions"><b>{formatMinutes(effort.effectiveMinutes)}</b><button type="button" onClick={() => setSelectedEffort(effort)}><Pencil size={11} />更正</button></div>
                    </header>
                    {effort.result && <p>{effort.result}</p>}
                    {(effort.obstacles || effort.nextStep) && (
                      <footer>
                        {effort.obstacles && <span>困难：{effort.obstacles}</span>}
                        {effort.nextStep && <span>下一步：{effort.nextStep}</span>}
                      </footer>
                    )}
                  </div>
                </article>
              ))
            )}
          </div>
        ) : (
          <div className="evidence-grid">
            {evidenceQuery.isPending ? (
              <p className="rail-message" role="status">正在读取成果…</p>
            ) : evidenceQuery.isError ? (
              <QueryFailure title="成果读取失败" onRetry={() => void evidenceQuery.refetch()} />
            ) : (evidenceQuery.data ?? []).length === 0 ? (
              <div className="record-empty">
                <Award size={24} />
                <strong>还没有成果证据</strong>
                <p>添加链接、笔记、成绩或外部反馈，让完成状态能够被验证。</p>
                <button
                  className="button button-secondary"
                  type="button"
                  onClick={() => {
                    setEditingEvidence(null)
                    setEvidenceDialogOpen(true)
                  }}
                >
                  <Plus size={14} />
                  添加第一个成果
                </button>
              </div>
            ) : (
              (evidenceQuery.data ?? []).map((evidence) => (
                <EvidenceCard
                  key={evidence.id}
                  evidence={evidence}
                  onEdit={() => {
                    setEditingEvidence(evidence)
                    setEvidenceDialogOpen(true)
                  }}
                  onDelete={() => setDeletingEvidence(evidence)}
                />
              ))
            )}
          </div>
        )}
      </section>

      <ManualEffortDialog
        open={manualDialogOpen}
        onOpenChange={setManualDialogOpen}
        tasks={tasksQuery.data ?? []}
        onCreated={async () => {
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['efforts'] }),
            queryClient.invalidateQueries({ queryKey: ['tasks'] })
          ])
        }}
      />
      <EvidenceDialog
        open={evidenceDialogOpen}
        onOpenChange={(open) => {
          setEvidenceDialogOpen(open)
          if (!open) setEditingEvidence(null)
        }}
        evidence={editingEvidence}
        tasks={tasksQuery.data ?? []}
        onSaved={async () => {
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['evidence'] }),
            queryClient.invalidateQueries({ queryKey: ['trash'] })
          ])
        }}
      />
      <DeleteEvidenceDialog
        evidence={deletingEvidence}
        onOpenChange={(open) => {
          if (!open) setDeletingEvidence(null)
        }}
        onDeleted={async () => {
          setDeletingEvidence(null)
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['evidence'] }),
            queryClient.invalidateQueries({ queryKey: ['trash'] })
          ])
        }}
      />
      <CorrectEffortDialog
        effort={selectedEffort}
        onOpenChange={(open) => { if (!open) setSelectedEffort(null) }}
        onCorrected={async () => {
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['efforts'] }),
            queryClient.invalidateQueries({ queryKey: ['tasks'] })
          ])
        }}
      />
    </main>
  )
}

function CorrectEffortDialog({
  effort,
  onOpenChange,
  onCorrected
}: {
  effort: EffortEntry | null
  onOpenChange: (open: boolean) => void
  onCorrected: () => Promise<void>
}): React.JSX.Element {
  const [startedAt, setStartedAt] = useState('')
  const [endedAt, setEndedAt] = useState('')
  const [minutes, setMinutes] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const historyQuery = useQuery({
    queryKey: ['effort-history', effort?.id],
    enabled: Boolean(effort),
    queryFn: async () => unwrap(await window.youtrace.execution.listEffortHistory(effort!.id))
  })
  useEffect(() => {
    if (!effort) return
    setStartedAt(toLocalDateTime(effort.startedAt))
    setEndedAt(toLocalDateTime(effort.endedAt ?? new Date().toISOString()))
    setMinutes(effort.effectiveMinutes.toString())
  }, [effort])
  const submit = async (): Promise<void> => {
    if (!effort) return
    const result = await window.youtrace.execution.correctEffort({
      id: effort.id,
      startedAt: new Date(startedAt).toISOString(),
      endedAt: new Date(endedAt).toISOString(),
      effectiveMinutes: Number(minutes),
      reason
    })
    if (!result.ok) return setError(result.error.message)
    await onCorrected()
    setReason('')
    onOpenChange(false)
  }
  return <Dialog.Root open={effort !== null} onOpenChange={onOpenChange}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="dialog-content"><div className="dialog-heading"><div><span className="section-label">原值永久保留在修改历史</span><Dialog.Title>更正努力时间</Dialog.Title><Dialog.Description>{effort?.entityTitle}</Dialog.Description></div><Dialog.Close className="dialog-close" aria-label="关闭"><X size={18} /></Dialog.Close></div><div className="dialog-form"><div className="form-row"><label><span>开始时间</span><input type="datetime-local" value={startedAt} onChange={(event) => setStartedAt(event.target.value)} /></label><label><span>结束时间</span><input type="datetime-local" value={endedAt} onChange={(event) => setEndedAt(event.target.value)} /></label></div><label><span>有效分钟</span><input type="number" min="0" value={minutes} onChange={(event) => setMinutes(event.target.value)} /></label><label><span>更正原因（必填）</span><textarea value={reason} onChange={(event) => setReason(event.target.value)} /></label>{(historyQuery.data ?? []).length > 0 && <div className="effort-history"><strong><History size={12} />修改历史</strong>{(historyQuery.data ?? []).map((revision) => <span key={revision.id}>{new Date(revision.occurredAt).toLocaleString('zh-CN')} · {revision.before.effectiveMinutes} → {revision.after.effectiveMinutes} 分钟 · {revision.reason}</span>)}</div>}{error && <div className="inline-error">{error}</div>}</div><div className="dialog-actions"><Dialog.Close className="button button-secondary">取消</Dialog.Close><button className="button button-primary" disabled={!startedAt || !endedAt || !reason.trim()} onClick={() => void submit()}>保存更正</button></div></Dialog.Content></Dialog.Portal></Dialog.Root>
}

function EvidenceCard({
  evidence,
  onEdit,
  onDelete
}: {
  evidence: Evidence
  onEdit: () => void
  onDelete: () => void
}): React.JSX.Element {
  const icon =
    evidence.kind === 'link' ? (
      <Link2 size={17} />
    ) : evidence.kind === 'image' ? (
      <Image size={17} />
    ) : (
      <FileCheck2 size={17} />
    )
  const status = {
    prepared: '已准备',
    completed: '已完成',
    verified: '已验证',
    accepted: '已认可'
  }[evidence.verificationStatus]

  return (
    <article className="evidence-card">
      <header>
        <span>{icon}</span>
        <div className="evidence-card-actions">
          <small className={`evidence-status status-${evidence.verificationStatus}`}>{status}</small>
          <button type="button" aria-label={`编辑成果：${evidence.title}`} onClick={onEdit}>
            <Pencil size={13} />
          </button>
          <button
            className="danger"
            type="button"
            aria-label={`删除成果：${evidence.title}`}
            onClick={onDelete}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </header>
      <strong>{evidence.title}</strong>
      <p>{evidence.note || '没有补充说明。'}</p>
      <footer>
        <span>{formatDate(evidence.createdAt)}</span>
        {evidence.attachmentCount > 0 && (
          <span className="evidence-attachment-count">
            <Paperclip size={11} />
            {evidence.attachmentCount} 个附件
          </span>
        )}
        {(evidence.attachmentCount > 0 || evidence.source) && (
          <button type="button" onClick={() => void window.youtrace.data.openEvidence(evidence.id)}>
            {evidence.attachmentCount > 0 ? '查看附件' : '查看来源'}
            <ExternalLink size={11} />
          </button>
        )}
      </footer>
    </article>
  )
}

function ManualEffortDialog({
  open,
  onOpenChange,
  tasks,
  onCreated
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  tasks: Task[]
  onCreated: () => Promise<void>
}): React.JSX.Element {
  const [taskId, setTaskId] = useState('')
  const [startedAt, setStartedAt] = useState(localDateTime(-60))
  const [endedAt, setEndedAt] = useState(localDateTime(0))
  const [minutes, setMinutes] = useState('60')
  const [result, setResult] = useState('')
  const [nextStep, setNextStep] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (): Promise<void> => {
    if (!taskId) return
    setBusy(true)
    setError('')
    const response = await window.youtrace.execution.createManualEffort({
      entityType: 'task',
      entityId: taskId,
      startedAt: new Date(startedAt).toISOString(),
      endedAt: new Date(endedAt).toISOString(),
      effectiveMinutes: Number(minutes),
      result,
      interruptions: '',
      obstacles: '',
      nextStep,
      energy: null,
      perceivedDifficulty: null,
      tagIds: []
    })
    setBusy(false)
    if (!response.ok) {
      setError(response.error.message)
      return
    }
    await onCreated()
    setResult('')
    setNextStep('')
    onOpenChange(false)
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content">
          <div className="dialog-heading">
            <div>
              <span className="section-label">补录已发生的事实</span>
              <Dialog.Title>手动记录投入</Dialog.Title>
              <Dialog.Description>补录与计时记录使用同一套努力账本。</Dialog.Description>
            </div>
            <Dialog.Close className="dialog-close" aria-label="关闭"><X size={18} /></Dialog.Close>
          </div>
          <div className="dialog-form">
            <label>
              <span>关联任务</span>
              <select value={taskId} onChange={(event) => setTaskId(event.target.value)}>
                <option value="">请选择任务</option>
                {tasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}
              </select>
            </label>
            <div className="form-row form-row-three">
              <label><span>开始时间</span><input type="datetime-local" value={startedAt} onChange={(event) => setStartedAt(event.target.value)} /></label>
              <label><span>结束时间</span><input type="datetime-local" value={endedAt} onChange={(event) => setEndedAt(event.target.value)} /></label>
              <label><span>有效分钟</span><input type="number" min="0" value={minutes} onChange={(event) => setMinutes(event.target.value)} /></label>
            </div>
            <label><span>实际结果</span><textarea value={result} onChange={(event) => setResult(event.target.value)} /></label>
            <label><span>下一步</span><input value={nextStep} onChange={(event) => setNextStep(event.target.value)} /></label>
            {error && <div className="inline-error">{error}</div>}
          </div>
          <div className="dialog-actions">
            <Dialog.Close className="button button-secondary">取消</Dialog.Close>
            <button className="button button-primary" disabled={!taskId || busy} onClick={() => void submit()}>
              {busy ? '正在保存…' : '保存记录'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function EvidenceDialog({
  open,
  onOpenChange,
  evidence,
  tasks,
  onSaved
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  evidence: Evidence | null
  tasks: Task[]
  onSaved: () => Promise<void>
}): React.JSX.Element {
  const [kind, setKind] = useState<Evidence['kind']>('note')
  const [taskId, setTaskId] = useState('')
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  const [source, setSource] = useState('')
  const [verificationStatus, setVerificationStatus] =
    useState<Evidence['verificationStatus']>('prepared')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [fileDragging, setFileDragging] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const attachmentsQuery = useQuery({
    queryKey: ['evidence-attachments', evidence?.id],
    enabled: open && evidence !== null,
    queryFn: async () =>
      unwrap(await window.youtrace.data.listEvidenceAttachments(evidence!.id))
  })

  useEffect(() => {
    if (!open) return
    setKind(evidence?.kind ?? 'note')
    setTaskId(evidence?.entityType === 'task' ? evidence.entityId ?? '' : '')
    setTitle(evidence?.title ?? '')
    setNote(evidence?.note ?? '')
    setSource(evidence?.source ?? '')
    setVerificationStatus(evidence?.verificationStatus ?? 'prepared')
    setSelectedFile(null)
    setFileDragging(false)
    setError('')
  }, [evidence, open])

  const isLocalFile = kind === 'file' || kind === 'image'

  const submit = async (): Promise<void> => {
    if (isLocalFile && !evidence?.attachmentCount && !selectedFile) {
      setError('本地文件和图片成果至少需要一个附件。')
      return
    }
    setBusy(true)
    setError('')
    if (evidence) {
      const update = await window.youtrace.execution.updateEvidence({
        id: evidence.id,
        title,
        note,
        source: isLocalFile ? evidence.source : source || null,
        verificationStatus,
        entityType: taskId ? 'task' : null,
        entityId: taskId || null,
        tagIds: evidence.tagIds
      })
      if (!update.ok) {
        setBusy(false)
        setError(update.error.message)
        return
      }
      if (selectedFile) {
        const attachment = await window.youtrace.data.attachDroppedEvidenceFile(
          selectedFile,
          evidence.id
        )
        if (!attachment.ok) {
          await onSaved()
          setBusy(false)
          setError(`成果内容已保存，但附件添加失败：${attachment.error.message}`)
          return
        }
      }
    } else if (selectedFile) {
      const response = await window.youtrace.data.importDroppedEvidenceFile(selectedFile, {
          kind,
          title,
          note,
          source: isLocalFile ? null : source || null,
          verificationStatus,
          entityType: taskId ? 'task' : null,
          entityId: taskId || null,
          tagIds: []
        })
      if (!response.ok) {
        setBusy(false)
        setError(response.error.message)
        return
      }
    } else {
      const response = await window.youtrace.execution.createEvidence({
          kind,
          title,
          note,
          source: source || null,
          verificationStatus,
          entityType: taskId ? 'task' : null,
          entityId: taskId || null,
          tagIds: []
        })
      if (!response.ok) {
        setBusy(false)
        setError(response.error.message)
        return
      }
    }
    await onSaved()
    setBusy(false)
    onOpenChange(false)
  }

  const attachments = (attachmentsQuery.data ?? []) as EvidenceAttachment[]

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content">
          <div className="dialog-heading">
            <div>
              <span className="section-label">完成不等于验证</span>
              <Dialog.Title>{evidence ? '编辑成果证据' : '添加成果证据'}</Dialog.Title>
              <Dialog.Description>
                所有证据类型都能附带真实文件，文件会复制到当前工作区。
              </Dialog.Description>
            </div>
            <Dialog.Close className="dialog-close" aria-label="关闭"><X size={18} /></Dialog.Close>
          </div>
          <div className="dialog-form">
            <div className="form-row">
              <label>
                <span>证据类型</span>
                <select
                  value={kind}
                  disabled={evidence !== null}
                  onChange={(event) => {
                    setKind(event.target.value as Evidence['kind'])
                    setSelectedFile(null)
                  }}
                >
                  <option value="file">本地文件</option>
                  <option value="image">图片</option>
                  <option value="note">文本笔记</option>
                  <option value="link">链接</option>
                  <option value="score">成绩</option>
                  <option value="feedback">外部反馈</option>
                </select>
              </label>
              <label>
                <span>关联任务</span>
                <select value={taskId} onChange={(event) => setTaskId(event.target.value)}>
                  <option value="">不关联任务</option>
                  {tasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}
                </select>
              </label>
            </div>
            <label><span>标题</span><input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} /></label>
            <label><span>说明</span><textarea value={note} onChange={(event) => setNote(event.target.value)} /></label>
            {kind !== 'file' && kind !== 'image' && (
              <label><span>来源或链接</span><input value={source} onChange={(event) => setSource(event.target.value)} /></label>
            )}
            <label>
              <span>验证状态</span>
              <select
                value={verificationStatus}
                onChange={(event) =>
                  setVerificationStatus(event.target.value as Evidence['verificationStatus'])
                }
              >
                <option value="prepared">已准备</option>
                <option value="completed">已完成</option>
                <option value="verified">已验证</option>
                <option value="accepted">已认可</option>
              </select>
            </label>
            {attachments.length > 0 && (
              <div className="evidence-attachment-list">
                <span>已有附件</span>
                {attachments.map((attachment) => (
                  <button
                    key={attachment.id}
                    type="button"
                    onClick={() => {
                      void (async () => {
                        const result =
                          await window.youtrace.data.openEvidenceAttachment(attachment.id)
                        if (!result.ok) setError(result.error.message)
                      })()
                    }}
                  >
                    <Paperclip size={13} />
                    <span>{attachment.originalName}</span>
                    <small>{formatBytes(attachment.sizeBytes)}</small>
                  </button>
                ))}
              </div>
            )}
            {attachmentsQuery.isError && (
              <div className="inline-error" role="alert">
                无法读取已有附件。
                <button type="button" onClick={() => void attachmentsQuery.refetch()}>
                  重试
                </button>
              </div>
            )}
            <div
              className={`attachment-dropzone evidence-attachment-dropzone ${fileDragging ? 'dragging' : ''} ${selectedFile ? 'has-file' : ''}`}
              onDragEnter={(event) => {
                event.preventDefault()
                setFileDragging(true)
              }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  setFileDragging(false)
                }
              }}
              onDrop={(event) => {
                event.preventDefault()
                setFileDragging(false)
                setSelectedFile(event.dataTransfer.files[0] ?? null)
              }}
            >
              <label>
                <input
                  className="visually-hidden"
                  aria-label="选择成果附件"
                  type="file"
                  accept={kind === 'image' ? 'image/*' : undefined}
                  onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
                />
                <Paperclip size={17} />
                <span>
                  <strong>
                    {selectedFile
                      ? selectedFile.name
                      : evidence
                        ? '点击或拖拽，为成果追加附件'
                        : '点击选择附件，或将文件拖到这里'}
                  </strong>
                  <small>
                    {isLocalFile
                      ? '此证据类型必须有附件；应用会校验哈希并复制到工作区。'
                      : '附件可选；应用会校验哈希并复制一份到当前工作区。'}
                  </small>
                </span>
              </label>
              {selectedFile && (
                <button
                  type="button"
                  aria-label="移除待上传成果附件"
                  onClick={() => setSelectedFile(null)}
                >
                  <X size={14} />
                </button>
              )}
            </div>
            {error && <div className="inline-error">{error}</div>}
          </div>
          <div className="dialog-actions">
            <Dialog.Close className="button button-secondary">取消</Dialog.Close>
            <button
              className="button button-primary"
              disabled={
                !title.trim() ||
                busy ||
                (isLocalFile && !evidence?.attachmentCount && !selectedFile)
              }
              onClick={() => void submit()}
            >
              {busy ? '正在保存…' : evidence ? '保存修改' : '保存成果'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function DeleteEvidenceDialog({
  evidence,
  onOpenChange,
  onDeleted
}: {
  evidence: Evidence | null
  onOpenChange: (open: boolean) => void
  onDeleted: () => Promise<void>
}): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (evidence) setError('')
  }, [evidence])

  const submit = async (): Promise<void> => {
    if (!evidence) return
    setBusy(true)
    setError('')
    const result = await window.youtrace.execution.trashEvidence(evidence.id)
    setBusy(false)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    await onDeleted()
  }

  return (
    <Dialog.Root open={evidence !== null} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content destructive-dialog">
          <div className="dialog-heading">
            <div>
              <span className="section-label">可从回收站恢复</span>
              <Dialog.Title>删除“{evidence?.title}”</Dialog.Title>
              <Dialog.Description>
                成果会进入回收站，附件文件不会立即清理；永久删除仍需备份与二次确认。
              </Dialog.Description>
            </div>
            <Dialog.Close className="dialog-close" aria-label="关闭">
              <X size={18} />
            </Dialog.Close>
          </div>
          {error && <div className="inline-error">{error}</div>}
          <div className="dialog-actions">
            <Dialog.Close className="button button-secondary">取消</Dialog.Close>
            <button
              className="button button-danger"
              disabled={busy}
              onClick={() => void submit()}
            >
              <Trash2 size={14} />
              {busy ? '正在删除…' : '移入回收站'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`
  return `${Math.round((bytes / 1024 ** 2) * 10) / 10} MB`
}

function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (!hours) return `${rest} 分钟`
  return rest ? `${hours} 小时 ${rest} 分` : `${hours} 小时`
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(new Date(value))
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

function localDateTime(offsetMinutes: number): string {
  const date = new Date(Date.now() + offsetMinutes * 60_000)
  const timezoneOffset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - timezoneOffset).toISOString().slice(0, 16)
}

function toLocalDateTime(value: string): string {
  const date = new Date(value)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}
