import * as Dialog from '@radix-ui/react-dialog'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Flag,
  Layers3,
  Plus,
  Target,
  X
} from 'lucide-react'
import { useMemo, useState } from 'react'
import type {
  Countdown,
  CreateCountdownInput,
  CreatePlanInput,
  IpcResult,
  PlanPeriod,
  Project,
  Tag,
  Task,
  TimeBlock
} from '../../../shared/contracts'

type CalendarView = 'day' | 'week' | 'month' | 'plans' | 'countdowns'

function unwrap<T>(result: IpcResult<T>): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.data
}

function localDate(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 10)
}

function startOfWeek(date: Date): Date {
  const result = new Date(date)
  result.setHours(0, 0, 0, 0)
  const day = result.getDay()
  result.setDate(result.getDate() - (day === 0 ? 6 : day - 1))
  return result
}

function startOfDay(date: Date): Date {
  const result = new Date(date)
  result.setHours(0, 0, 0, 0)
  return result
}

function startOfMonthGrid(date: Date): Date {
  const first = new Date(date.getFullYear(), date.getMonth(), 1)
  return startOfWeek(first)
}

function addDays(date: Date, amount: number): Date {
  const result = new Date(date)
  result.setDate(result.getDate() + amount)
  return result
}

function toLocalDateTimeValue(date = new Date()): string {
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

export function CalendarPage(): React.JSX.Element {
  const queryClient = useQueryClient()
  const [view, setView] = useState<CalendarView>('week')
  const [anchorDate, setAnchorDate] = useState(() => new Date())
  const [blockDialogOpen, setBlockDialogOpen] = useState(false)
  const [planDialogOpen, setPlanDialogOpen] = useState(false)
  const [countdownDialogOpen, setCountdownDialogOpen] = useState(false)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const weekStart = useMemo(() => startOfWeek(anchorDate), [anchorDate])
  const calendarStart = useMemo(
    () =>
      view === 'day'
        ? startOfDay(anchorDate)
        : view === 'month'
          ? startOfMonthGrid(anchorDate)
          : weekStart,
    [anchorDate, view, weekStart]
  )
  const dayCount = view === 'day' ? 1 : view === 'month' ? 42 : 7
  const days = useMemo(
    () => Array.from({ length: dayCount }, (_, index) => addDays(calendarStart, index)),
    [calendarStart, dayCount]
  )
  const rangeStart = calendarStart.toISOString()
  const rangeEnd = addDays(calendarStart, dayCount).toISOString()

  const tasksQuery = useQuery({
    queryKey: ['tasks', 'calendar'],
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
  const projectsQuery = useQuery({
    queryKey: ['projects'],
    queryFn: async () => unwrap(await window.youtrace.planning.listProjects())
  })
  const tagsQuery = useQuery({
    queryKey: ['tags'],
    queryFn: async () => unwrap(await window.youtrace.planning.listTags())
  })
  const blocksQuery = useQuery({
    queryKey: ['time-blocks', rangeStart, rangeEnd],
    queryFn: async () =>
      unwrap(await window.youtrace.temporal.listTimeBlocks({ start: rangeStart, end: rangeEnd }))
  })
  const plansQuery = useQuery({
    queryKey: ['plans', localDate(weekStart), localDate(addDays(weekStart, 6))],
    queryFn: async () =>
      unwrap(
        await window.youtrace.temporal.listPlans(
          localDate(weekStart),
          localDate(addDays(weekStart, 6))
        )
      )
  })
  const countdownsQuery = useQuery({
    queryKey: ['countdowns'],
    queryFn: async () => unwrap(await window.youtrace.temporal.listCountdowns(new Date().toISOString()))
  })

  const blocks = blocksQuery.data ?? []
  const moveToDay = async (block: TimeBlock, day: Date): Promise<void> => {
    const start = new Date(block.startsAt)
    const end = new Date(block.endsAt)
    const duration = end.getTime() - start.getTime()
    const movedStart = new Date(day)
    movedStart.setHours(start.getHours(), start.getMinutes(), 0, 0)
    const result = await window.youtrace.temporal.moveTimeBlock({
      id: block.id,
      startsAt: movedStart.toISOString(),
      endsAt: new Date(movedStart.getTime() + duration).toISOString()
    })
    if (result.ok) await queryClient.invalidateQueries({ queryKey: ['time-blocks'] })
  }

  return (
    <div className="calendar-page">
      <header className="calendar-toolbar">
        <div>
          <span className="page-kicker">承诺、安排与期限分开管理</span>
          <h1>日历</h1>
          <p>拖动时间块只改变安排，不会修改任务截止日期。</p>
        </div>
        <div className="toolbar-actions">
          <button className="button button-secondary" type="button" onClick={() => setPlanDialogOpen(true)}>
            <Layers3 size={15} />
            新建计划
          </button>
          <button className="button button-primary" type="button" onClick={() => setBlockDialogOpen(true)}>
            <Plus size={15} />
            时间块
          </button>
        </div>
      </header>

      <div className="calendar-tabs" role="tablist" aria-label="日历视图">
        <button role="tab" aria-selected={view === 'day'} className={view === 'day' ? 'active' : ''} onClick={() => setView('day')}>日</button>
        <button role="tab" aria-selected={view === 'week'} className={view === 'week' ? 'active' : ''} onClick={() => setView('week')}>周日历</button>
        <button role="tab" aria-selected={view === 'month'} className={view === 'month' ? 'active' : ''} onClick={() => setView('month')}>月</button>
        <button role="tab" aria-selected={view === 'plans'} className={view === 'plans' ? 'active' : ''} onClick={() => setView('plans')}>周期计划</button>
        <button role="tab" aria-selected={view === 'countdowns'} className={view === 'countdowns' ? 'active' : ''} onClick={() => setView('countdowns')}>倒计时</button>
      </div>

      {['day', 'week', 'month'].includes(view) && (
        <section className={`week-calendar panel calendar-view-${view}`}>
          <header>
            <button type="button" aria-label="上一周期" onClick={() => setAnchorDate(navigateCalendar(anchorDate, view, -1))}><ChevronLeft size={16} /></button>
            <div>
              <strong>{calendarRangeLabel(view, days)}</strong>
              <span>每日容量 8 小时</span>
            </div>
            <button type="button" aria-label="下一周期" onClick={() => setAnchorDate(navigateCalendar(anchorDate, view, 1))}><ChevronRight size={16} /></button>
          </header>
          <div className="week-grid">
            {days.map((day) => {
              const date = localDate(day)
              const dayBlocks = blocks.filter((block) => localDate(new Date(block.startsAt)) === date)
              const totalMinutes = dayBlocks.reduce((sum, block) => sum + block.durationMinutes, 0)
              return (
                <section
                  className={`calendar-day ${date === localDate(new Date()) ? 'today' : ''} ${view === 'month' && day.getMonth() !== anchorDate.getMonth() ? 'outside-month' : ''}`}
                  key={date}
                  aria-label={`${date} 安排`}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => {
                    const block = blocks.find((candidate) => candidate.id === draggingId)
                    if (block) void moveToDay(block, day)
                    setDraggingId(null)
                  }}
                >
                  <header>
                    <span>{new Intl.DateTimeFormat('zh-CN', { weekday: 'short' }).format(day)}</span>
                    <strong>{day.getDate()}</strong>
                    <small className={totalMinutes > 480 ? 'overloaded' : ''}>
                      {Math.round(totalMinutes / 60 * 10) / 10}h / 8h
                    </small>
                  </header>
                  <div className="day-blocks">
                    {dayBlocks.map((block) => (
                      <article
                        key={block.id}
                        draggable
                        className={block.conflicts.length > 0 ? 'conflict' : ''}
                        onDragStart={() => setDraggingId(block.id)}
                        onDragEnd={() => setDraggingId(null)}
                      >
                        <span>{new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(new Date(block.startsAt))}</span>
                        <strong>{block.title}</strong>
                        <small>{block.durationMinutes} 分钟</small>
                        {block.conflicts.length > 0 && <AlertTriangle size={12} />}
                      </article>
                    ))}
                    {dayBlocks.length === 0 && <span className="day-empty">拖到这里安排</span>}
                  </div>
                </section>
              )
            })}
          </div>
          {blocks.some((block) => block.conflicts.length > 0) && (
            <footer className="calendar-warning">
              <AlertTriangle size={14} />
              有时间块发生冲突；系统保留安排并明确标记，不会静默覆盖。
            </footer>
          )}
        </section>
      )}

      {view === 'plans' && (
        <section className="plan-board">
          {(plansQuery.data ?? []).length === 0 ? (
            <CalendarEmpty title="本周还没有周期计划" copy="计划引用现有任务；后续调整任务时，不会产生另一份副本。" action="新建计划" onAction={() => setPlanDialogOpen(true)} />
          ) : (
            (plansQuery.data ?? []).map((plan) => <PlanCard key={plan.id} plan={plan} />)
          )}
        </section>
      )}

      {view === 'countdowns' && (
        <section className="countdown-board">
          <header>
            <div><span className="section-label">自然日、工作日与真实速度</span><h2>期限雷达</h2></div>
            <button className="button button-primary" type="button" onClick={() => setCountdownDialogOpen(true)}><Plus size={15} />新建倒计时</button>
          </header>
          {(countdownsQuery.data ?? []).length === 0 ? (
            <CalendarEmpty title="还没有倒计时" copy="添加期限和剩余工作量后，系统会给出建议速度与风险原因。" action="建立第一个倒计时" onAction={() => setCountdownDialogOpen(true)} />
          ) : (
            <div className="countdown-list">
              {(countdownsQuery.data ?? []).map((countdown) => <CountdownCard key={countdown.id} countdown={countdown} />)}
            </div>
          )}
        </section>
      )}

      <TimeBlockDialog
        open={blockDialogOpen}
        onOpenChange={setBlockDialogOpen}
        tasks={tasksQuery.data ?? []}
        onCreated={() => queryClient.invalidateQueries({ queryKey: ['time-blocks'] })}
      />
      <PlanDialog
        open={planDialogOpen}
        onOpenChange={setPlanDialogOpen}
        tasks={tasksQuery.data ?? []}
        onCreated={() => queryClient.invalidateQueries({ queryKey: ['plans'] })}
      />
      <CountdownDialog
        open={countdownDialogOpen}
        onOpenChange={setCountdownDialogOpen}
        projects={projectsQuery.data ?? []}
        tasks={tasksQuery.data ?? []}
        tags={tagsQuery.data ?? []}
        onCreated={() => queryClient.invalidateQueries({ queryKey: ['countdowns'] })}
      />
    </div>
  )
}

function PlanCard({ plan }: { plan: PlanPeriod }): React.JSX.Element {
  return (
    <article className={`plan-card panel ${plan.overloaded ? 'overloaded' : ''}`}>
      <header>
        <div><span>{plan.periodType === 'week' ? '周计划' : `${plan.periodType} 计划`}</span><h2>{plan.title}</h2></div>
        <strong>{plan.startDate} — {plan.endDate}</strong>
      </header>
      <p>{plan.focusResult || '未填写重点结果'}</p>
      <div className="plan-capacity">
        <span style={{ width: `${plan.capacityMinutes ? Math.min(100, plan.plannedMinutes / plan.capacityMinutes * 100) : 0}%` }} />
      </div>
      <footer>
        <span>承诺 {plan.items.length} 项 · {plan.plannedMinutes} 分钟</span>
        <strong>{plan.capacityMinutes ? `容量 ${plan.capacityMinutes} 分钟` : '未设置容量'}</strong>
        {plan.overloaded && <em><AlertTriangle size={12} />计划超载</em>}
      </footer>
      <div className="plan-items">{plan.items.map((item) => <span key={item.id}>{item.titleSnapshot}</span>)}</div>
    </article>
  )
}

export function CountdownCard({ countdown, compact = false }: { countdown: Countdown; compact?: boolean }): React.JSX.Element {
  const riskLabels: Record<Countdown['risk'], string> = { normal: '正常', attention: '注意', danger: '危险', overdue: '逾期' }
  return (
    <article className={`countdown-card countdown-${countdown.risk} ${compact ? 'compact' : ''}`}>
      <header><span>{riskLabels[countdown.risk]}</span><Flag size={14} /></header>
      <div className="countdown-days"><strong>{countdown.naturalDays >= 0 ? countdown.naturalDays : Math.abs(countdown.naturalDays)}</strong><span>{countdown.naturalDays >= 0 ? '自然日' : '已逾期天'}</span></div>
      <h3>{countdown.title}</h3>
      {!compact && <>
        <div className="countdown-facts">
          <span><CalendarDays size={13} />{countdown.effectiveWorkdays} 个有效工作日</span>
          <span><Clock3 size={13} />{countdown.suggestedDailyMinutes === null ? '暂无速度建议' : `建议 ${countdown.suggestedDailyMinutes} 分钟/日`}</span>
        </div>
        <p>{countdown.riskReason}</p>
      </>}
    </article>
  )
}

function CalendarEmpty(props: { title: string; copy: string; action: string; onAction: () => void }): React.JSX.Element {
  return <div className="calendar-empty panel"><Target size={28} /><strong>{props.title}</strong><p>{props.copy}</p><button className="button button-secondary" onClick={props.onAction}><Plus size={14} />{props.action}</button></div>
}

function DialogFrame(props: { open: boolean; onOpenChange: (open: boolean) => void; title: string; description: string; children: React.ReactNode }): React.JSX.Element {
  return <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="dialog-content"><div className="dialog-heading"><div><span className="section-label">时间不会自动变成承诺</span><Dialog.Title>{props.title}</Dialog.Title><Dialog.Description>{props.description}</Dialog.Description></div><Dialog.Close className="dialog-close" aria-label="关闭"><X size={18} /></Dialog.Close></div>{props.children}</Dialog.Content></Dialog.Portal></Dialog.Root>
}

function TimeBlockDialog(props: { open: boolean; onOpenChange: (open: boolean) => void; tasks: Task[]; onCreated: () => Promise<unknown> }): React.JSX.Element {
  const initialStart = useMemo(() => {
    const date = new Date()
    date.setMinutes(0, 0, 0)
    date.setHours(date.getHours() + 1)
    return toLocalDateTimeValue(date)
  }, [props.open])
  const [title, setTitle] = useState('')
  const [taskId, setTaskId] = useState('')
  const [startsAt, setStartsAt] = useState(initialStart)
  const [endsAt, setEndsAt] = useState(toLocalDateTimeValue(new Date(new Date(initialStart).getTime() + 3_600_000)))
  const [error, setError] = useState('')
  const submit = async (): Promise<void> => {
    const result = await window.youtrace.temporal.createTimeBlock({
      taskId: taskId || null,
      title,
      note: '',
      startsAt: new Date(startsAt).toISOString(),
      endsAt: new Date(endsAt).toISOString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
    })
    if (!result.ok) return setError(result.error.message)
    await props.onCreated()
    setTitle('')
    props.onOpenChange(false)
  }
  return <DialogFrame open={props.open} onOpenChange={props.onOpenChange} title="新建时间块" description="安排可以拖动，关联任务的截止日期保持不变。"><div className="dialog-form"><label><span>时间块标题</span><input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} /></label><label><span>关联任务</span><select value={taskId} onChange={(event) => { setTaskId(event.target.value); const task = props.tasks.find((item) => item.id === event.target.value); if (task && !title) setTitle(task.title) }}><option value="">不关联任务</option>{props.tasks.filter((task) => task.status !== 'completed' && task.status !== 'cancelled').map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}</select></label><div className="form-row"><label><span>开始时间</span><input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></label><label><span>结束时间</span><input type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} /></label></div>{error && <div className="inline-error">{error}</div>}</div><div className="dialog-actions"><Dialog.Close className="button button-secondary">取消</Dialog.Close><button className="button button-primary" disabled={!title.trim() || !startsAt || !endsAt} onClick={() => void submit()}>创建时间块</button></div></DialogFrame>
}

