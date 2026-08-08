import * as Dialog from '@radix-ui/react-dialog'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  BarChart3,
  BookOpen,
  Check,
  ClipboardCheck,
  Circle,
  Flame,
  Gauge,
  FileText,
  Paperclip,
  Pencil,
  Plus,
  RotateCcw,
  Target,
  Trash2,
  Upload,
  X
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  Course,
  CourseMaterial,
  CreateCourseMaterialInput,
  CreateCourseInput,
  CreateHabitInput,
  CreateKnowledgeInput,
  CreateLearningTestInput,
  CreateMetricInput,
  CreateMistakeInput,
  Habit,
  IpcResult,
  KnowledgeItem,
  LearningTest,
  Milestone,
  Metric,
  MetricEntry,
  Mistake,
  Project,
  EvidenceAttachment
} from '../../../shared/contracts'
import { QueryFailure } from '../components/QueryFeedback'

type PracticeView = 'habits' | 'metrics' | 'learning'

function unwrap<T>(result: IpcResult<T>): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.data
}

function localDate(date = new Date()): string {
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 10)
}

function localDateTime(date = new Date()): string {
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

export function PracticePage(): React.JSX.Element {
  const queryClient = useQueryClient()
  const [view, setView] = useState<PracticeView>('habits')
  const [scopeId, setScopeId] = useState<string>('personal')
  const [habitDialogOpen, setHabitDialogOpen] = useState(false)
  const [editingHabit, setEditingHabit] = useState<Habit | null>(null)
  const [metricDialogOpen, setMetricDialogOpen] = useState(false)
  const [editingMetric, setEditingMetric] = useState<Metric | null>(null)
  const [courseDialogOpen, setCourseDialogOpen] = useState(false)
  const [editingCourse, setEditingCourse] = useState<Course | null>(null)
  const [materialDialogOpen, setMaterialDialogOpen] = useState(false)
  const [editingMaterial, setEditingMaterial] = useState<CourseMaterial | null>(null)
  const [metricToRecord, setMetricToRecord] = useState<Metric | null>(null)
  const [knowledgeDialogOpen, setKnowledgeDialogOpen] = useState(false)
  const [editingKnowledge, setEditingKnowledge] = useState<KnowledgeItem | null>(null)
  const [mistakeDialogOpen, setMistakeDialogOpen] = useState(false)
  const [editingMistake, setEditingMistake] = useState<Mistake | null>(null)
  const [testDialogOpen, setTestDialogOpen] = useState(false)
  const [editingTest, setEditingTest] = useState<LearningTest | null>(null)
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null)
  const [actionError, setActionError] = useState('')
  const [actionBusy, setActionBusy] = useState('')
  const today = useMemo(() => localDate(), [])
  const projectId = scopeId === 'personal' ? null : scopeId

  const openCreate = (kind: 'habit' | 'metric' | 'course' | 'knowledge' | 'mistake' | 'test'): void => {
    if (kind === 'habit') { setEditingHabit(null); setHabitDialogOpen(true) }
    else if (kind === 'metric') { setEditingMetric(null); setMetricDialogOpen(true) }
    else if (kind === 'course') { setEditingCourse(null); setCourseDialogOpen(true) }
    else if (kind === 'knowledge') { setEditingKnowledge(null); setKnowledgeDialogOpen(true) }
    else if (kind === 'mistake') { setEditingMistake(null); setMistakeDialogOpen(true) }
    else { setEditingTest(null); setTestDialogOpen(true) }
  }

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

  const courseMaterialsQuery = useQuery({
    queryKey: ['course-materials', selectedCourse?.id],
    enabled: selectedCourse !== null,
    queryFn: async () =>
      unwrap(await window.youtrace.practice.listCourseMaterials(selectedCourse!.id))
  })

  const knowledgeQuery = useQuery({
    queryKey: ['knowledge', selectedCourse?.projectId],
    enabled: selectedCourse !== null,
    queryFn: async () =>
      unwrap(await window.youtrace.practice.listKnowledge(selectedCourse!.projectId))
  })
  const courseMilestonesQuery = useQuery({
    queryKey: ['milestones', selectedCourse?.projectId],
    enabled: selectedCourse !== null,
    queryFn: async () => unwrap(await window.youtrace.planning.listMilestones(selectedCourse!.projectId))
  })
  const mistakesQuery = useQuery({
    queryKey: ['mistakes', selectedCourse?.projectId],
    enabled: selectedCourse !== null,
    queryFn: async () =>
      unwrap(await window.youtrace.practice.listMistakes(selectedCourse!.projectId))
  })
  const testsQuery = useQuery({
    queryKey: ['learning-tests', selectedCourse?.projectId],
    enabled: selectedCourse !== null,
    queryFn: async () =>
      unwrap(await window.youtrace.practice.listLearningTests(selectedCourse!.projectId))
  })
  const reviewQueueQuery = useQuery({
    queryKey: ['review-queue', selectedCourse?.projectId],
    enabled: selectedCourse !== null,
    queryFn: async () =>
      unwrap(await window.youtrace.practice.listReviewQueue(selectedCourse!.projectId))
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
    },
    onError: (error) => setActionError(error.message)
  })

  const runPracticeAction = async (
    label: string,
    operation: () => Promise<IpcResult<unknown>>,
    queryKeys: string[]
  ): Promise<void> => {
    setActionBusy(label)
    setActionError('')
    try {
      const result = await operation()
      if (!result.ok) return setActionError(result.error.message)
      await Promise.all(
        queryKeys.map((queryKey) => queryClient.invalidateQueries({ queryKey: [queryKey] }))
      )
    } catch (error) {
      setActionError(error instanceof Error ? error.message : `${label}失败，请重试。`)
    } finally {
      setActionBusy('')
    }
  }

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

      {projectsQuery.isError && (
        <QueryFailure
          compact
          title="项目范围读取失败"
          detail="习惯、指标和课程数据没有被删除，请重新读取项目范围。"
          onRetry={() => void projectsQuery.refetch()}
        />
      )}
      {actionError && <div className="inline-error" role="alert">{actionError}</div>}

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
              <button className="button button-primary" type="button" onClick={() => openCreate('habit')}>
                <Plus size={15} />
                新建习惯
              </button>
            </div>
          </header>
          {habitsQuery.isPending ? (
            <p className="rail-message" role="status">正在读取习惯…</p>
          ) : habitsQuery.isError ? (
            <QueryFailure title="习惯读取失败" onRetry={() => void habitsQuery.refetch()} />
          ) : (habitsQuery.data ?? []).length === 0 ? (
            <PracticeEmpty
              icon={<Flame size={25} />}
              title="还没有这个范围的习惯"
              copy="从一个小而明确、可以每天留下事实的动作开始。"
              action="创建第一个习惯"
              onAction={() => openCreate('habit')}
            />
          ) : (
            <div className="habit-grid">
              {(habitsQuery.data ?? []).map((habit) => (
                <article key={habit.id} className={`habit-card ${habit.todayStatus ?? ''}`}>
                  <button
                    type="button"
                    className="habit-check"
                    aria-label={habit.todayStatus === 'completed' ? `清除今日记录 ${habit.name}` : `完成 ${habit.name}`}
                    onClick={async () => {
                      if (habit.todayStatus === 'completed') {
                        await runPracticeAction('清除习惯记录', () => window.youtrace.practice.clearHabitRecord(habit.id, today), ['habits'])
                      } else recordHabit.mutate({ habit, status: 'completed' })
                    }}
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
                    onClick={async () => {
                      if (habit.todayStatus === 'skipped') {
                        await runPracticeAction('清除习惯记录', () => window.youtrace.practice.clearHabitRecord(habit.id, today), ['habits'])
                      } else recordHabit.mutate({ habit, status: 'skipped' })
                    }}
                  >
                    {habit.todayStatus === 'skipped' ? '清除跳过' : '跳过'}
                  </button>
                  <div className="practice-card-actions"><button type="button" aria-label={`编辑习惯：${habit.name}`} onClick={() => { setEditingHabit(habit); setHabitDialogOpen(true) }}><Pencil size={13} /></button><button type="button" disabled={Boolean(actionBusy)} aria-label={`删除习惯：${habit.name}`} onClick={() => void runPracticeAction('删除习惯', () => window.youtrace.practice.trashHabit(habit.id), ['habits', 'trash'])}><Trash2 size={13} /></button></div>
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
              <button className="button button-primary" type="button" onClick={() => openCreate('metric')}>
                <Plus size={15} />
                新建指标
              </button>
            </div>
          </header>
          {metricsQuery.isPending ? (
            <p className="rail-message" role="status">正在读取指标…</p>
          ) : metricsQuery.isError ? (
            <QueryFailure title="指标读取失败" onRetry={() => void metricsQuery.refetch()} />
          ) : (metricsQuery.data ?? []).length === 0 ? (
            <PracticeEmpty
              icon={<Gauge size={25} />}
              title="还没有这个范围的指标"
              copy="选择真正影响决策的数字，不必记录一切。"
              action="创建第一个指标"
              onAction={() => openCreate('metric')}
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
                      <div className="practice-card-actions"><button type="button" aria-label={`编辑指标：${metric.name}`} onClick={() => { setEditingMetric(metric); setMetricDialogOpen(true) }}><Pencil size={13} /></button><button type="button" disabled={Boolean(actionBusy)} aria-label={`删除指标：${metric.name}`} onClick={() => void runPracticeAction('删除指标', () => window.youtrace.practice.trashMetric(metric.id), ['metrics', 'trash'])}><Trash2 size={13} /></button></div>
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
            <button className="button button-primary" type="button" onClick={() => openCreate('course')}>
              <Plus size={15} />
              建立课程
            </button>
          </header>
          {coursesQuery.isPending ? (
            <p className="rail-message" role="status">正在读取课程…</p>
          ) : coursesQuery.isError ? (
            <QueryFailure title="课程读取失败" onRetry={() => void coursesQuery.refetch()} />
          ) : courses.length === 0 ? (
            <PracticeEmpty
              icon={<BookOpen size={25} />}
              title="还没有课程档案"
              copy="先建立一个项目，再把教材、知识点和错题接到同一条学习轨迹。"
              action="建立第一门课程"
              onAction={() => openCreate('course')}
            />
          ) : (
            <div className="learning-layout">
              <aside className="course-rail">
                <div className="course-rail-heading">
                  <span>按课程筛选资料</span>
                  <strong>{courses.length}</strong>
                </div>
                {courses.map((course) => (
                  <button
                    type="button"
                    key={course.id}
                    className={course.id === selectedCourseId ? 'active' : ''}
                    onClick={() => setSelectedCourseId(course.id)}
                  >
                    <strong>{course.courseName}</strong>
                    <span>
                      {course.materialCount} 资料 · {course.knowledgeCount} 知识 · {course.mistakeCount} 错题
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
                       <button className="button button-secondary" type="button" onClick={() => openCreate('knowledge')}>
                        <Plus size={14} />
                        知识点
                      </button>
                       <button className="button button-secondary" type="button" onClick={() => openCreate('mistake')}>
                        <Plus size={14} />
                        错题
                      </button>
                       <button className="button button-secondary" type="button" onClick={() => openCreate('test')}>
                         <ClipboardCheck size={14} />
                         测试
                       </button>
                       <button className="button button-secondary" type="button" onClick={() => { setEditingCourse(selectedCourse); setCourseDialogOpen(true) }}><Pencil size={14} />编辑课程</button>
                       <button className="button button-danger" type="button" disabled={Boolean(actionBusy)} onClick={() => void runPracticeAction('删除课程', () => window.youtrace.practice.trashCourse(selectedCourse.id), ['courses', 'trash'])}><Trash2 size={14} />删除课程</button>
                    </div>
                  </header>
                  {(courseMaterialsQuery.isError || knowledgeQuery.isError || courseMilestonesQuery.isError || mistakesQuery.isError || testsQuery.isError || reviewQueueQuery.isError) && (
                    <QueryFailure
                      title="课程明细读取不完整"
                      detail="部分资料、知识点、错题、测试或复习队列暂时无法读取，请重试。"
                      onRetry={() => void Promise.all([
                        courseMaterialsQuery.refetch(),
                        knowledgeQuery.refetch(),
                        courseMilestonesQuery.refetch(),
                        mistakesQuery.refetch(),
                        testsQuery.refetch(),
                        reviewQueueQuery.refetch()
                      ])}
                    />
                  )}
                  <CourseMaterialsSection
                    course={selectedCourse}
                    materials={courseMaterialsQuery.data ?? []}
                    onCreate={() => {
                      setEditingMaterial(null)
                      setMaterialDialogOpen(true)
                    }}
                    onEdit={(material) => {
                      setEditingMaterial(material)
                      setMaterialDialogOpen(true)
                    }}
                  />
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
                           <div className="practice-card-actions"><button type="button" aria-label={`编辑知识点：${item.title}`} onClick={() => { setEditingKnowledge(item); setKnowledgeDialogOpen(true) }}><Pencil size={13} /></button><button type="button" disabled={Boolean(actionBusy)} aria-label={`删除知识点：${item.title}`} onClick={() => void runPracticeAction('删除知识点', () => window.youtrace.practice.trashKnowledge(item.id), ['knowledge', 'courses', 'review-queue', 'trash'])}><Trash2 size={13} /></button></div>
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
                           <div className="practice-card-actions"><button type="button" aria-label={`编辑错题：${item.question}`} onClick={() => { setEditingMistake(item); setMistakeDialogOpen(true) }}><Pencil size={13} /></button><button type="button" disabled={Boolean(actionBusy)} aria-label={`删除错题：${item.question}`} onClick={() => void runPracticeAction('删除错题', () => window.youtrace.practice.trashMistake(item.id), ['mistakes', 'courses', 'review-queue', 'trash'])}><Trash2 size={13} /></button></div>
                        </article>
                      ))}
                      {(mistakesQuery.data ?? []).length === 0 && <p>还没有错题。</p>}
                    </section>
                  </div>
                  <div className="learning-followup">
                    <section>
                      <div className="learning-heading"><span>测试记录</span><strong>{testsQuery.data?.length ?? 0}</strong></div>
                      {(testsQuery.data ?? []).slice(0, 5).map((test) => <article key={test.id}><ClipboardCheck size={14} /><div><strong>{test.title}</strong><span>{test.score === null ? '未记录成绩' : `${test.score} / ${test.maxScore ?? '—'}`} · {new Date(test.testedAt).toLocaleDateString('zh-CN')}</span></div><div className="practice-card-actions"><button type="button" aria-label={`编辑测试：${test.title}`} onClick={() => { setEditingTest(test); setTestDialogOpen(true) }}><Pencil size={13} /></button><button type="button" disabled={Boolean(actionBusy)} aria-label={`删除测试：${test.title}`} onClick={() => void runPracticeAction('删除测试', () => window.youtrace.practice.trashLearningTest(test.id), ['learning-tests', 'courses', 'trash'])}><Trash2 size={13} /></button></div></article>)}
                      {(testsQuery.data ?? []).length === 0 && <p>还没有测试记录。</p>}
                    </section>
                    <section>
                      <div className="learning-heading"><span>复习队列</span><strong>{(reviewQueueQuery.data ?? []).filter((item) => item.status === 'pending').length}</strong></div>
                      {(reviewQueueQuery.data ?? []).filter((item) => item.status === 'pending').slice(0, 6).map((item) => <article className="review-queue-row" key={item.id}><RotateCcw size={14} /><div><strong>{item.title}</strong><span>{item.scheduledDate} · {item.entityType === 'knowledge' ? '知识点' : '错题'}</span></div><div>{(['again', 'hard', 'good', 'easy'] as const).map((result) => <button key={result} type="button" disabled={Boolean(actionBusy)} onClick={() => void runPracticeAction('记录复习结果', () => window.youtrace.practice.recordReviewResult({ queueId: item.id, result, reviewedAt: new Date().toISOString() }), ['review-queue', 'knowledge', 'mistakes', 'courses'])}>{reviewResultLabel(result)}</button>)}</div></article>)}
                      {(reviewQueueQuery.data ?? []).filter((item) => item.status === 'pending').length === 0 && <p>当前没有待复习内容。</p>}
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
        onOpenChange={(open) => { setHabitDialogOpen(open); if (!open) setEditingHabit(null) }}
        projectId={projectId}
        habit={editingHabit}
        onSaved={() => queryClient.invalidateQueries({ queryKey: ['habits'] })}
      />
      <MetricDialog
        open={metricDialogOpen}
        onOpenChange={(open) => { setMetricDialogOpen(open); if (!open) setEditingMetric(null) }}
        projectId={projectId}
        metric={editingMetric}
        onSaved={() => queryClient.invalidateQueries({ queryKey: ['metrics'] })}
      />
      <CourseDialog
        open={courseDialogOpen}
        onOpenChange={(open) => { setCourseDialogOpen(open); if (!open) setEditingCourse(null) }}
        projects={projects}
        course={editingCourse}
        onSaved={async (course) => {
          setSelectedCourseId(course.id)
          await queryClient.invalidateQueries({ queryKey: ['courses'] })
        }}
      />
      <CourseMaterialDialog
        open={materialDialogOpen}
        onOpenChange={(open) => {
          setMaterialDialogOpen(open)
          if (!open) setEditingMaterial(null)
        }}
        course={selectedCourse}
        material={editingMaterial}
        onSaved={async () => {
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['course-materials'] }),
            queryClient.invalidateQueries({ queryKey: ['courses'] })
          ])
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
        onOpenChange={(open) => { setKnowledgeDialogOpen(open); if (!open) setEditingKnowledge(null) }}
        course={selectedCourse}
        knowledge={editingKnowledge}
        milestones={courseMilestonesQuery.data ?? []}
        onSaved={async () => {
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['knowledge'] }),
            queryClient.invalidateQueries({ queryKey: ['courses'] })
          ])
        }}
      />
      <MistakeDialog
        open={mistakeDialogOpen}
        onOpenChange={(open) => { setMistakeDialogOpen(open); if (!open) setEditingMistake(null) }}
        course={selectedCourse}
        mistake={editingMistake}
        knowledgeItems={knowledgeQuery.data ?? []}
        onSaved={async () => {
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['mistakes'] }),
            queryClient.invalidateQueries({ queryKey: ['courses'] })
          ])
        }}
      />
      <LearningTestDialog
        open={testDialogOpen}
        onOpenChange={(open) => { setTestDialogOpen(open); if (!open) setEditingTest(null) }}
        course={selectedCourse}
        learningTest={editingTest}
        milestones={courseMilestonesQuery.data ?? []}
        onSaved={async () => {
          await queryClient.invalidateQueries({ queryKey: ['learning-tests'] })
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

const courseMaterialLabels: Record<CourseMaterial['materialType'], string> = {
  textbook: '教材',
  reference: '参考书',
  slides: '课件',
  paper: '原文 / 论文',
  notes: '笔记',
  exercises: '习题资料',
  other: '其他资料'
}

function CourseMaterialsSection(props: {
  course: Course
  materials: CourseMaterial[]
  onCreate: () => void
  onEdit: (material: CourseMaterial) => void
}): React.JSX.Element {
  return (
    <section className="course-materials-section">
      <header>
        <div>
          <span className="section-label">当前课程的全部条目</span>
          <h4>学习资料</h4>
          <p>教材、原文、课件和笔记分别建条目；附件会复制到工作区，双击文件即可打开。</p>
        </div>
        <button className="button button-secondary" type="button" onClick={props.onCreate}>
          <Plus size={14} />
          添加资料条目
        </button>
      </header>
      <div className="course-material-grid">
        {props.materials.map((material) => (
          <article className="course-material-card" key={material.id}>
            <header>
              <div>
                <span>{courseMaterialLabels[material.materialType]}</span>
                <strong>{material.title}</strong>
              </div>
              <button
                type="button"
                aria-label={`编辑课程资料：${material.title}`}
                onClick={() => props.onEdit(material)}
              >
                <Pencil size={14} />
              </button>
            </header>
            {(material.author || material.edition || material.publisher || material.isbn) && (
              <p className="course-material-meta">
                {[material.author, material.edition, material.publisher, material.isbn]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            )}
            {material.description && <p className="course-material-description">{material.description}</p>}
            <CourseMaterialAttachments material={material} />
          </article>
        ))}
        {props.materials.length === 0 && (
          <p className="course-material-empty">这门课程还没有资料条目。</p>
        )}
      </div>
    </section>
  )
}

function CourseMaterialAttachments(props: { material: CourseMaterial }): React.JSX.Element {
  const queryClient = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragActive, setDragActive] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const attachmentsQuery = useQuery({
    queryKey: ['course-material-attachments', props.material.id],
    queryFn: async () =>
      unwrap(await window.youtrace.data.listCourseMaterialAttachments(props.material.id))
  })

  const upload = async (files: File[]): Promise<void> => {
    if (files.length === 0 || uploading) return
    setUploading(true)
    setError('')
    try {
      for (const file of files) {
        unwrap(await window.youtrace.data.attachDroppedCourseMaterialFile(file, props.material.id))
      }
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ['course-material-attachments', props.material.id]
        }),
        queryClient.invalidateQueries({ queryKey: ['course-materials'] })
      ])
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : '附件导入失败。')
    } finally {
      setUploading(false)
    }
  }

  const attachments = attachmentsQuery.data ?? []
  return (
    <div className="course-material-attachments">
      <div
        className={`course-material-dropzone${dragActive ? ' active' : ''}`}
        onClick={() => inputRef.current?.click()}
        onDragEnter={(event) => {
          event.preventDefault()
          setDragActive(true)
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragActive(false)
        }}
        onDrop={(event) => {
          event.preventDefault()
          setDragActive(false)
          void upload(Array.from(event.dataTransfer.files))
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') inputRef.current?.click()
        }}
      >
        <Upload size={14} />
        <span>{uploading ? '正在复制…' : '点击或拖拽添加多个附件'}</span>
        <input
          ref={inputRef}
          hidden
          multiple
          type="file"
          onChange={(event) => {
            void upload(Array.from(event.target.files ?? []))
            event.target.value = ''
          }}
        />
      </div>
      {attachments.length > 0 && (
        <div className="course-material-file-list">
          {attachments.map((attachment) => (
            <CourseMaterialAttachmentButton key={attachment.id} attachment={attachment} />
          ))}
        </div>
      )}
      {attachments.length === 0 && !attachmentsQuery.isLoading && (
        <span className="course-material-no-files">暂无附件</span>
      )}
      {error && <div className="inline-error">{error}</div>}
    </div>
  )
}

