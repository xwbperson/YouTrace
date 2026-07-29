import * as Dialog from '@radix-ui/react-dialog'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle,
  Check,
  Clock3,
  Flag,
  Pause,
  Play,
  Square,
  TimerReset,
  X
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { EffortEntry, IpcResult, Task } from '../../../shared/contracts'

function unwrap<T>(result: IpcResult<T>): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.data
}

export function TodayPage(): React.JSX.Element {
  const queryClient = useQueryClient()
  const [stopDialogOpen, setStopDialogOpen] = useState(false)
  const [overrideTask, setOverrideTask] = useState<Task | null>(null)
  const [overrideReason, setOverrideReason] = useState('')
  const [actionError, setActionError] = useState('')
  const [now, setNow] = useState(Date.now())

  const tasksQuery = useQuery({
    queryKey: ['today-tasks'],
    queryFn: async () =>
      unwrap(
        await window.youtrace.planning.listTasks({
          projectId: null,
          statuses: ['ready', 'scheduled', 'in_progress', 'blocked'],
          tagIds: [],
          includeDeleted: false,
          limit: 200,
          offset: 0
        })
      )
  })
  const activeQuery = useQuery({
    queryKey: ['active-effort'],
    queryFn: async () => unwrap(await window.youtrace.execution.getActiveEffort()),
    refetchInterval: 10_000
  })
  const todayStart = useMemo(() => {
    const date = new Date()
    date.setHours(0, 0, 0, 0)
    return date.toISOString()
  }, [])
  const todayEnd = useMemo(() => {
    const date = new Date(todayStart)
    date.setDate(date.getDate() + 1)
    return date.toISOString()
  }, [todayStart])
  const blocksQuery = useQuery({
    queryKey: ['time-blocks', 'today', todayStart, todayEnd],
    queryFn: async () =>
      unwrap(await window.youtrace.temporal.listTimeBlocks({ start: todayStart, end: todayEnd }))
  })
  const todayEffortsQuery = useQuery({
    queryKey: ['efforts', 'today', todayStart, todayEnd],
    queryFn: async () =>
      unwrap(
        await window.youtrace.execution.listEfforts({
          entityType: null,
          entityId: null,
          from: todayStart,
          to: todayEnd,
          limit: 500,
          offset: 0
        })
      )
  })

  useEffect(() => {
    if (!activeQuery.data) return
    const interval = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(interval)
  }, [activeQuery.data])

  const tasks = tasksQuery.data ?? []
  const today = new Date().toLocaleDateString('sv-SE')
  const focusTasks = [...tasks]
    .sort((left, right) => {
      const leftToday = left.startDate === today || left.dueAt?.slice(0, 10) === today ? 0 : 1
      const rightToday = right.startDate === today || right.dueAt?.slice(0, 10) === today ? 0 : 1
      return leftToday - rightToday
    })
    .slice(0, 3)
  const remainingTasks = tasks.filter((task) => !focusTasks.some((focus) => focus.id === task.id))
  const active = activeQuery.data ?? null
  const plannedMinutes = focusTasks.reduce((sum, task) => sum + (task.estimatedMinutes ?? 0), 0)
  const actualMinutes = (todayEffortsQuery.data ?? []).reduce(
    (sum, effort) => sum + effort.effectiveMinutes,
    0
  )
  const elapsedSeconds = active
    ? Math.max(0, Math.floor((now - Date.parse(active.startedAt)) / 1_000))
    : 0

  const startMutation = useMutation({
    mutationFn: async ({
      task,
      dependencyOverrideReason
    }: {
      task: Task
      dependencyOverrideReason?: string
    }) => {
      const result = await window.youtrace.execution.startEffort({
          entityType: 'task',
          entityId: task.id,
          dependencyOverrideReason: dependencyOverrideReason || null,
          tagIds: task.tagIds
        })
      if (!result.ok) {
        throw Object.assign(new Error(result.error.message), { code: result.error.code })
      }
      return result.data
    },
    onError: (error, variables) => {
      if ((error as Error & { code?: string }).code === 'TASK_DEPENDENCY_BLOCKED') {
        setOverrideTask(variables.task)
      } else {
        setActionError(error.message)
      }
    },
    onSuccess: async () => {
      setNow(Date.now())
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['active-effort'] }),
        queryClient.invalidateQueries({ queryKey: ['today-tasks'] }),
        queryClient.invalidateQueries({ queryKey: ['tasks'] })
      ])
    }
  })

  const completeMutation = useMutation({
    mutationFn: async (task: Task) =>
      unwrap(await window.youtrace.planning.updateTask({ id: task.id, status: 'completed' })),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['today-tasks'] }),
        queryClient.invalidateQueries({ queryKey: ['tasks'] })
      ])
    }
  })

  const quickUpdate = async (
    task: Task,
    input: Parameters<typeof window.youtrace.planning.updateTask>[0]
  ): Promise<void> => {
    const result = await window.youtrace.planning.updateTask({ ...input, id: task.id })
    if (!result.ok) return setActionError(result.error.message)
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['today-tasks'] }),
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
    ])
  }

  return (
    <main className="today-page">
      <header className="today-header">
        <div>
          <span className="page-kicker">今日执行台</span>
          <h1>把计划变成真实投入</h1>
          <p>停止计时不会自动完成任务，事实和结果分别保存。</p>
        </div>
        <div className="today-capacity">
          <span>今日容量</span>
          <strong>{formatMinutes(actualMinutes)} <small>/ {formatMinutes(plannedMinutes || 480)}</small></strong>
        </div>
      </header>

      <section className={`active-session ${active ? 'is-active' : ''}`}>
        <div className="session-orbit">
          {active ? <Pause size={23} /> : <Play size={23} />}
        </div>
        <div className="session-copy">
          <span>{active ? '正在投入' : '当前没有计时'}</span>
          <h2>{active?.entityTitle ?? '选择一项任务开始'}</h2>
          <p>
            {active
              ? '时间、结果、困难和下一步会作为独立努力记录保存。'
              : '计时会让任务进入“进行中”，但不会替你判断它是否完成。'}
          </p>
        </div>
        <div className="session-time">
          <strong>{formatClock(elapsedSeconds)}</strong>
          {active ? (
            <button className="button stop-button" onClick={() => setStopDialogOpen(true)}>
              <Square size={15} fill="currentColor" />
              停止并记录
            </button>
          ) : (
            <span>等待开始</span>
          )}
        </div>
      </section>

      <div className="today-grid">
        <section className="today-task-panel panel">
          <div className="panel-heading">
            <div>
              <span className="section-label">可执行的下一步</span>
              <h2>今日任务</h2>
            </div>
            <span className="task-count">{focusTasks.length} / 最多 3 项</span>
          </div>

          {tasksQuery.isPending ? (
            <p className="rail-message">正在读取任务…</p>
          ) : focusTasks.length === 0 ? (
            <div className="today-empty">
              <Check size={23} />
              <strong>现在没有待执行任务</strong>
              <p>可以在“计划”中创建下一步，或者先写一条快速备忘。</p>
            </div>
          ) : (
            <div className="today-task-list">
              {focusTasks.map((task) => {
                const isCurrent = active?.entityId === task.id
                return (
                  <article key={task.id} className={isCurrent ? 'current' : ''}>
                    <button
                      className="task-complete-action"
                      aria-label={`完成任务：${task.title}`}
                      onClick={() => completeMutation.mutate(task)}
                    >
                      <span />
                    </button>
                    <div>
                      <strong>{task.title}</strong>
                      <p>
                        {task.estimatedMinutes ? `${task.estimatedMinutes} 分钟` : '未估时'}
                        {task.difficulty ? ` · 难度 ${task.difficulty}` : ''}
                        {task.priority !== 'medium' ? ` · ${priorityLabel(task.priority)}` : ''}
                      </p>
                    </div>
                    {task.status === 'blocked' ? (
                      <span className="blocked-label">
                        <AlertCircle size={13} />
                        阻塞
                      </span>
                    ) : (
                      <button
                        className={`start-task${isCurrent ? ' current' : ''}`}
                        disabled={Boolean(active) || startMutation.isPending}
                        onClick={() => startMutation.mutate({ task })}
                      >
                        {isCurrent ? <TimerReset size={15} /> : <Play size={14} fill="currentColor" />}
                        {isCurrent ? '计时中' : '开始'}
                      </button>
                    )}
                    <div className="today-task-quick">
                      <button type="button" title="转明日" onClick={() => void quickUpdate(task, { id: task.id, startDate: tomorrowDate() })}>明日</button>
                      <button type="button" title="延期一天" onClick={() => void quickUpdate(task, { id: task.id, dueAt: task.dueAt ? new Date(Date.parse(task.dueAt) + 86_400_000).toISOString() : new Date(Date.now() + 86_400_000).toISOString() })}>延期</button>
                      <button type="button" title="标为阻塞" onClick={() => void quickUpdate(task, { id: task.id, status: 'blocked' })}>阻塞</button>
                    </div>
                  </article>
                )
              })}
            </div>
          )}
          {remainingTasks.length > 0 && (
            <details className="today-backlog">
              <summary>未安排待办 · {remainingTasks.length} 项</summary>
              <div>{remainingTasks.map((task) => <span key={task.id}><strong>{task.title}</strong><small>{task.estimatedMinutes ? `${task.estimatedMinutes} 分钟` : '未估时'}</small></span>)}</div>
            </details>
          )}
        </section>

        <aside className="today-aside">
          <section className="panel today-summary">
            <span className="section-label">今天的事实</span>
            <div>
              <strong>{formatMinutes(actualMinutes)}</strong>
              <small>已投入</small>
            </div>
            <div>
              <strong>{tasks.filter((task) => task.status === 'in_progress').length}</strong>
              <small>进行中</small>
            </div>
            <div>
              <strong>{tasks.filter((task) => task.status === 'blocked').length}</strong>
              <small>阻塞</small>
            </div>
          </section>
          <section className="panel execution-note">
            <Flag size={18} />
            <strong>今天最重要的一件事</strong>
            <p>{tasks[0]?.title ?? '尚未设置。选择一个真正影响结果的下一步。'}</p>
          </section>
          <section className="panel today-schedule">
            <span className="section-label">已安排时间块</span>
            {(blocksQuery.data ?? []).length === 0 ? <p>今天还没有时间块。</p> : (blocksQuery.data ?? []).map((block) => <article key={block.id}><strong>{new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(new Date(block.startsAt))}</strong><span>{block.title}</span><small>{block.durationMinutes} 分钟</small></article>)}
          </section>
        </aside>
      </div>

      {active && (
        <StopEffortDialog
          effort={active}
          open={stopDialogOpen}
          onOpenChange={setStopDialogOpen}
          onStopped={async () => {
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: ['active-effort'] }),
              queryClient.invalidateQueries({ queryKey: ['today-tasks'] }),
              queryClient.invalidateQueries({ queryKey: ['efforts'] })
            ])
          }}
        />
      )}
      <Dialog.Root open={overrideTask !== null} onOpenChange={(open) => { if (!open) { setOverrideTask(null); setOverrideReason('') } }}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="dialog-content"><div className="dialog-heading"><div><span className="section-label">前置任务尚未完成</span><Dialog.Title>强制开始“{overrideTask?.title}”</Dialog.Title><Dialog.Description>覆盖原因会写入活动历史，不会解除原依赖。</Dialog.Description></div><Dialog.Close className="dialog-close" aria-label="关闭"><X size={18} /></Dialog.Close></div><div className="dialog-form"><label><span>强制开始原因</span><textarea autoFocus value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} /></label></div><div className="dialog-actions"><Dialog.Close className="button button-secondary">取消</Dialog.Close><button className="button button-primary" disabled={!overrideReason.trim() || !overrideTask} onClick={() => { if (!overrideTask) return; startMutation.mutate({ task: overrideTask, dependencyOverrideReason: overrideReason }, { onSuccess: () => { setOverrideTask(null); setOverrideReason('') } }) }}>记录原因并开始</button></div></Dialog.Content></Dialog.Portal></Dialog.Root>
      {actionError && <div className="data-feedback error">{actionError}<button aria-label="关闭提示" onClick={() => setActionError('')}><X size={13} /></button></div>}
    </main>
  )
}

