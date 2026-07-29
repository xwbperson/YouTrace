import * as Dialog from '@radix-ui/react-dialog'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  BarChart3,
  BookOpen,
  Check,
  Circle,
  Flame,
  Gauge,
  Plus,
  RotateCcw,
  Target,
  X
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type {
  Course,
  CreateCourseInput,
  CreateHabitInput,
  CreateKnowledgeInput,
  CreateMetricInput,
  CreateMistakeInput,
  Habit,
  IpcResult,
  Metric,
  Project
} from '../../../shared/contracts'

type PracticeView = 'habits' | 'metrics' | 'learning'

function unwrap<T>(result: IpcResult<T>): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.data
}

function localDate(date = new Date()): string {
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 10)
}

export function PracticePage(): React.JSX.Element {
  const queryClient = useQueryClient()
  const [view, setView] = useState<PracticeView>('habits')
  const [scopeId, setScopeId] = useState<string>('personal')
  const [habitDialogOpen, setHabitDialogOpen] = useState(false)
  const [metricDialogOpen, setMetricDialogOpen] = useState(false)
  const [courseDialogOpen, setCourseDialogOpen] = useState(false)
  const [metricToRecord, setMetricToRecord] = useState<Metric | null>(null)
  const [knowledgeDialogOpen, setKnowledgeDialogOpen] = useState(false)
  const [mistakeDialogOpen, setMistakeDialogOpen] = useState(false)
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null)
  const today = useMemo(() => localDate(), [])
  const projectId = scopeId === 'personal' ? null : scopeId

  const projectsQuery = useQuery({
    queryKey: ['projects'],
    queryFn: async () => unwrap(await window.youtrace.planning.listProjects())
  })
  const habitsQuery = useQuery({
    queryKey: ['habits', projectId, today],
    queryFn: async () => unwrap(await window.youtrace.practice.listHabits(projectId, today))
  })
  const metricsQuery = useQuery({
    queryKey: ['metrics', projectId],
    queryFn: async () => unwrap(await window.youtrace.practice.listMetrics(projectId))
  })
  const coursesQuery = useQuery({
    queryKey: ['courses'],
    queryFn: async () => unwrap(await window.youtrace.practice.listCourses())
  })

  const projects = projectsQuery.data ?? []
  const courses = coursesQuery.data ?? []
  useEffect(() => {
    if (!selectedCourseId && courses[0]) setSelectedCourseId(courses[0].id)
    if (selectedCourseId && !courses.some((course) => course.id === selectedCourseId)) {
      setSelectedCourseId(courses[0]?.id ?? null)
    }
  }, [courses, selectedCourseId])
  const selectedCourse = courses.find((course) => course.id === selectedCourseId) ?? null

  const knowledgeQuery = useQuery({
    queryKey: ['knowledge', selectedCourse?.projectId],
    enabled: selectedCourse !== null,
    queryFn: async () =>
      unwrap(await window.youtrace.practice.listKnowledge(selectedCourse!.projectId))
  })
  const mistakesQuery = useQuery({
    queryKey: ['mistakes', selectedCourse?.projectId],
    enabled: selectedCourse !== null,
    queryFn: async () =>
      unwrap(await window.youtrace.practice.listMistakes(selectedCourse!.projectId))
  })

  const recordHabit = useMutation({
    mutationFn: async (input: { habit: Habit; status: 'completed' | 'skipped' }) =>
      unwrap(
        await window.youtrace.practice.recordHabit({
          habitId: input.habit.id,
          date: today,
          status: input.status,
          skipReason: input.status === 'skipped' ? '今日主动跳过' : null
        })
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['habits'] })
    }
  })

  const scopeSelector = (
    <label className="practice-scope">
      <span>范围</span>
      <select value={scopeId} onChange={(event) => setScopeId(event.target.value)}>
        <option value="personal">个人</option>
        {projects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.name}
          </option>
        ))}
      </select>
    </label>
  )

  return (
    <div className="practice-page">
      <div className="practice-tabs" role="tablist" aria-label="实践类型">
        <button
          type="button"
          role="tab"
          aria-selected={view === 'habits'}
          className={view === 'habits' ? 'active' : ''}
          onClick={() => setView('habits')}
        >
          <Flame size={15} />
          习惯
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === 'metrics'}
          className={view === 'metrics' ? 'active' : ''}
          onClick={() => setView('metrics')}
        >
          <BarChart3 size={15} />
          指标
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === 'learning'}
          className={view === 'learning' ? 'active' : ''}
          onClick={() => setView('learning')}
        >
          <BookOpen size={15} />
          课程学习
        </button>
      </div>

      {view === 'habits' && (
        <section className="practice-section">
          <header>
            <div>
              <span className="section-label">重复行动的真实记录</span>
              <h2>今日习惯</h2>
              <p>完成与跳过都是事实；跳过不会被伪装成成功。</p>
            </div>
            <div className="practice-actions">
              {scopeSelector}
              <button className="button button-primary" type="button" onClick={() => setHabitDialogOpen(true)}>
                <Plus size={15} />
                新建习惯
              </button>
            </div>
          </header>
          {(habitsQuery.data ?? []).length === 0 ? (
            <PracticeEmpty
              icon={<Flame size={25} />}
              title="还没有这个范围的习惯"
              copy="从一个小而明确、可以每天留下事实的动作开始。"
              action="创建第一个习惯"
              onAction={() => setHabitDialogOpen(true)}
            />
          ) : (
            <div className="habit-grid">
              {(habitsQuery.data ?? []).map((habit) => (
                <article key={habit.id} className={`habit-card ${habit.todayStatus ?? ''}`}>
                  <button
                    type="button"
                    className="habit-check"
                    aria-label={habit.todayStatus === 'completed' ? `重新记录 ${habit.name}` : `完成 ${habit.name}`}
                    onClick={() => recordHabit.mutate({ habit, status: 'completed' })}
                  >
                    {habit.todayStatus === 'completed' ? <Check size={18} /> : <Circle size={18} />}
                  </button>
                  <div>
                    <strong>{habit.name}</strong>
                    <span>
                      {habit.frequency === 'daily' ? '每天' : habit.frequency === 'weekly' ? '每周' : habit.frequency === 'weekdays' ? '工作日' : '自定义'}
                      {habit.reminderTime ? ` · ${habit.reminderTime}` : ''}
                    </span>
                  </div>
                  <div className="habit-streak">
                    <Flame size={14} />
                    <strong>{habit.currentStreak}</strong>
                    <span>连续</span>
                  </div>
                  <button
                    type="button"
                    className="quiet-action"
                    onClick={() => recordHabit.mutate({ habit, status: 'skipped' })}
                  >
                    跳过
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {view === 'metrics' && (
        <section className="practice-section">
          <header>
            <div>
              <span className="section-label">观察趋势，不替代结果</span>
              <h2>可量化指标</h2>
              <p>累计型指标求和，周期型指标保留最近一次真实值。</p>
            </div>
            <div className="practice-actions">
              {scopeSelector}
              <button className="button button-primary" type="button" onClick={() => setMetricDialogOpen(true)}>
                <Plus size={15} />
                新建指标
              </button>
            </div>
          </header>
          {(metricsQuery.data ?? []).length === 0 ? (
            <PracticeEmpty
              icon={<Gauge size={25} />}
              title="还没有这个范围的指标"
              copy="选择真正影响决策的数字，不必记录一切。"
              action="创建第一个指标"
              onAction={() => setMetricDialogOpen(true)}
            />
          ) : (
            <div className="metric-grid">
              {(metricsQuery.data ?? []).map((metric) => {
                const progress =
                  metric.targetValue === 0
                    ? 0
                    : Math.max(0, Math.min(1, metric.currentValue / metric.targetValue))
                return (
                  <article className="metric-card" key={metric.id}>
                    <header>
                      <span>{metric.period === 'total' ? '累计' : '最近记录'}</span>
                      <Target size={16} />
                    </header>
                    <strong>
                      {metric.currentValue}
                      <small>{metric.unit}</small>
                    </strong>
                    <p>{metric.name}</p>
                    <div className="metric-track">
                      <span style={{ width: `${progress * 100}%` }} />
                    </div>
                    <footer>
                      <span>目标 {metric.targetValue}{metric.unit}</span>
                      <button type="button" onClick={() => setMetricToRecord(metric)}>
                        <Plus size={13} />
                        记录
                      </button>
                    </footer>
                  </article>
                )
              })}
            </div>
          )}
        </section>
      )}

      {view === 'learning' && (
        <section className="practice-section learning-section">
          <header>
            <div>
              <span className="section-label">教材、知识、错题与复习</span>
              <h2>课程学习</h2>
              <p>课程项目承载学习结果，掌握度与项目进度保持独立。</p>
            </div>
            <button className="button button-primary" type="button" onClick={() => setCourseDialogOpen(true)}>
              <Plus size={15} />
              建立课程
            </button>
          </header>
          {courses.length === 0 ? (
            <PracticeEmpty
              icon={<BookOpen size={25} />}
              title="还没有课程档案"
              copy="先建立一个项目，再把教材、知识点和错题接到同一条学习轨迹。"
              action="建立第一门课程"
              onAction={() => setCourseDialogOpen(true)}
            />
          ) : (
            <div className="learning-layout">
              <aside className="course-rail">
                {courses.map((course) => (
                  <button
                    type="button"
                    key={course.id}
                    className={course.id === selectedCourseId ? 'active' : ''}
                    onClick={() => setSelectedCourseId(course.id)}
                  >
                    <strong>{course.courseName}</strong>
                    <span>
                      {course.knowledgeCount} 知识 · {course.mistakeCount} 错题
                    </span>
                    {course.pendingReviewCount > 0 && <em>{course.pendingReviewCount} 待复习</em>}
                  </button>
                ))}
              </aside>
              {selectedCourse && (
                <main className="course-workspace">
                  <header>
                    <div>
                      <span>{selectedCourse.textbook?.title ?? '未设置教材'}</span>
                      <h3>{selectedCourse.courseName}</h3>
                    </div>
                    <div>
                      <button className="button button-secondary" type="button" onClick={() => setKnowledgeDialogOpen(true)}>
                        <Plus size={14} />
                        知识点
                      </button>
                      <button className="button button-secondary" type="button" onClick={() => setMistakeDialogOpen(true)}>
                        <Plus size={14} />
                        错题
                      </button>
                    </div>
                  </header>
                  <div className="learning-columns">
                    <section>
                      <div className="learning-heading">
                        <span>知识点</span>
                        <strong>{knowledgeQuery.data?.length ?? 0}</strong>
                      </div>
                      {(knowledgeQuery.data ?? []).map((item) => (
                        <article key={item.id}>
                          <BookOpen size={15} />
                          <div>
                            <strong>{item.title}</strong>
                            <span>
                              掌握度 {item.mastery ?? '未评估'}
                              {item.mastery !== null ? '%' : ''}
                              {item.nextReviewDate ? ` · ${item.nextReviewDate} 复习` : ''}
                            </span>
                          </div>
                        </article>
                      ))}
                      {(knowledgeQuery.data ?? []).length === 0 && <p>还没有知识点。</p>}
                    </section>
                    <section>
                      <div className="learning-heading">
                        <span>错题</span>
                        <strong>{mistakesQuery.data?.length ?? 0}</strong>
                      </div>
                      {(mistakesQuery.data ?? []).map((item) => (
                        <article key={item.id}>
                          <RotateCcw size={15} />
                          <div>
                            <strong>{item.question}</strong>
                            <span>
                              掌握度 {item.mastery ?? '未评估'}
                              {item.mastery !== null ? '%' : ''}
                              {item.nextReviewDate ? ` · ${item.nextReviewDate} 复习` : ''}
                            </span>
                          </div>
                        </article>
                      ))}
                      {(mistakesQuery.data ?? []).length === 0 && <p>还没有错题。</p>}
                    </section>
                  </div>
                </main>
              )}
            </div>
          )}
        </section>
      )}

      <HabitDialog
        open={habitDialogOpen}
        onOpenChange={setHabitDialogOpen}
        projectId={projectId}
        onCreated={() => queryClient.invalidateQueries({ queryKey: ['habits'] })}
      />
      <MetricDialog
        open={metricDialogOpen}
        onOpenChange={setMetricDialogOpen}
        projectId={projectId}
        onCreated={() => queryClient.invalidateQueries({ queryKey: ['metrics'] })}
      />
      <CourseDialog
        open={courseDialogOpen}
        onOpenChange={setCourseDialogOpen}
        projects={projects}
        onCreated={async (course) => {
          setSelectedCourseId(course.id)
          await queryClient.invalidateQueries({ queryKey: ['courses'] })
        }}
      />
      <MetricRecordDialog
        metric={metricToRecord}
        onOpenChange={(open) => {
          if (!open) setMetricToRecord(null)
        }}
        onRecorded={() => queryClient.invalidateQueries({ queryKey: ['metrics'] })}
      />
      <KnowledgeDialog
        open={knowledgeDialogOpen}
        onOpenChange={setKnowledgeDialogOpen}
        course={selectedCourse}
        onCreated={async () => {
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['knowledge'] }),
            queryClient.invalidateQueries({ queryKey: ['courses'] })
          ])
        }}
      />
      <MistakeDialog
        open={mistakeDialogOpen}
        onOpenChange={setMistakeDialogOpen}
        course={selectedCourse}
        onCreated={async () => {
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['mistakes'] }),
            queryClient.invalidateQueries({ queryKey: ['courses'] })
          ])
        }}
      />
    </div>
  )
}

