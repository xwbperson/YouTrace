import * as Dialog from '@radix-ui/react-dialog'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  Archive,
  ArrowRight,
  BookOpen,
  Inbox,
  Lightbulb,
  Link2,
  Paperclip,
  Pencil,
  Plus,
  RotateCcw,
  Tag,
  Trash2,
  X
} from 'lucide-react'
import { useEffect, useState } from 'react'
import type { IpcResult, Memo, Project, Tag as TraceTag } from '../../../shared/contracts'

function unwrap<T>(result: IpcResult<T>): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.data
}

const kindLabels: Record<Memo['kind'], string> = {
  memo: '普通备忘',
  knowledge: '知识点',
  question: '问题',
  mistake: '错题',
  idea: '灵感',
  meeting: '会议记录'
}

const QUICK_MEMO_DRAFT_KEY = 'memo:quick-capture'

export function MemosPage(): React.JSX.Element {
  const queryClient = useQueryClient()
  const [body, setBody] = useState('')
  const [kind, setKind] = useState<Memo['kind']>('memo')
  const [projectId, setProjectId] = useState('')
  const [sourceLink, setSourceLink] = useState('')
  const [tagIds, setTagIds] = useState<string[]>([])
  const [attachment, setAttachment] = useState<File | null>(null)
  const [attachmentDragging, setAttachmentDragging] = useState(false)
  const [captureNotice, setCaptureNotice] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [convertMemo, setConvertMemo] = useState<Memo | null>(null)
  const [editMemo, setEditMemo] = useState<Memo | null>(null)
  const [deleteMemo, setDeleteMemo] = useState<Memo | null>(null)
  const [draftHandled, setDraftHandled] = useState(false)

  const memosQuery = useQuery({
    queryKey: ['memos', showArchived],
    queryFn: async () => unwrap(await window.youtrace.execution.listMemos(false, showArchived))
  })
  const projectsQuery = useQuery({
    queryKey: ['projects'],
    queryFn: async () => unwrap(await window.youtrace.planning.listProjects())
  })
  const tagsQuery = useQuery({
    queryKey: ['tags'],
    queryFn: async () => unwrap(await window.youtrace.planning.listTags())
  })
  const draftsQuery = useQuery({
    queryKey: ['recovery-drafts'],
    queryFn: async () => unwrap(await window.youtrace.data.listRecoveryDrafts())
  })
  const recoveryDraft = (draftsQuery.data ?? []).find(
    (draft) => draft.key === QUICK_MEMO_DRAFT_KEY
  )

  useEffect(() => {
    if (!draftsQuery.isSuccess || (recoveryDraft && !draftHandled)) return
    const timer = window.setTimeout(() => {
      if (!body.trim()) {
        void window.youtrace.data.discardRecoveryDraft(QUICK_MEMO_DRAFT_KEY)
        return
      }
      void window.youtrace.data.saveRecoveryDraft({
        key: QUICK_MEMO_DRAFT_KEY,
        label: '快速备忘',
        content: body,
        context: {
          kind,
          projectId,
          sourceLink,
          tagIds
        }
      })
    }, 750)
    return () => window.clearTimeout(timer)
  }, [
    body,
    draftHandled,
    draftsQuery.isSuccess,
    kind,
    projectId,
    recoveryDraft,
    sourceLink,
    tagIds
  ])

  const createMutation = useMutation({
    mutationFn: async () => {
      const memo = unwrap(
        await window.youtrace.execution.createMemo({
          kind,
          title: '',
          body,
          projectId: projectId || null,
          sourceLink: sourceLink || null,
          tagIds
        })
      )
      if (!attachment) return null
      const attachmentResult = await window.youtrace.data.importDroppedEvidenceFile(attachment, {
        kind: 'file',
        title: attachment.name,
        note: '备忘附件',
        verificationStatus: 'prepared',
        entityType: 'memo',
        entityId: memo.id,
        tagIds
      })
      return attachmentResult.ok ? null : attachmentResult.error.message
    },
    onSuccess: async (attachmentError) => {
      setBody('')
      setSourceLink('')
      setTagIds([])
      setAttachment(null)
      setCaptureNotice(
        attachmentError
          ? `备忘已保存，但附件导入失败：${attachmentError}`
          : ''
      )
      setDraftHandled(true)
      await window.youtrace.data.discardRecoveryDraft(QUICK_MEMO_DRAFT_KEY)
      await queryClient.invalidateQueries({ queryKey: ['memos'] })
    }
  })

  const memos = memosQuery.data ?? []

  return (
    <main className="memos-page">
      <header className="memos-header">
        <div>
          <span className="page-kicker">先捕捉，再整理</span>
          <h1>备忘</h1>
          <p>记录时不强制分类；转换为行动后，原始内容和来源关系仍会保留。</p>
        </div>
        <div className="memo-count">
          <Inbox size={17} />
          <span><strong>{memos.filter((memo) => memo.inbox).length}</strong> 条待处理</span>
        </div>
      </header>

      <section className="capture-panel panel">
        {recoveryDraft && !draftHandled ? (
          <div className="memo-recovery-banner" role="status">
            <div>
              <RotateCcw size={16} />
              <span>
                <strong>发现上次未保存的快速备忘</strong>
                <small>{new Date(recoveryDraft.updatedAt).toLocaleString('zh-CN')}</small>
              </span>
            </div>
            <button
              type="button"
              className="button button-secondary"
              onClick={async () => {
                await window.youtrace.data.discardRecoveryDraft(QUICK_MEMO_DRAFT_KEY)
                setDraftHandled(true)
                await queryClient.invalidateQueries({ queryKey: ['recovery-drafts'] })
              }}
            >
              放弃草稿
            </button>
            <button
              type="button"
              className="button button-primary"
              onClick={() => {
                setBody(recoveryDraft.content)
                if (typeof recoveryDraft.context.kind === 'string') {
                  const recoveredKind = recoveryDraft.context.kind as Memo['kind']
                  if (recoveredKind in kindLabels) setKind(recoveredKind)
                }
                if (typeof recoveryDraft.context.projectId === 'string') {
                  setProjectId(recoveryDraft.context.projectId)
                }
                if (typeof recoveryDraft.context.sourceLink === 'string') {
                  setSourceLink(recoveryDraft.context.sourceLink)
                }
                if (Array.isArray(recoveryDraft.context.tagIds)) {
                  setTagIds(recoveryDraft.context.tagIds)
                }
                setDraftHandled(true)
              }}
            >
              恢复草稿
            </button>
          </div>
        ) : null}
        <div className="capture-icon"><Lightbulb size={20} /></div>
        <textarea
          aria-label="快速记录"
          autoFocus
          value={body}
          onChange={(event) => {
            setDraftHandled(true)
            setBody(event.target.value)
          }}
          placeholder="写下突然想到的事情、问题或下一步…"
        />
        <div className="capture-actions">
          <select aria-label="备忘类型" value={kind} onChange={(event) => setKind(event.target.value as Memo['kind'])}>
            {Object.entries(kindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <select aria-label="关联项目" value={projectId} onChange={(event) => setProjectId(event.target.value)}>
            <option value="">不关联项目</option>
            {(projectsQuery.data ?? []).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
          <label className="memo-source-link"><Link2 size={14} /><input aria-label="来源链接" type="url" value={sourceLink} onChange={(event) => setSourceLink(event.target.value)} placeholder="可选来源链接" /></label>
        </div>
        <div
          className={`attachment-dropzone memo-attachment-dropzone ${attachmentDragging ? 'dragging' : ''} ${attachment ? 'has-file' : ''}`}
          onDragEnter={(event) => {
            event.preventDefault()
            setAttachmentDragging(true)
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              setAttachmentDragging(false)
            }
          }}
          onDrop={(event) => {
            event.preventDefault()
            setAttachmentDragging(false)
            setAttachment(event.dataTransfer.files[0] ?? null)
          }}
        >
          <label>
            <input
              className="visually-hidden"
              aria-label="选择备忘附件"
              type="file"
              onChange={(event) => setAttachment(event.target.files?.[0] ?? null)}
            />
            <Paperclip size={16} />
            <span>
              <strong>{attachment ? attachment.name : '点击选择附件，或将文件拖到这里'}</strong>
              <small>保存后会复制到当前工作区，原文件不会被移动。</small>
            </span>
          </label>
          {attachment && (
            <button type="button" aria-label="移除待上传附件" onClick={() => setAttachment(null)}>
              <X size={14} />
            </button>
          )}
        </div>
        <div className="memo-capture-tags" aria-label="备忘标签">
          <Tag size={14} />
          {(tagsQuery.data ?? []).map((tag) => (
            <button type="button" key={tag.id} className={tagIds.includes(tag.id) ? 'active' : ''} onClick={() => setTagIds((current) => current.includes(tag.id) ? current.filter((id) => id !== tag.id) : [...current, tag.id])}>
              <span style={{ background: tag.color ?? '#64736e' }} />{tag.name}
            </button>
          ))}
          <span className="memo-capture-spacer" />
          <button
            className="button button-primary"
            disabled={!body.trim() || createMutation.isPending}
            onClick={() => {
              setCaptureNotice('')
              createMutation.mutate()
            }}
          >
            <Plus size={16} />
            {attachment ? '保存备忘及附件' : '保存到收件箱'}
          </button>
        </div>
        {captureNotice && <div className="inline-error memo-capture-error" role="status">{captureNotice}</div>}
        {createMutation.error && <div className="inline-error memo-capture-error">{createMutation.error.message}</div>}
      </section>

      <section className="memo-list-section">
        <div className="memo-list-heading">
          <div>
            <span className="section-label">收件箱与笔记</span>
            <h2>最近记录</h2>
          </div>
          <label className="archive-toggle"><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} />显示已归档</label>
        </div>

        {memos.length === 0 ? (
          <div className="record-empty panel">
            <Inbox size={24} />
            <strong>这里还没有内容</strong>
            <p>先快速写下来，稍后再决定它是任务、知识点还是普通笔记。</p>
          </div>
        ) : (
          <div className="memo-grid">
            {memos.map((memo) => (
              <article key={memo.id} className="memo-card panel">
                <header>
                  <span>{kindLabels[memo.kind]}</span>
                  <small>{formatDate(memo.createdAt)}</small>
                </header>
                {memo.title && <strong>{memo.title}</strong>}
                <p>{memo.body}</p>
                <footer>
                  <div className="memo-card-meta">
                    <span className={memo.archived ? 'processed' : memo.inbox ? 'inbox' : 'processed'}>{memo.archived ? '已归档' : memo.inbox ? '待处理' : `已转为${convertedLabel(memo)}`}</span>
                    {memo.evidenceCount > 0 && <span className="memo-evidence-count"><Paperclip size={11} />{memo.evidenceCount}</span>}
                    {memo.projectId && <span>{(projectsQuery.data ?? []).find((project) => project.id === memo.projectId)?.name ?? '关联项目'}</span>}
                  </div>
                  <div className="memo-card-actions">
                    <button aria-label="编辑备忘" onClick={() => setEditMemo(memo)}>
                      <Pencil size={13} />
                    </button>
                    {memo.inbox && !memo.archived && (
                      <button onClick={() => setConvertMemo(memo)}>
                        整理
                        <ArrowRight size={13} />
                      </button>
                    )}
                    {memo.archived && (
                      <button className="memo-delete-action" aria-label="永久删除备忘" onClick={() => setDeleteMemo(memo)}>
                        <Trash2 size={13} />
                      </button>
                    )}
                    <button aria-label={memo.archived ? '恢复备忘' : '归档备忘'} onClick={async () => { await window.youtrace.execution.archiveMemo(memo.id, !memo.archived); await queryClient.invalidateQueries({ queryKey: ['memos'] }) }}>
                      {memo.archived ? <RotateCcw size={13} /> : <Archive size={13} />}
                    </button>
                  </div>
                </footer>
              </article>
            ))}
          </div>
        )}
      </section>

      {convertMemo && (
        <ConvertMemoDialog
          memo={convertMemo}
          projects={projectsQuery.data ?? []}
          open
          onOpenChange={(open) => {
            if (!open) setConvertMemo(null)
          }}
          onConverted={async () => {
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: ['memos'] }),
              queryClient.invalidateQueries({ queryKey: ['tasks'] })
            ])
          }}
        />
      )}
      {editMemo && (
        <EditMemoDialog
          key={editMemo.id}
          memo={editMemo}
          projects={projectsQuery.data ?? []}
          tags={tagsQuery.data ?? []}
          open
          onOpenChange={(open) => { if (!open) setEditMemo(null) }}
          onSaved={async () => {
            setEditMemo(null)
            await queryClient.invalidateQueries({ queryKey: ['memos'] })
          }}
        />
      )}
      <DeleteArchivedMemoDialog
        memo={deleteMemo}
        onOpenChange={(open) => {
          if (!open) setDeleteMemo(null)
        }}
        onDeleted={async () => {
          await queryClient.invalidateQueries({ queryKey: ['memos'] })
        }}
      />
    </main>
  )
}