function StopEffortDialog({
  effort,
  open,
  onOpenChange,
  onStopped
}: {
  effort: EffortEntry
  open: boolean
  onOpenChange: (open: boolean) => void
  onStopped: () => Promise<void>
}): React.JSX.Element {
  const [result, setResult] = useState('')
  const [obstacles, setObstacles] = useState('')
  const [nextStep, setNextStep] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const stop = async (): Promise<void> => {
    setBusy(true)
    setError('')
    const response = await window.youtrace.execution.stopEffort({
      id: effort.id,
      result,
      interruptions: '',
      obstacles,
      nextStep,
      energy: null,
      perceivedDifficulty: null
    })
    setBusy(false)
    if (!response.ok) {
      setError(response.error.message)
      return
    }
    await onStopped()
    onOpenChange(false)
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content">
          <div className="dialog-heading">
            <div>
              <span className="section-label">停止计时</span>
              <Dialog.Title>这段投入留下了什么？</Dialog.Title>
              <Dialog.Description>{effort.entityTitle}</Dialog.Description>
            </div>
            <Dialog.Close className="dialog-close" aria-label="关闭">
              <X size={18} />
            </Dialog.Close>
          </div>
          <div className="dialog-form">
            <label>
              <span>实际结果</span>
              <textarea autoFocus value={result} onChange={(event) => setResult(event.target.value)} placeholder="完成了什么，或确认了什么？" />
            </label>
            <label>
              <span>困难</span>
              <input value={obstacles} onChange={(event) => setObstacles(event.target.value)} placeholder="遇到了什么阻碍？" />
            </label>
            <label>
              <span>下一步</span>
              <input value={nextStep} onChange={(event) => setNextStep(event.target.value)} placeholder="下一次从哪里继续？" />
            </label>
            {error && <div className="inline-error">{error}</div>}
          </div>
          <div className="dialog-actions">
            <Dialog.Close className="button button-secondary">继续计时</Dialog.Close>
            <button className="button button-primary" disabled={busy} onClick={() => void stop()}>
              {busy ? '正在保存…' : '保存并停止'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function formatClock(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = seconds % 60
  return [hours, minutes, rest].map((value) => value.toString().padStart(2, '0')).join(':')
}

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours}h ${rest}m` : `${hours}h`
}

function priorityLabel(priority: Task['priority']): string {
  return { low: '低优先级', medium: '中优先级', high: '高优先级', critical: '关键任务' }[
    priority
  ]
}

function tomorrowDate(): string {
  const date = new Date()
  date.setDate(date.getDate() + 1)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 10)
}