function PracticeEmpty(props: {
  icon: React.ReactNode
  title: string
  copy: string
  action: string
  onAction: () => void
}): React.JSX.Element {
  return (
    <div className="practice-empty">
      <span>{props.icon}</span>
      <strong>{props.title}</strong>
      <p>{props.copy}</p>
      <button className="button button-secondary" type="button" onClick={props.onAction}>
        <Plus size={14} />
        {props.action}
      </button>
    </div>
  )
}

interface DialogFrameProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  kicker: string
  title: string
  description: string
  children: React.ReactNode
}

function DialogFrame(props: DialogFrameProps): React.JSX.Element {
  return (
    <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content">
          <div className="dialog-heading">
            <div>
              <span className="section-label">{props.kicker}</span>
              <Dialog.Title>{props.title}</Dialog.Title>
              <Dialog.Description>{props.description}</Dialog.Description>
            </div>
            <Dialog.Close className="dialog-close" aria-label="关闭"><X size={18} /></Dialog.Close>
          </div>
          {props.children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function HabitDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string | null
  onCreated: () => Promise<unknown>
}): React.JSX.Element {
  const [name, setName] = useState('')
  const [frequency, setFrequency] = useState<CreateHabitInput['frequency']>('daily')
  const [reminderTime, setReminderTime] = useState('')
  const [error, setError] = useState('')
  const submit = async (): Promise<void> => {
    const result = await window.youtrace.practice.createHabit({
      projectId: props.projectId,
      name,
      description: '',
      frequency,
      targetCount: 1,
      weekdays: [],
      reminderTime: reminderTime || null,
      startDate: localDate(),
      endDate: null
    })
    if (!result.ok) return setError(result.error.message)
    await props.onCreated()
    setName('')
    props.onOpenChange(false)
  }
  return (
    <DialogFrame open={props.open} onOpenChange={props.onOpenChange} kicker="让重复行动可见" title="新建习惯" description="习惯只记录发生与否，不自动替代任务结果。">
      <div className="dialog-form">
        <label><span>习惯名称</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：每日复盘" /></label>
        <div className="form-row">
          <label><span>频率</span><select value={frequency} onChange={(event) => setFrequency(event.target.value as CreateHabitInput['frequency'])}><option value="daily">每天</option><option value="weekdays">工作日</option><option value="weekly">每周</option><option value="custom">自定义</option></select></label>
          <label><span>提醒时间</span><input type="time" value={reminderTime} onChange={(event) => setReminderTime(event.target.value)} /></label>
        </div>
        {error && <div className="inline-error">{error}</div>}
      </div>
      <div className="dialog-actions"><Dialog.Close className="button button-secondary">取消</Dialog.Close><button className="button button-primary" disabled={!name.trim()} onClick={() => void submit()}>创建习惯</button></div>
    </DialogFrame>
  )
}

function MetricDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string | null
  onCreated: () => Promise<unknown>
}): React.JSX.Element {
  const [name, setName] = useState('')
  const [targetValue, setTargetValue] = useState('')
  const [unit, setUnit] = useState('')
  const [period, setPeriod] = useState<CreateMetricInput['period']>('total')
  const [error, setError] = useState('')
  const submit = async (): Promise<void> => {
    const result = await window.youtrace.practice.createMetric({
      projectId: props.projectId,
      name,
      targetValue: Number(targetValue),
      unit,
      direction: 'increase',
      period
    })
    if (!result.ok) return setError(result.error.message)
    await props.onCreated()
    setName('')
    setTargetValue('')
    setUnit('')
    props.onOpenChange(false)
  }
  return (
    <DialogFrame open={props.open} onOpenChange={props.onOpenChange} kicker="只记录会影响决策的数" title="新建指标" description="目标用于比较，记录值永远保留为原始事实。">
      <div className="dialog-form">
        <label><span>指标名称</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：累计跑量" /></label>
        <div className="form-row form-row-three">
          <label><span>目标值</span><input type="number" value={targetValue} onChange={(event) => setTargetValue(event.target.value)} /></label>
          <label><span>单位</span><input value={unit} onChange={(event) => setUnit(event.target.value)} placeholder="公里" /></label>
          <label><span>周期</span><select value={period} onChange={(event) => setPeriod(event.target.value as CreateMetricInput['period'])}><option value="total">累计</option><option value="daily">每天</option><option value="weekly">每周</option><option value="monthly">每月</option><option value="quarterly">每季度</option></select></label>
        </div>
        {error && <div className="inline-error">{error}</div>}
      </div>
      <div className="dialog-actions"><Dialog.Close className="button button-secondary">取消</Dialog.Close><button className="button button-primary" disabled={!name.trim() || !targetValue || !unit.trim()} onClick={() => void submit()}>创建指标</button></div>
    </DialogFrame>
  )
}