function PlanDialog(props: { open: boolean; onOpenChange: (open: boolean) => void; tasks: Task[]; onCreated: () => Promise<unknown> }): React.JSX.Element {
  const thisWeek = startOfWeek(new Date())
  const [periodType, setPeriodType] = useState<CreatePlanInput['periodType']>('week')
  const [title, setTitle] = useState('本周计划')
  const [focusResult, setFocusResult] = useState('')
  const [startDate, setStartDate] = useState(localDate(thisWeek))
  const [endDate, setEndDate] = useState(localDate(addDays(thisWeek, 6)))
  const [capacity, setCapacity] = useState('2400')
  const [taskIds, setTaskIds] = useState<string[]>([])
  const submit = async (): Promise<void> => {
    const input: CreatePlanInput = { periodType, startDate, endDate, title, focusResult, capacityMinutes: capacity ? Number(capacity) : null, items: taskIds.map((id) => { const task = props.tasks.find((item) => item.id === id)!; return { entityType: 'task' as const, entityId: id, titleSnapshot: task.title } }) }
    const result = await window.youtrace.temporal.createPlan(input)
    if (!result.ok) return
    await props.onCreated()
    setTaskIds([])
    props.onOpenChange(false)
  }
  return <DialogFrame open={props.open} onOpenChange={props.onOpenChange} title="新建周期计划" description="计划引用现有对象，并用容量检验承诺是否现实。"><div className="dialog-form"><div className="form-row"><label><span>计划名称</span><input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} /></label><label><span>周期层级</span><select value={periodType} onChange={(event) => setPeriodType(event.target.value as CreatePlanInput['periodType'])}><option value="year">年计划</option><option value="quarter">季度计划</option><option value="month">月计划</option><option value="week">周计划</option><option value="day">日计划</option></select></label></div><label><span>本周期重点结果</span><textarea value={focusResult} onChange={(event) => setFocusResult(event.target.value)} /></label><div className="form-row form-row-three"><label><span>开始日期</span><input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label><label><span>结束日期</span><input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label><label><span>可用分钟</span><input type="number" value={capacity} onChange={(event) => setCapacity(event.target.value)} /></label></div><fieldset className="plan-task-picker"><legend>承诺事项</legend>{props.tasks.filter((task) => task.status !== 'completed' && task.status !== 'cancelled').map((task) => <button type="button" key={task.id} className={taskIds.includes(task.id) ? 'active' : ''} onClick={() => setTaskIds((current) => current.includes(task.id) ? current.filter((id) => id !== task.id) : [...current, task.id])}>{task.title}<span>{task.estimatedMinutes ?? '—'} 分钟</span></button>)}</fieldset></div><div className="dialog-actions"><Dialog.Close className="button button-secondary">取消</Dialog.Close><button className="button button-primary" disabled={!title.trim()} onClick={() => void submit()}>创建计划</button></div></DialogFrame>
}

