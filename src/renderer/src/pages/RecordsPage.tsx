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
  Plus,
  TimerReset,
  X
} from 'lucide-react'
import { useMemo, useState } from 'react'
import type { Evidence, IpcResult, Task } from '../../../shared/contracts'

function unwrap<T>(result: IpcResult<T>): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.data
}

export function RecordsPage(): React.JSX.Element {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<'effort' | 'evidence'>('effort')
  const [manualDialogOpen, setManualDialogOpen] = useState(false)
  const [evidenceDialogOpen, setEvidenceDialogOpen] = useState(false)

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

  const totalMinutes = useMemo(
    () => (effortsQuery.data ?? []).reduce((sum, effort) => sum + effort.effectiveMinutes, 0),
    [effortsQuery.data]
  )
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
          <button className="button button-secondary" onClick={() => setEvidenceDialogOpen(true)}>
            <Award size={16} />
            添加成果
          </button>
          <button className="button button-primary" onClick={() => setManualDialogOpen(true)}>
            <Plus size={16} />
            补录投入
          </button>
        </div>
      </header>

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
            <strong>{effortsQuery.data?.length ?? 0}</strong>
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
            {(effortsQuery.data ?? []).length === 0 ? (
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
                      <b>{formatMinutes(effort.effectiveMinutes)}</b>
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
            {(evidenceQuery.data ?? []).length === 0 ? (
              <div className="record-empty">
                <Award size={24} />
                <strong>还没有成果证据</strong>
                <p>添加链接、笔记、成绩或外部反馈，让完成状态能够被验证。</p>
              </div>
            ) : (
              (evidenceQuery.data ?? []).map((evidence) => (
                <EvidenceCard key={evidence.id} evidence={evidence} />
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
        onOpenChange={setEvidenceDialogOpen}
        tasks={tasksQuery.data ?? []}
        onCreated={async () => {
          await queryClient.invalidateQueries({ queryKey: ['evidence'] })
        }}
      />
    </main>
  )
}

function EvidenceCard({ evidence }: { evidence: Evidence }): React.JSX.Element {
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
        <small className={`evidence-status status-${evidence.verificationStatus}`}>{status}</small>
      </header>
      <strong>{evidence.title}</strong>
      <p>{evidence.note || '没有补充说明。'}</p>
      <footer>
        <span>{formatDate(evidence.createdAt)}</span>
        {evidence.source && (
          <span>
            查看来源
            <ExternalLink size={11} />
          </span>
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
  tasks,
  onCreated
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  tasks: Task[]
  onCreated: () => Promise<void>
}): React.JSX.Element {
  const [kind, setKind] = useState<
    'file' | 'image' | 'note' | 'link' | 'score' | 'feedback'
  >('note')
  const [taskId, setTaskId] = useState('')
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  const [source, setSource] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (): Promise<void> => {
    setBusy(true)
    setError('')
    const isLocalFile = kind === 'file' || kind === 'image'
    const response = isLocalFile
      ? await window.youtrace.data.importEvidenceFile({
          kind,
          title,
          note,
          verificationStatus: 'prepared',
          entityType: taskId ? 'task' : null,
          entityId: taskId || null,
          tagIds: []
        })
      : await window.youtrace.execution.createEvidence({
          kind,
          title,
          note,
          source: source || null,
          verificationStatus: 'prepared',
          entityType: taskId ? 'task' : null,
          entityId: taskId || null,
          tagIds: []
        })
    setBusy(false)
    if (!response.ok) {
      setError(response.error.message)
      return
    }
    if (isLocalFile && response.data === null) return
    await onCreated()
    setTitle('')
    setNote('')
    setSource('')
    onOpenChange(false)
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content">
          <div className="dialog-heading">
            <div>
              <span className="section-label">完成不等于验证</span>
              <Dialog.Title>添加成果证据</Dialog.Title>
              <Dialog.Description>证据状态需要明确操作才能升级。</Dialog.Description>
            </div>
            <Dialog.Close className="dialog-close" aria-label="关闭"><X size={18} /></Dialog.Close>
          </div>
          <div className="dialog-form">
            <div className="form-row">
              <label>
                <span>证据类型</span>
                <select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>
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
            {kind === 'file' || kind === 'image' ? (
              <div className="file-picker-note">
                保存时选择文件；应用会校验哈希并复制到当前工作区。
              </div>
            ) : (
              <label><span>来源或链接</span><input value={source} onChange={(event) => setSource(event.target.value)} /></label>
            )}
            {error && <div className="inline-error">{error}</div>}
          </div>
          <div className="dialog-actions">
            <Dialog.Close className="button button-secondary">取消</Dialog.Close>
            <button className="button button-primary" disabled={!title.trim() || busy} onClick={() => void submit()}>
              {busy ? '正在保存…' : kind === 'file' || kind === 'image' ? '选择文件并保存' : '保存证据'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
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
