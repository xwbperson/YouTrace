import * as Dialog from '@radix-ui/react-dialog'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Inbox, Lightbulb, Plus, Tag, X } from 'lucide-react'
import { useState } from 'react'
import type { IpcResult, Memo, Project } from '../../../shared/contracts'

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

export function MemosPage(): React.JSX.Element {
  const queryClient = useQueryClient()
  const [body, setBody] = useState('')
  const [kind, setKind] = useState<Memo['kind']>('memo')
  const [convertMemo, setConvertMemo] = useState<Memo | null>(null)

  const memosQuery = useQuery({
    queryKey: ['memos'],
    queryFn: async () => unwrap(await window.youtrace.execution.listMemos(false))
  })
  const projectsQuery = useQuery({
    queryKey: ['projects'],
    queryFn: async () => unwrap(await window.youtrace.planning.listProjects())
  })

  const createMutation = useMutation({
    mutationFn: async () =>
      unwrap(
        await window.youtrace.execution.createMemo({
          kind,
          title: '',
          body,
          tagIds: []
        })
      ),
    onSuccess: async () => {
      setBody('')
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
        <div className="capture-icon"><Lightbulb size={20} /></div>
        <textarea
          aria-label="快速记录"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="写下突然想到的事情、问题或下一步…"
        />
        <div className="capture-actions">
          <select aria-label="备忘类型" value={kind} onChange={(event) => setKind(event.target.value as Memo['kind'])}>
            {Object.entries(kindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <button
            className="button button-primary"
            disabled={!body.trim() || createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            <Plus size={16} />
            保存到收件箱
          </button>
        </div>
      </section>

      <section className="memo-list-section">
        <div className="memo-list-heading">
          <div>
            <span className="section-label">收件箱与笔记</span>
            <h2>最近记录</h2>
          </div>
          <span>{memos.length} 条</span>
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
                  <span className={memo.inbox ? 'inbox' : 'processed'}>
                    {memo.inbox ? '待处理' : '已处理'}
                  </span>
                  {memo.inbox && (
                    <button onClick={() => setConvertMemo(memo)}>
                      转为任务
                      <ArrowRight size={13} />
                    </button>
                  )}
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
    </main>
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
  const [minutes, setMinutes] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const convert = async (): Promise<void> => {
    setBusy(true)
    setError('')
    const result = await window.youtrace.execution.convertMemoToTask({
      memoId: memo.id,
      projectId: projectId || null,
      title,
      estimatedMinutes: minutes ? Number(minutes) : null
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
              <Dialog.Title>转换为任务</Dialog.Title>
              <Dialog.Description>新任务会保存与原备忘的来源关系。</Dialog.Description>
            </div>
            <Dialog.Close className="dialog-close" aria-label="关闭"><X size={18} /></Dialog.Close>
          </div>
          <div className="source-memo">{memo.body}</div>
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
              <label><span>预计分钟</span><input type="number" min="1" value={minutes} onChange={(event) => setMinutes(event.target.value)} /></label>
            </div>
            {error && <div className="inline-error">{error}</div>}
          </div>
          <div className="dialog-actions">
            <Dialog.Close className="button button-secondary">取消</Dialog.Close>
            <button className="button button-primary" disabled={!title.trim() || busy} onClick={() => void convert()}>
              {busy ? '正在转换…' : '创建任务并保留来源'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}