function CountdownDialog(props: { open: boolean; onOpenChange: (open: boolean) => void; projects: Project[]; tasks: Task[]; tags: Tag[]; onCreated: () => Promise<unknown> }): React.JSX.Element {
  const [title, setTitle] = useState('')
  const [targetAt, setTargetAt] = useState(toLocalDateTimeValue(addDays(new Date(), 7)))
  const [bufferDays, setBufferDays] = useState('1')
  const [remainingMinutes, setRemainingMinutes] = useState('')
  const [importance, setImportance] = useState<CreateCountdownInput['importance']>('normal')
  const [taskId, setTaskId] = useState('')
  const [tagIds, setTagIds] = useState<string[]>([])
  const [error, setError] = useState('')
  const submit = async (): Promise<void> => {
    const result = await window.youtrace.temporal.createCountdown({
      title,
      targetAt: new Date(targetAt).toISOString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      workingDays: [1, 2, 3, 4, 5],
      bufferDays: Number(bufferDays || 0),
      importance,
      entityType: taskId ? 'task' : null,
      entityId: taskId || null,
      remainingMinutes: remainingMinutes ? Number(remainingMinutes) : null,
      tagIds
    })
    if (!result.ok) return setError(result.error.message)
    await props.onCreated()
    setTitle('')
    setRemainingMinutes('')
    props.onOpenChange(false)
  }
  return <DialogFrame open={props.open} onOpenChange={props.onOpenChange} title="新建倒计时" description="风险只基于期限、剩余工作量与真实投入，不伪造历史速度。"><div className="dialog-form"><label><span>倒计时标题</span><input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} /></label><div className="form-row"><label><span>目标时间</span><input type="datetime-local" value={targetAt} onChange={(event) => setTargetAt(event.target.value)} /></label><label><span>关联任务</span><select value={taskId} onChange={(event) => setTaskId(event.target.value)}><option value="">独立倒计时</option>{props.tasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}</select></label></div><div className="form-row form-row-three"><label><span>剩余分钟</span><input type="number" min="0" value={remainingMinutes} onChange={(event) => setRemainingMinutes(event.target.value)} /></label><label><span>缓冲工作日</span><input type="number" min="0" value={bufferDays} onChange={(event) => setBufferDays(event.target.value)} /></label><label><span>重要程度</span><select value={importance} onChange={(event) => setImportance(event.target.value as CreateCountdownInput['importance'])}><option value="low">低</option><option value="normal">普通</option><option value="high">高</option><option value="critical">关键</option></select></label></div>{props.tags.length > 0 && <fieldset className="tag-picker"><legend>标签</legend><div>{props.tags.map((tag) => <button type="button" key={tag.id} className={tagIds.includes(tag.id) ? 'active' : ''} onClick={() => setTagIds((current) => current.includes(tag.id) ? current.filter((id) => id !== tag.id) : [...current, tag.id])}>{tag.name}</button>)}</div></fieldset>}{error && <div className="inline-error">{error}</div>}</div><div className="dialog-actions"><Dialog.Close className="button button-secondary">取消</Dialog.Close><button className="button button-primary" disabled={!title.trim() || !targetAt} onClick={() => void submit()}>创建倒计时</button></div></DialogFrame>
}

function navigateCalendar(date: Date, view: CalendarView, direction: -1 | 1): Date {
  const result = new Date(date)
  if (view === 'month') result.setMonth(result.getMonth() + direction)
  else result.setDate(result.getDate() + direction * (view === 'week' ? 7 : 1))
  return result
}

function calendarRangeLabel(view: CalendarView, days: Date[]): string {
  if (view === 'day') {
    return new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'long'
    }).format(days[0])
  }
  if (view === 'month') {
    return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long' }).format(
      days[20] ?? days[0]
    )
  }
  return `${localDate(days[0]!)} — ${localDate(days.at(-1)!)}`
}