function CourseMaterialAttachmentButton(props: {
  attachment: EvidenceAttachment
}): React.JSX.Element {
  const [error, setError] = useState('')
  const open = async (): Promise<void> => {
    const result = await window.youtrace.data.openCourseMaterialAttachment(props.attachment.id)
    if (!result.ok) setError(result.error.message)
  }
  return (
    <>
      <button
        type="button"
        title="双击使用系统默认程序打开"
        onDoubleClick={() => void open()}
      >
        <FileText size={14} />
        <span>{props.attachment.originalName}</span>
        <small>{formatFileSize(props.attachment.sizeBytes)}</small>
      </button>
      {error && <span className="course-material-file-error">{error}</span>}
    </>
  )
}

function formatFileSize(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`
  if (bytes < 1_024 * 1_024) return `${(bytes / 1_024).toFixed(1)} KB`
  return `${(bytes / (1_024 * 1_024)).toFixed(1)} MB`
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
  habit: Habit | null
  onSaved: () => Promise<unknown>
}): React.JSX.Element {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [frequency, setFrequency] = useState<CreateHabitInput['frequency']>('daily')
  const [targetCount, setTargetCount] = useState('1')
  const [weekdays, setWeekdays] = useState<number[]>([])
  const [reminderTime, setReminderTime] = useState('')
  const [startDate, setStartDate] = useState(localDate())
  const [endDate, setEndDate] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    if (!props.open) return
    setName(props.habit?.name ?? '')
    setDescription(props.habit?.description ?? '')
    setFrequency(props.habit?.frequency ?? 'daily')
    setTargetCount(props.habit?.targetCount.toString() ?? '1')
    setWeekdays(props.habit?.weekdays ?? [])
    setReminderTime(props.habit?.reminderTime ?? '')
    setStartDate(props.habit?.startDate ?? localDate())
    setEndDate(props.habit?.endDate ?? '')
    setError('')
  }, [props.open, props.habit])
  const submit = async (): Promise<void> => {
    const input: CreateHabitInput = {
      projectId: props.projectId,
      name,
      description,
      frequency,
      targetCount: Number(targetCount),
      weekdays,
      reminderTime: reminderTime || null,
      startDate,
      endDate: endDate || null
    }
    const result = props.habit
      ? await window.youtrace.practice.updateHabit({ id: props.habit.id, ...input })
      : await window.youtrace.practice.createHabit(input)
    if (!result.ok) return setError(result.error.message)
    await props.onSaved()
    props.onOpenChange(false)
  }
  return (
    <DialogFrame open={props.open} onOpenChange={props.onOpenChange} kicker="让重复行动可见" title={props.habit ? '编辑习惯' : '新建习惯'} description="习惯只记录发生与否，不自动替代任务结果。">
      <div className="dialog-form">
        <label><span>习惯名称</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：每日复盘" /></label>
        <label><span>说明</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} /></label>
        <div className="form-row form-row-three">
          <label><span>频率</span><select value={frequency} onChange={(event) => setFrequency(event.target.value as CreateHabitInput['frequency'])}><option value="daily">每天</option><option value="weekdays">工作日</option><option value="weekly">每周</option><option value="custom">自定义</option></select></label>
          <label><span>每周期目标次数</span><input type="number" min="1" max="99" value={targetCount} onChange={(event) => setTargetCount(event.target.value)} /></label>
          <label><span>提醒时间</span><input type="time" value={reminderTime} onChange={(event) => setReminderTime(event.target.value)} /></label>
        </div>
        {(frequency === 'weekly' || frequency === 'custom') ? <fieldset className="weekday-picker"><legend>执行星期</legend><div>{['日', '一', '二', '三', '四', '五', '六'].map((label, day) => <button type="button" key={day} className={weekdays.includes(day) ? 'active' : ''} onClick={() => setWeekdays((current) => current.includes(day) ? current.filter((value) => value !== day) : [...current, day])}>周{label}</button>)}</div></fieldset> : null}
        <div className="form-row"><label><span>开始日期</span><input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label><label><span>结束日期</span><input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label></div>
        {error && <div className="inline-error">{error}</div>}
      </div>
      <div className="dialog-actions"><Dialog.Close className="button button-secondary">取消</Dialog.Close><button className="button button-primary" disabled={!name.trim() || !startDate || !targetCount} onClick={() => void submit()}>{props.habit ? '保存修改' : '创建习惯'}</button></div>
    </DialogFrame>
  )
}

function MetricDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string | null
  metric: Metric | null
  onSaved: () => Promise<unknown>
}): React.JSX.Element {
  const [name, setName] = useState('')
  const [targetValue, setTargetValue] = useState('')
  const [unit, setUnit] = useState('')
  const [direction, setDirection] = useState<CreateMetricInput['direction']>('increase')
  const [period, setPeriod] = useState<CreateMetricInput['period']>('total')
  const [error, setError] = useState('')
  useEffect(() => {
    if (!props.open) return
    setName(props.metric?.name ?? '')
    setTargetValue(props.metric?.targetValue.toString() ?? '')
    setUnit(props.metric?.unit ?? '')
    setDirection(props.metric?.direction ?? 'increase')
    setPeriod(props.metric?.period ?? 'total')
    setError('')
  }, [props.open, props.metric])
  const submit = async (): Promise<void> => {
    const input: CreateMetricInput = {
      projectId: props.projectId,
      name,
      targetValue: Number(targetValue),
      unit,
      direction,
      period
    }
    const result = props.metric
      ? await window.youtrace.practice.updateMetric({ id: props.metric.id, ...input })
      : await window.youtrace.practice.createMetric(input)
    if (!result.ok) return setError(result.error.message)
    await props.onSaved()
    props.onOpenChange(false)
  }
  return (
    <DialogFrame open={props.open} onOpenChange={props.onOpenChange} kicker="只记录会影响决策的数" title={props.metric ? '编辑指标' : '新建指标'} description="目标用于比较，记录值永远保留为原始事实。">
      <div className="dialog-form">
        <label><span>指标名称</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：累计跑量" /></label>
        <div className="form-row form-row-three">
          <label><span>目标值</span><input type="number" value={targetValue} onChange={(event) => setTargetValue(event.target.value)} /></label>
          <label><span>单位</span><input value={unit} onChange={(event) => setUnit(event.target.value)} placeholder="公里" /></label>
          <label><span>方向</span><select value={direction} onChange={(event) => setDirection(event.target.value as CreateMetricInput['direction'])}><option value="increase">越高越好</option><option value="decrease">越低越好</option><option value="maintain">保持范围</option></select></label>
        </div>
        <label><span>周期</span><select value={period} onChange={(event) => setPeriod(event.target.value as CreateMetricInput['period'])}><option value="total">累计</option><option value="daily">每天</option><option value="weekly">每周</option><option value="monthly">每月</option><option value="quarterly">每季度</option></select></label>
        {error && <div className="inline-error">{error}</div>}
      </div>
      <div className="dialog-actions"><Dialog.Close className="button button-secondary">取消</Dialog.Close><button className="button button-primary" disabled={!name.trim() || !targetValue || !unit.trim()} onClick={() => void submit()}>{props.metric ? '保存修改' : '创建指标'}</button></div>
    </DialogFrame>
  )
}

function MetricRecordDialog(props: {
  metric: Metric | null
  onOpenChange: (open: boolean) => void
  onRecorded: () => Promise<unknown>
}): React.JSX.Element {
  const queryClient = useQueryClient()
  const [value, setValue] = useState('')
  const [note, setNote] = useState('')
  const [recordedAt, setRecordedAt] = useState(localDateTime())
  const [editingEntry, setEditingEntry] = useState<MetricEntry | null>(null)
  const [pendingDelete, setPendingDelete] = useState<MetricEntry | null>(null)
  const [error, setError] = useState('')

  const entriesQuery = useQuery({
    queryKey: ['metric-entries', props.metric?.id],
    enabled: props.metric !== null,
    queryFn: async () => unwrap(await window.youtrace.practice.listMetricEntries(props.metric!.id))
  })

  useEffect(() => {
    if (!props.metric) return
    setValue('')
    setNote('')
    setRecordedAt(localDateTime())
    setEditingEntry(null)
    setPendingDelete(null)
    setError('')
  }, [props.metric])

  const resetForm = (): void => {
    setValue('')
    setNote('')
    setRecordedAt(localDateTime())
    setEditingEntry(null)
    setError('')
  }

  const submit = async (): Promise<void> => {
    if (!props.metric) return
    const result = editingEntry
      ? await window.youtrace.practice.updateMetricEntry({
          id: editingEntry.id,
          value: Number(value),
          recordedAt: new Date(recordedAt).toISOString(),
          note
        })
      : await window.youtrace.practice.recordMetric({
          metricId: props.metric.id,
          value: Number(value),
          recordedAt: new Date(recordedAt).toISOString(),
          note
        })
    if (!result.ok) return setError(result.error.message)
    await Promise.all([
      props.onRecorded(),
      queryClient.invalidateQueries({ queryKey: ['metric-entries', props.metric.id] })
    ])
    resetForm()
  }

  const startEditing = (entry: MetricEntry): void => {
    setEditingEntry(entry)
    setValue(entry.value.toString())
    setNote(entry.note)
    setRecordedAt(localDateTime(new Date(entry.recordedAt)))
    setError('')
  }

  const deleteEntry = async (): Promise<void> => {
    if (!pendingDelete || !props.metric) return
    const result = await window.youtrace.practice.deleteMetricEntry(pendingDelete.id)
    if (!result.ok) return setError(result.error.message)
    if (editingEntry?.id === pendingDelete.id) resetForm()
    setPendingDelete(null)
    await Promise.all([
      props.onRecorded(),
      queryClient.invalidateQueries({ queryKey: ['metric-entries', props.metric.id] })
    ])
  }

  return (
    <>
      <DialogFrame
        open={props.metric !== null}
        onOpenChange={props.onOpenChange}
        kicker={props.metric?.name ?? '指标'}
        title={editingEntry ? '编辑指标记录' : '记录指标'}
        description="记录可以在这里更正或删除，修改会同步重算指标汇总。"
      >
        <div className="dialog-form">
          <div className="form-row">
            <label>
              <span>本次数值{props.metric ? `（${props.metric.unit}）` : ''}</span>
              <input autoFocus type="number" value={value} onChange={(event) => setValue(event.target.value)} />
            </label>
            <label>
              <span>记录时间</span>
              <input type="datetime-local" value={recordedAt} onChange={(event) => setRecordedAt(event.target.value)} />
            </label>
          </div>
          <label>
            <span>备注</span>
            <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="可选：记录口径或当时情况" />
          </label>
          {error && <div className="inline-error">{error}</div>}
          <section className="metric-entry-history">
            <header>
              <strong>历史记录</strong>
              <span>{entriesQuery.data?.length ?? 0} 条</span>
            </header>
            {entriesQuery.isLoading && <p>正在读取记录…</p>}
            {entriesQuery.error && <p className="inline-error">{entriesQuery.error.message}</p>}
            {(entriesQuery.data ?? []).map((entry) => (
              <article className={editingEntry?.id === entry.id ? 'editing' : ''} key={entry.id}>
                <div>
                  <strong>{entry.value} {props.metric?.unit}</strong>
                  <span>{new Date(entry.recordedAt).toLocaleString('zh-CN')}{entry.note ? ` · ${entry.note}` : ''}</span>
                </div>
                <div className="practice-card-actions">
                  <button type="button" aria-label={`编辑指标记录：${entry.value}`} onClick={() => startEditing(entry)}><Pencil size={13} /></button>
                  <button type="button" aria-label={`删除指标记录：${entry.value}`} onClick={() => setPendingDelete(entry)}><Trash2 size={13} /></button>
                </div>
              </article>
            ))}
            {!entriesQuery.isLoading && (entriesQuery.data ?? []).length === 0 && <p>还没有指标记录。</p>}
          </section>
        </div>
        <div className="dialog-actions">
          {editingEntry && <button className="button button-secondary" type="button" onClick={resetForm}>取消编辑</button>}
          <Dialog.Close className="button button-secondary">关闭</Dialog.Close>
          <button className="button button-primary" disabled={!value || !recordedAt} onClick={() => void submit()}>{editingEntry ? '保存修改' : '保存记录'}</button>
        </div>
      </DialogFrame>
      <Dialog.Root open={pendingDelete !== null} onOpenChange={(open) => { if (!open) setPendingDelete(null) }}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog-content destructive-dialog">
            <div className="dialog-heading">
              <div>
                <span className="section-label">不可恢复操作</span>
                <Dialog.Title>删除这条指标记录？</Dialog.Title>
                <Dialog.Description>删除后，指标汇总会重新计算；这条记录不能恢复。</Dialog.Description>
              </div>
              <Dialog.Close className="dialog-close" aria-label="关闭"><X size={18} /></Dialog.Close>
            </div>
            <div className="dialog-actions">
              <Dialog.Close className="button button-secondary">取消</Dialog.Close>
              <button className="button button-danger" type="button" onClick={() => void deleteEntry()}><Trash2 size={14} />确认删除</button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  )
}

function CourseDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projects: Project[]
  course: Course | null
  onSaved: (course: Course) => Promise<void>
}): React.JSX.Element {
  const [projectId, setProjectId] = useState('')
  const [courseName, setCourseName] = useState('')
  const [textbookTitle, setTextbookTitle] = useState('')
  const [author, setAuthor] = useState('')
  const [edition, setEdition] = useState('')
  const [isbn, setIsbn] = useState('')
  const [publisher, setPublisher] = useState('')
  const [examDate, setExamDate] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    if (!props.open) return
    setProjectId(props.course?.projectId ?? props.projects[0]?.id ?? '')
    setCourseName(props.course?.courseName ?? '')
    setTextbookTitle(props.course?.textbook?.title ?? '')
    setAuthor(props.course?.textbook?.author ?? '')
    setEdition(props.course?.textbook?.edition ?? '')
    setIsbn(props.course?.textbook?.isbn ?? '')
    setPublisher(props.course?.textbook?.publisher ?? '')
    setExamDate(props.course?.examDate ?? '')
    setError('')
  }, [props.open, props.course, props.projects])
  const submit = async (): Promise<void> => {
    const input: CreateCourseInput = {
      projectId,
      courseName,
      examDate: examDate || null,
      textbook: { title: textbookTitle, author, edition, isbn, publisher }
    }
    const result = props.course
      ? await window.youtrace.practice.updateCourse({ id: props.course.id, ...input })
      : await window.youtrace.practice.createCourse(input)
    if (!result.ok) return setError(result.error.message)
    await props.onSaved(result.data)
    props.onOpenChange(false)
  }
  return (
    <DialogFrame open={props.open} onOpenChange={props.onOpenChange} kicker="把学习资料接到项目" title={props.course ? '编辑课程' : '建立课程'} description="每门课程关联一个项目；建立后可继续添加教材、原文、课件和笔记等多个资料条目。">
      <div className="dialog-form">
        {props.projects.length === 0 ? <div className="inline-error">请先在“项目任务”中创建一个项目。</div> : <>
          <label><span>关联项目</span><select value={projectId} onChange={(event) => setProjectId(event.target.value)}>{props.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
          <label><span>课程名称</span><input autoFocus value={courseName} onChange={(event) => setCourseName(event.target.value)} placeholder="例如：计算机网络" /></label>
          <div className="form-row"><label><span>主教材 / 首份资料</span><input value={textbookTitle} onChange={(event) => setTextbookTitle(event.target.value)} placeholder="建立课程后还可继续添加资料" /></label><label><span>考试日期</span><input type="date" value={examDate} onChange={(event) => setExamDate(event.target.value)} /></label></div>
          <div className="form-row"><label><span>作者</span><input value={author} onChange={(event) => setAuthor(event.target.value)} /></label><label><span>版本</span><input value={edition} onChange={(event) => setEdition(event.target.value)} /></label></div>
          <div className="form-row"><label><span>ISBN</span><input value={isbn} onChange={(event) => setIsbn(event.target.value)} /></label><label><span>出版社</span><input value={publisher} onChange={(event) => setPublisher(event.target.value)} /></label></div>
        </>}
        {error && <div className="inline-error">{error}</div>}
      </div>
      <div className="dialog-actions"><Dialog.Close className="button button-secondary">取消</Dialog.Close><button className="button button-primary" disabled={!projectId || !courseName.trim() || !textbookTitle.trim()} onClick={() => void submit()}>{props.course ? '保存修改' : '建立课程'}</button></div>
    </DialogFrame>
  )
}

function CourseMaterialDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  course: Course | null
  material: CourseMaterial | null
  onSaved: () => Promise<void>
}): React.JSX.Element {
  const [materialType, setMaterialType] = useState<CourseMaterial['materialType']>('other')
  const [title, setTitle] = useState('')
  const [author, setAuthor] = useState('')
  const [edition, setEdition] = useState('')
  const [isbn, setIsbn] = useState('')
  const [publisher, setPublisher] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (!props.open) return
    setMaterialType(props.material?.materialType ?? 'other')
    setTitle(props.material?.title ?? '')
    setAuthor(props.material?.author ?? '')
    setEdition(props.material?.edition ?? '')
    setIsbn(props.material?.isbn ?? '')
    setPublisher(props.material?.publisher ?? '')
    setDescription(props.material?.description ?? '')
    setError('')
    setSaving(false)
  }, [props.open, props.material])

  const submit = async (): Promise<void> => {
    if (!props.course || saving) return
    setSaving(true)
    setError('')
    const input: CreateCourseMaterialInput = {
      courseId: props.course.id,
      materialType,
      title,
      author,
      edition,
      isbn,
      publisher,
      description
    }
    const result = props.material
      ? await window.youtrace.practice.updateCourseMaterial({ id: props.material.id, ...input })
      : await window.youtrace.practice.createCourseMaterial(input)
    if (!result.ok) {
      setError(result.error.message)
      setSaving(false)
      return
    }
    await props.onSaved()
    props.onOpenChange(false)
  }

  return (
    <DialogFrame
      open={props.open}
      onOpenChange={props.onOpenChange}
      kicker={props.course?.courseName ?? '课程学习'}
      title={props.material ? '编辑资料条目' : '添加资料条目'}
      description="一个课程可以有多个资料条目；保存后可在条目卡片中点击或拖拽添加多个附件。"
    >
      <div className="dialog-form">
        <div className="form-row">
          <label>
            <span>资料类型</span>
            <select
              value={materialType}
              onChange={(event) =>
                setMaterialType(event.target.value as CourseMaterial['materialType'])
              }
            >
              {Object.entries(courseMaterialLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label>
            <span>资料名称</span>
            <input
              autoFocus
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="例如：第 8 版教材原文"
            />
          </label>
        </div>
        <div className="form-row">
          <label><span>作者 / 整理人</span><input value={author} onChange={(event) => setAuthor(event.target.value)} /></label>
          <label><span>版本</span><input value={edition} onChange={(event) => setEdition(event.target.value)} /></label>
        </div>
        <div className="form-row">
          <label><span>ISBN</span><input value={isbn} onChange={(event) => setIsbn(event.target.value)} /></label>
          <label><span>出版社 / 来源</span><input value={publisher} onChange={(event) => setPublisher(event.target.value)} /></label>
        </div>
        <label>
          <span>说明</span>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="记录用途、覆盖章节、笔记状态或其他说明。"
          />
        </label>
        <div className="course-material-dialog-tip">
          <Paperclip size={15} />
          <span>保存后，附件会复制到工作区的 attachments/course-materials 文件夹。</span>
        </div>
        {error && <div className="inline-error">{error}</div>}
      </div>
      <div className="dialog-actions">
        <Dialog.Close className="button button-secondary">取消</Dialog.Close>
        <button
          className="button button-primary"
          type="button"
          disabled={!props.course || !title.trim() || saving}
          onClick={() => void submit()}
        >
          {saving ? '保存中…' : props.material ? '保存修改' : '添加资料'}
        </button>
      </div>
    </DialogFrame>
  )
}

function KnowledgeDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  course: Course | null
  knowledge: KnowledgeItem | null
  milestones: Milestone[]
  onSaved: () => Promise<void>
}): React.JSX.Element {
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [milestoneId, setMilestoneId] = useState('')
  const [mastery, setMastery] = useState('')
  const [reviewDate, setReviewDate] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    if (!props.open) return
    setTitle(props.knowledge?.title ?? '')
    setContent(props.knowledge?.content ?? '')
    setMilestoneId(props.knowledge?.milestoneId ?? '')
    setMastery(props.knowledge?.mastery?.toString() ?? '')
    setReviewDate(props.knowledge?.nextReviewDate ?? '')
    setError('')
  }, [props.open, props.knowledge])
  const submit = async (): Promise<void> => {
    if (!props.course) return
    const input: CreateKnowledgeInput = { projectId: props.course.projectId, milestoneId: milestoneId || null, title, content, mastery: mastery ? Number(mastery) : null, nextReviewDate: reviewDate || null }
    const result = props.knowledge
      ? await window.youtrace.practice.updateKnowledge({ id: props.knowledge.id, ...input })
      : await window.youtrace.practice.createKnowledge(input)
    if (!result.ok) return setError(result.error.message)
    await props.onSaved()
    props.onOpenChange(false)
  }
  return (
    <DialogFrame open={props.open} onOpenChange={props.onOpenChange} kicker={props.course?.courseName ?? '课程'} title={props.knowledge ? '编辑知识点' : '添加知识点'} description="内容可被全局搜索，掌握度不等同于完成进度。">
      <div className="dialog-form">
        <label><span>知识点标题</span><input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} /></label>
        <label><span>内容</span><textarea value={content} onChange={(event) => setContent(event.target.value)} /></label>
        <label><span>所属章节 / 里程碑</span><select value={milestoneId} onChange={(event) => setMilestoneId(event.target.value)}><option value="">不关联章节</option>{props.milestones.map((milestone) => <option key={milestone.id} value={milestone.id}>{milestone.title}</option>)}</select></label>
        <div className="form-row"><label><span>掌握度（0–100）</span><input type="number" min="0" max="100" value={mastery} onChange={(event) => setMastery(event.target.value)} /></label><label><span>下次复习</span><input type="date" value={reviewDate} onChange={(event) => setReviewDate(event.target.value)} /></label></div>
        {error && <div className="inline-error">{error}</div>}
      </div>
      <div className="dialog-actions"><Dialog.Close className="button button-secondary">取消</Dialog.Close><button className="button button-primary" disabled={!title.trim() || !props.course} onClick={() => void submit()}>{props.knowledge ? '保存修改' : '添加知识点'}</button></div>
    </DialogFrame>
  )
}

function MistakeDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  course: Course | null
  mistake: Mistake | null
  knowledgeItems: KnowledgeItem[]
  onSaved: () => Promise<void>
}): React.JSX.Element {
  const [question, setQuestion] = useState('')
  const [wrongAnswer, setWrongAnswer] = useState('')
  const [correctAnswer, setCorrectAnswer] = useState('')
  const [analysis, setAnalysis] = useState('')
  const [knowledgeItemId, setKnowledgeItemId] = useState('')
  const [mastery, setMastery] = useState('')
  const [reviewDate, setReviewDate] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    if (!props.open) return
    setQuestion(props.mistake?.question ?? '')
    setWrongAnswer(props.mistake?.wrongAnswer ?? '')
    setCorrectAnswer(props.mistake?.correctAnswer ?? '')
    setAnalysis(props.mistake?.analysis ?? '')
    setKnowledgeItemId(props.mistake?.knowledgeItemId ?? '')
    setMastery(props.mistake?.mastery?.toString() ?? '')
    setReviewDate(props.mistake?.nextReviewDate ?? '')
    setError('')
  }, [props.open, props.mistake])
  const submit = async (): Promise<void> => {
    if (!props.course) return
    const input: CreateMistakeInput = { projectId: props.course.projectId, knowledgeItemId: knowledgeItemId || null, question, wrongAnswer, correctAnswer, analysis, mastery: mastery ? Number(mastery) : null, nextReviewDate: reviewDate || null }
    const result = props.mistake
      ? await window.youtrace.practice.updateMistake({ id: props.mistake.id, ...input })
      : await window.youtrace.practice.createMistake(input)
    if (!result.ok) return setError(result.error.message)
    await props.onSaved()
    props.onOpenChange(false)
  }
  return (
    <DialogFrame open={props.open} onOpenChange={props.onOpenChange} kicker={props.course?.courseName ?? '课程'} title={props.mistake ? '编辑错题' : '记录错题'} description="保留错误答案、正确答案和分析，方便之后验证修正。">
      <div className="dialog-form">
        <label><span>题目</span><textarea autoFocus value={question} onChange={(event) => setQuestion(event.target.value)} /></label>
        <div className="form-row"><label><span>错误答案</span><textarea value={wrongAnswer} onChange={(event) => setWrongAnswer(event.target.value)} /></label><label><span>正确答案</span><textarea value={correctAnswer} onChange={(event) => setCorrectAnswer(event.target.value)} /></label></div>
        <label><span>错误分析</span><textarea value={analysis} onChange={(event) => setAnalysis(event.target.value)} /></label>
        <label><span>关联知识点</span><select value={knowledgeItemId} onChange={(event) => setKnowledgeItemId(event.target.value)}><option value="">不关联知识点</option>{props.knowledgeItems.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
        <div className="form-row"><label><span>掌握度（0–100）</span><input type="number" min="0" max="100" value={mastery} onChange={(event) => setMastery(event.target.value)} /></label><label><span>下次复习</span><input type="date" value={reviewDate} onChange={(event) => setReviewDate(event.target.value)} /></label></div>
        {error && <div className="inline-error">{error}</div>}
      </div>
      <div className="dialog-actions"><Dialog.Close className="button button-secondary">取消</Dialog.Close><button className="button button-primary" disabled={!question.trim() || !props.course} onClick={() => void submit()}>{props.mistake ? '保存修改' : '记录错题'}</button></div>
    </DialogFrame>
  )
}

function LearningTestDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  course: Course | null
  learningTest: LearningTest | null
  milestones: Milestone[]
  onSaved: () => Promise<void>
}): React.JSX.Element {
  const [title, setTitle] = useState('')
  const [score, setScore] = useState('')
  const [maxScore, setMaxScore] = useState('100')
  const [milestoneId, setMilestoneId] = useState('')
  const [testedAt, setTestedAt] = useState(toDateTimeLocal(new Date().toISOString()))
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    if (!props.open) return
    setTitle(props.learningTest?.title ?? '')
    setScore(props.learningTest?.score?.toString() ?? '')
    setMaxScore(props.learningTest?.maxScore?.toString() ?? '100')
    setMilestoneId(props.learningTest?.milestoneId ?? '')
    setTestedAt(toDateTimeLocal(props.learningTest?.testedAt ?? new Date().toISOString()))
    setNote(props.learningTest?.note ?? '')
    setError('')
  }, [props.open, props.learningTest])
  const submit = async (): Promise<void> => {
    if (!props.course) return
    const input: CreateLearningTestInput = {
      projectId: props.course.projectId,
      milestoneId: milestoneId || null,
      title,
      score: score ? Number(score) : null,
      maxScore: maxScore ? Number(maxScore) : null,
      testedAt: new Date(testedAt).toISOString(),
      note
    }
    const result = props.learningTest
      ? await window.youtrace.practice.updateLearningTest({ id: props.learningTest.id, ...input })
      : await window.youtrace.practice.createLearningTest(input)
    if (!result.ok) return setError(result.error.message)
    await props.onSaved()
    props.onOpenChange(false)
  }
  return <DialogFrame open={props.open} onOpenChange={props.onOpenChange} kicker={props.course?.courseName ?? '课程'} title={props.learningTest ? '编辑学习测试' : '记录学习测试'} description="测试成绩是掌握证据，不会自动改写任务完成状态。"><div className="dialog-form"><label><span>测试名称</span><input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} /></label><label><span>所属章节 / 里程碑</span><select value={milestoneId} onChange={(event) => setMilestoneId(event.target.value)}><option value="">不关联章节</option>{props.milestones.map((milestone) => <option key={milestone.id} value={milestone.id}>{milestone.title}</option>)}</select></label><div className="form-row form-row-three"><label><span>成绩</span><input type="number" min="0" value={score} onChange={(event) => setScore(event.target.value)} /></label><label><span>满分</span><input type="number" min="1" value={maxScore} onChange={(event) => setMaxScore(event.target.value)} /></label><label><span>测试时间</span><input type="datetime-local" value={testedAt} onChange={(event) => setTestedAt(event.target.value)} /></label></div><label><span>说明</span><textarea value={note} onChange={(event) => setNote(event.target.value)} /></label>{error && <div className="inline-error">{error}</div>}</div><div className="dialog-actions"><Dialog.Close className="button button-secondary">取消</Dialog.Close><button className="button button-primary" disabled={!title.trim() || !props.course || !testedAt} onClick={() => void submit()}>{props.learningTest ? '保存修改' : '记录测试'}</button></div></DialogFrame>
}

function toDateTimeLocal(value: string): string {
  const date = new Date(value)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

function reviewResultLabel(result: 'again' | 'hard' | 'good' | 'easy'): string {
  return { again: '重来', hard: '困难', good: '良好', easy: '轻松' }[result]
}