function EditMemoDialog({
  memo,
  projects,
  tags,
  open,
  onOpenChange,
  onSaved
}: {
  memo: Memo
  projects: Project[]
  tags: TraceTag[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => Promise<void>
}): React.JSX.Element {
  const [kind, setKind] = useState<Memo['kind']>(memo.kind)
  const [title, setTitle] = useState(memo.title)
  const [body, setBody] = useState(memo.body)
  const [projectId, setProjectId] = useState(memo.projectId ?? '')
  const [tagIds, setTagIds] = useState(memo.tagIds)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (): Promise<void> => {
    setBusy(true)
    setError('')
    const result = await window.youtrace.execution.updateMemo({
      id: memo.id,
      kind,
      title,
      body,
      projectId: projectId || null,
      tagIds
    })
    setBusy(false)
    if (!result.ok) return setError(result.error.message)
    await onSaved()
  }
  return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="dialog-content"><div className="dialog-heading"><div><span className="section-label">保留原始记录关系</span><Dialog.Title>编辑备忘</Dialog.Title><Dialog.Description>修改内容不会改变已有附件、来源成果或转换关系。</Dialog.Description></div><Dialog.Close className="dialog-close" aria-label="关闭"><X size={18} /></Dialog.Close></div><div className="dialog-form"><div className="form-row"><label><span>备忘类型</span><select value={kind} onChange={(event) => setKind(event.target.value as Memo['kind'])}>{Object.entries(kindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label><span>关联项目</span><select value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">不关联项目</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label></div><label><span>标题（可选）</span><input value={title} onChange={(event) => setTitle(event.target.value)} /></label><label><span>内容</span><textarea autoFocus value={body} onChange={(event) => setBody(event.target.value)} /></label>{tags.length > 0 && <fieldset className="tag-picker"><legend>标签</legend><div>{tags.map((tag) => <button type="button" key={tag.id} className={tagIds.includes(tag.id) ? 'active' : ''} onClick={() => setTagIds((current) => current.includes(tag.id) ? current.filter((id) => id !== tag.id) : [...current, tag.id])}>{tag.name}</button>)}</div></fieldset>}{error && <div className="inline-error">{error}</div>}</div><div className="dialog-actions"><Dialog.Close className="button button-secondary">取消</Dialog.Close><button className="button button-primary" disabled={!body.trim() || busy} onClick={() => void submit()}><Pencil size={14} />{busy ? '保存中…' : '保存修改'}</button></div></Dialog.Content></Dialog.Portal></Dialog.Root>
}

function DeleteArchivedMemoDialog({
  memo,
  onOpenChange,
  onDeleted
}: {
  memo: Memo | null
  onOpenChange: (open: boolean) => void
  onDeleted: () => Promise<void>
}): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const remove = async (): Promise<void> => {
    if (!memo) return
    setBusy(true)
    setError('')
    const result = await window.youtrace.execution.deleteArchivedMemo(memo.id)
    setBusy(false)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    onOpenChange(false)
    await onDeleted()
  }

  return (
    <Dialog.Root open={memo !== null} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content destructive-dialog">
          <div className="dialog-heading">
            <div>
              <span className="section-label">不可恢复操作</span>
              <Dialog.Title>永久删除这条备忘？</Dialog.Title>
              <Dialog.Description>
                备忘原文、标签和来源关系会被永久删除；已经转换出的任务、知识内容及已保存附件仍会保留。
              </Dialog.Description>
            </div>
            <Dialog.Close className="dialog-close" aria-label="关闭"><X size={18} /></Dialog.Close>
          </div>
          {error && <div className="inline-error">{error}</div>}
          <div className="dialog-actions">
            <Dialog.Close className="button button-secondary">取消</Dialog.Close>
            <button className="button button-danger" disabled={busy} onClick={() => void remove()}>
              <Trash2 size={14} />
              {busy ? '正在删除…' : '确认永久删除'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function ConvertMemoDialog({
  memo,
  projects,
  open,
  onOpenChange,
  onConverted
}: {
  memo: Memo
  projects: Project[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onConverted: () => Promise<void>
}): React.JSX.Element {
  const [title, setTitle] = useState(memo.title || memo.body.slice(0, 80))
  const [projectId, setProjectId] = useState('')
  const [target, setTarget] = useState<'task' | 'knowledge' | 'mistake'>('task')
  const [minutes, setMinutes] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const convert = async (): Promise<void> => {
    setBusy(true)
    setError('')
    const result =
      target === 'task'
        ? await window.youtrace.execution.convertMemoToTask({
            memoId: memo.id,
            projectId: projectId || null,
            title,
            estimatedMinutes: minutes ? Number(minutes) : null
          })
        : await window.youtrace.execution.convertMemoToLearning({
            memoId: memo.id,
            projectId,
            target,
            title
          })
    setBusy(false)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    await onConverted()
    onOpenChange(false)
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content">
          <div className="dialog-heading">
            <div>
              <span className="section-label">保留原始备忘</span>
              <Dialog.Title>整理备忘</Dialog.Title>
              <Dialog.Description>新对象会保存与原备忘的来源关系，原文不会被移动或删除。</Dialog.Description>
            </div>
            <Dialog.Close className="dialog-close" aria-label="关闭"><X size={18} /></Dialog.Close>
          </div>
          <div className="source-memo">{memo.body}</div>
          <div className="memo-convert-targets" aria-label="转换类型">
            <button type="button" className={target === 'task' ? 'active' : ''} onClick={() => setTarget('task')}><ArrowRight size={14} />任务</button>
            <button type="button" className={target === 'knowledge' ? 'active' : ''} onClick={() => setTarget('knowledge')}><BookOpen size={14} />知识点</button>
            <button type="button" className={target === 'mistake' ? 'active' : ''} onClick={() => setTarget('mistake')}><AlertTriangle size={14} />错题</button>
          </div>
          <div className="dialog-form">
            <label><span>任务标题</span><input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} /></label>
            <div className="form-row">
              <label>
                <span>所属项目</span>
                <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
                  <option value="">独立任务</option>
                  {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                </select>
              </label>
              {target === 'task' && <label><span>预计分钟</span><input type="number" min="1" value={minutes} onChange={(event) => setMinutes(event.target.value)} /></label>}
            </div>
            {error && <div className="inline-error">{error}</div>}
          </div>
          <div className="dialog-actions">
            <Dialog.Close className="button button-secondary">取消</Dialog.Close>
            <button className="button button-primary" disabled={!title.trim() || busy || (target !== 'task' && !projectId)} onClick={() => void convert()}>
              {busy ? '正在转换…' : `创建${target === 'task' ? '任务' : target === 'knowledge' ? '知识点' : '错题'}并保留来源`}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function convertedLabel(memo: Memo): string {
  if (memo.convertedTo?.entityType === 'knowledge') return '知识点'
  if (memo.convertedTo?.entityType === 'mistake') return '错题'
  if (memo.convertedTo?.entityType === 'task') return '任务'
  return '已处理'
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}