function MetricRecordDialog(props: {
  metric: Metric | null
  onOpenChange: (open: boolean) => void
  onRecorded: () => Promise<unknown>
}): React.JSX.Element {
  const [value, setValue] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const submit = async (): Promise<void> => {
    if (!props.metric) return
    const result = await window.youtrace.practice.recordMetric({
      metricId: props.metric.id,
      value: Number(value),
      recordedAt: new Date().toISOString(),
      note
    })
    if (!result.ok) return setError(result.error.message)
    await props.onRecorded()
    setValue('')
    setNote('')
    props.onOpenChange(false)
  }
  return (
    <DialogFrame
      open={props.metric !== null}
      onOpenChange={props.onOpenChange}
      kicker={props.metric?.name ?? '指标'}
      title="记录指标"
      description="这次输入会作为原始事实保留，不会自动修改项目进度。"
    >
      <div className="dialog-form">
        <label>
          <span>本次数值{props.metric ? `（${props.metric.unit}）` : ''}</span>
          <input autoFocus type="number" value={value} onChange={(event) => setValue(event.target.value)} />
        </label>
        <label>
          <span>备注</span>
          <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="可选：记录口径或当时情况" />
        </label>
        {error && <div className="inline-error">{error}</div>}
      </div>
      <div className="dialog-actions">
        <Dialog.Close className="button button-secondary">取消</Dialog.Close>
        <button className="button button-primary" disabled={!value} onClick={() => void submit()}>保存记录</button>
      </div>
    </DialogFrame>
  )
}

function CourseDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projects: Project[]
  onCreated: (course: Course) => Promise<void>
}): React.JSX.Element {
  const [projectId, setProjectId] = useState('')
  const [courseName, setCourseName] = useState('')
  const [textbookTitle, setTextbookTitle] = useState('')
  const [examDate, setExamDate] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    if (!projectId && props.projects[0]) setProjectId(props.projects[0].id)
  }, [projectId, props.projects])
  const submit = async (): Promise<void> => {
    const input: CreateCourseInput = {
      projectId,
      courseName,
      examDate: examDate || null,
      textbook: { title: textbookTitle, author: '', edition: '', isbn: '', publisher: '' }
    }
    const result = await window.youtrace.practice.createCourse(input)
    if (!result.ok) return setError(result.error.message)
    await props.onCreated(result.data)
    setCourseName('')
    setTextbookTitle('')
    props.onOpenChange(false)
  }
  return (
    <DialogFrame open={props.open} onOpenChange={props.onOpenChange} kicker="把学习资料接到项目" title="建立课程" description="每门课程关联一个项目，并保留独立的教材档案。">
      <div className="dialog-form">
        {props.projects.length === 0 ? <div className="inline-error">请先在“项目任务”中创建一个项目。</div> : <>
          <label><span>关联项目</span><select value={projectId} onChange={(event) => setProjectId(event.target.value)}>{props.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
          <label><span>课程名称</span><input autoFocus value={courseName} onChange={(event) => setCourseName(event.target.value)} placeholder="例如：计算机网络" /></label>
          <div className="form-row"><label><span>教材名称</span><input value={textbookTitle} onChange={(event) => setTextbookTitle(event.target.value)} placeholder="教材或主要资料" /></label><label><span>考试日期</span><input type="date" value={examDate} onChange={(event) => setExamDate(event.target.value)} /></label></div>
        </>}
        {error && <div className="inline-error">{error}</div>}
      </div>
      <div className="dialog-actions"><Dialog.Close className="button button-secondary">取消</Dialog.Close><button className="button button-primary" disabled={!projectId || !courseName.trim() || !textbookTitle.trim()} onClick={() => void submit()}>建立课程</button></div>
    </DialogFrame>
  )
}

function KnowledgeDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  course: Course | null
  onCreated: () => Promise<void>
}): React.JSX.Element {
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [mastery, setMastery] = useState('')
  const [reviewDate, setReviewDate] = useState('')
  const submit = async (): Promise<void> => {
    if (!props.course) return
    const input: CreateKnowledgeInput = { projectId: props.course.projectId, milestoneId: null, title, content, mastery: mastery ? Number(mastery) : null, nextReviewDate: reviewDate || null }
    const result = await window.youtrace.practice.createKnowledge(input)
    if (!result.ok) return
    await props.onCreated()
    setTitle('')
    setContent('')
    props.onOpenChange(false)
  }
  return (
    <DialogFrame open={props.open} onOpenChange={props.onOpenChange} kicker={props.course?.courseName ?? '课程'} title="添加知识点" description="内容可被全局搜索，掌握度不等同于完成进度。">
      <div className="dialog-form">
        <label><span>知识点标题</span><input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} /></label>
        <label><span>内容</span><textarea value={content} onChange={(event) => setContent(event.target.value)} /></label>
        <div className="form-row"><label><span>掌握度（0–100）</span><input type="number" min="0" max="100" value={mastery} onChange={(event) => setMastery(event.target.value)} /></label><label><span>下次复习</span><input type="date" value={reviewDate} onChange={(event) => setReviewDate(event.target.value)} /></label></div>
      </div>
      <div className="dialog-actions"><Dialog.Close className="button button-secondary">取消</Dialog.Close><button className="button button-primary" disabled={!title.trim() || !props.course} onClick={() => void submit()}>添加知识点</button></div>
    </DialogFrame>
  )
}

function MistakeDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  course: Course | null
  onCreated: () => Promise<void>
}): React.JSX.Element {
  const [question, setQuestion] = useState('')
  const [wrongAnswer, setWrongAnswer] = useState('')
  const [correctAnswer, setCorrectAnswer] = useState('')
  const [analysis, setAnalysis] = useState('')
  const [reviewDate, setReviewDate] = useState('')
  const submit = async (): Promise<void> => {
    if (!props.course) return
    const input: CreateMistakeInput = { projectId: props.course.projectId, knowledgeItemId: null, question, wrongAnswer, correctAnswer, analysis, mastery: null, nextReviewDate: reviewDate || null }
    const result = await window.youtrace.practice.createMistake(input)
    if (!result.ok) return
    await props.onCreated()
    setQuestion('')
    setWrongAnswer('')
    setCorrectAnswer('')
    setAnalysis('')
    props.onOpenChange(false)
  }
  return (
    <DialogFrame open={props.open} onOpenChange={props.onOpenChange} kicker={props.course?.courseName ?? '课程'} title="记录错题" description="保留错误答案、正确答案和分析，方便之后验证修正。">
      <div className="dialog-form">
        <label><span>题目</span><textarea autoFocus value={question} onChange={(event) => setQuestion(event.target.value)} /></label>
        <div className="form-row"><label><span>错误答案</span><textarea value={wrongAnswer} onChange={(event) => setWrongAnswer(event.target.value)} /></label><label><span>正确答案</span><textarea value={correctAnswer} onChange={(event) => setCorrectAnswer(event.target.value)} /></label></div>
        <label><span>错误分析</span><textarea value={analysis} onChange={(event) => setAnalysis(event.target.value)} /></label>
        <label><span>下次复习</span><input type="date" value={reviewDate} onChange={(event) => setReviewDate(event.target.value)} /></label>
      </div>
      <div className="dialog-actions"><Dialog.Close className="button button-secondary">取消</Dialog.Close><button className="button button-primary" disabled={!question.trim() || !props.course} onClick={() => void submit()}>记录错题</button></div>
    </DialogFrame>
  )
}
