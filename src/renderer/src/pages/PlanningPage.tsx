import * as Dialog from '@radix-ui/react-dialog'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CalendarClock,
  Check,
  ChevronRight,
  Circle,
  Archive,
  Flag,
  Gauge,
  Link2,
  Layers3,
  ListChecks,
  ListPlus,
  Plus,
  Repeat2,
  Tag,
  Target,
  X
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type {
  CreateProjectInput,
  CreateTaskInput,
  Area,
  Goal,
  IpcResult,
  Milestone,
  Project,
  Task
} from '../../../shared/contracts'
import { PracticePage } from './PracticePage'

function unwrap<T>(result: IpcResult<T>): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.data
}

const projectStatusLabels: Record<Project['status'], string> = {
  planned: '计划中',
  active: '进行中',
  paused: '暂停',
  completed: '完成',
  cancelled: '取消',
  archived: '归档'
}

const taskStatusLabels: Record<Task['status'], string> = {
  inbox: '收件箱',
  ready: '待安排',
  scheduled: '已安排',
  in_progress: '进行中',
  blocked: '阻塞',
  completed: '已完成',
  cancelled: '已取消'
}

const priorityLabels: Record<Task['priority'], string> = {
  low: '低',
  medium: '中',
  high: '高',
  critical: '关键'
}

export function PlanningPage(): React.JSX.Element {
  const queryClient = useQueryClient()
  const [section, setSection] = useState<'projects' | 'practice'>('projects')
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [projectDialogOpen, setProjectDialogOpen] = useState(false)
  const [taskDialogOpen, setTaskDialogOpen] = useState(false)
  const [milestoneDialogOpen, setMilestoneDialogOpen] = useState(false)
  const [goalDialogOpen, setGoalDialogOpen] = useState(false)
  const [areaDialogOpen, setAreaDialogOpen] = useState(false)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [showArchived, setShowArchived] = useState(false)

  const projectsQuery = useQuery({
    queryKey: ['projects', showArchived],
    queryFn: async () => unwrap(await window.youtrace.planning.listProjects(showArchived))
  })
  const areasQuery = useQuery({
    queryKey: ['areas'],
    queryFn: async () => unwrap(await window.youtrace.planning.listAreas())
  })
  const tagsQuery = useQuery({
    queryKey: ['tags'],
    queryFn: async () => unwrap(await window.youtrace.planning.listTags())
  })
  const tasksQuery = useQuery({
    queryKey: ['tasks', selectedProjectId],
    enabled: selectedProjectId !== null,
    queryFn: async () =>
      unwrap(
        await window.youtrace.planning.listTasks({
          projectId: selectedProjectId,
          statuses: [],
          tagIds: [],
          includeDeleted: false,
          limit: 200,
          offset: 0
        })
      )
  })
  const milestonesQuery = useQuery({
    queryKey: ['milestones', selectedProjectId],
    enabled: selectedProjectId !== null,
    queryFn: async () =>
      unwrap(await window.youtrace.planning.listMilestones(selectedProjectId!))
  })
  const goalsQuery = useQuery({
    queryKey: ['goals', selectedProjectId],
    enabled: selectedProjectId !== null,
    queryFn: async () => unwrap(await window.youtrace.planning.listGoals(selectedProjectId))
  })

  const projects = projectsQuery.data ?? []
  useEffect(() => {
    if (!selectedProjectId && projects[0]) setSelectedProjectId(projects[0].id)
    if (selectedProjectId && !projects.some((project) => project.id === selectedProjectId)) {
      setSelectedProjectId(projects[0]?.id ?? null)
    }
  }, [projects, selectedProjectId])

  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null
  const tasks = tasksQuery.data ?? []
  const milestones = milestonesQuery.data ?? []
  const goals = goalsQuery.data ?? []
  const completedCount = tasks.filter((task) => task.status === 'completed').length

  const updateTask = useMutation({
    mutationFn: async (input: { id: string; status: Task['status'] }) =>
      unwrap(await window.youtrace.planning.updateTask(input)),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['tasks'] }),
        queryClient.invalidateQueries({ queryKey: ['projects'] })
      ])
    }
  })

  return (
    <div className="planning-page">
      <header className="planning-toolbar">
        <div>
          <span className="page-kicker">从结果拆到下一步</span>
          <h1>计划</h1>
          <p>项目组织结果，任务只表达一次可以开始的行动。</p>
        </div>
        <div className="toolbar-actions">
          <button className="button button-secondary" type="button" onClick={() => setAreaDialogOpen(true)}>
            <Target size={15} />
            领域
          </button>
          <button className="button button-secondary" type="button" onClick={() => setProjectDialogOpen(true)}>
            <Layers3 size={16} />
            新建项目
          </button>
          <button
            className="button button-primary"
            type="button"
            disabled={!selectedProject}
            onClick={() => setTaskDialogOpen(true)}
          >
            <Plus size={17} />
            新建任务
          </button>
        </div>
      </header>

      <div className="planning-section-tabs" role="tablist" aria-label="计划模块">
        <button type="button" role="tab" aria-selected={section === 'projects'} className={section === 'projects' ? 'active' : ''} onClick={() => setSection('projects')}>
          <ListChecks size={15} />
          项目任务
        </button>
        <button type="button" role="tab" aria-selected={section === 'practice'} className={section === 'practice' ? 'active' : ''} onClick={() => setSection('practice')}>
          <Gauge size={15} />
          实践与学习
        </button>
      </div>

      {section === 'practice' ? <PracticePage /> : <div className="planning-layout">
        <aside className="project-rail panel">
          <div className="rail-heading">
            <span>项目</span>
            <button type="button" className={showArchived ? 'active' : ''} onClick={() => setShowArchived((value) => !value)}>
              <Archive size={11} />
              {showArchived ? '含归档' : '归档'}
            </button>
            <strong>{projects.length}</strong>
          </div>

          {projectsQuery.isPending ? (
            <p className="rail-message">正在读取项目…</p>
          ) : projects.length === 0 ? (
            <div className="project-empty">
              <Layers3 size={24} />
              <strong>还没有项目</strong>
              <p>先定义一个想得到的结果，再把它拆成可执行任务。</p>
              <button className="button button-secondary" onClick={() => setProjectDialogOpen(true)}>
                创建第一个项目
              </button>
            </div>
          ) : (
            <div className="project-list">
              {projects.map((project) => {
                const progress =
                  project.progressMode === 'equal' ? project.equalProgress : project.workloadProgress
                return (
                  <button
                    type="button"
                    key={project.id}
                    className={project.id === selectedProjectId ? 'active' : ''}
                    onClick={() => setSelectedProjectId(project.id)}
                  >
                    <span
                      className="project-progress"
                      style={{ '--project-progress': `${Math.round(progress * 360)}deg` } as React.CSSProperties}
                    >
                      <i />
                    </span>
                    <span className="project-list-copy">
                      <strong>{project.name}</strong>
                      <small>
                        {projectStatusLabels[project.status]} · {Math.round(progress * 100)}%
                      </small>
                    </span>
                    <ChevronRight size={15} />
                  </button>
                )
              })}
            </div>
          )}
        </aside>

        <main className="project-workspace panel">
          {!selectedProject ? (
            <div className="large-empty">
              <div className="focus-orbit">
                <span />
              </div>
              <h2>从一个明确结果开始</h2>
              <p>项目会把成功标准、里程碑、任务、投入和成果放在同一条轨迹上。</p>
            </div>
          ) : (
            <>
              <header className="project-header">
                <div>
                  <div className="project-meta">
                    <span>{projectStatusLabels[selectedProject.status]}</span>
                    <span>
                      {selectedProject.progressMode === 'equal' ? '等权进度' : '工作量进度'}
                    </span>
                  </div>
                  <h2>{selectedProject.name}</h2>
                  <p>{selectedProject.description || '还没有项目说明。'}</p>
                </div>
                <div className="project-progress-summary">
                  <strong>
                    {Math.round(
                      (selectedProject.progressMode === 'equal'
                        ? selectedProject.equalProgress
                        : selectedProject.workloadProgress) * 100
                    )}
                    <small>%</small>
                  </strong>
                  <span>
                    等权 {Math.round(selectedProject.equalProgress * 100)}% · 工作量{' '}
                    {Math.round(selectedProject.workloadProgress * 100)}%
                  </span>
                  <button
                    type="button"
                    className="project-archive-action"
                    onClick={async () => {
                      await window.youtrace.planning.updateProject({
                        id: selectedProject.id,
                        status: selectedProject.status === 'archived' ? 'active' : 'archived'
                      })
                      await queryClient.invalidateQueries({ queryKey: ['projects'] })
                    }}
                  >
                    <Archive size={12} />
                    {selectedProject.status === 'archived' ? '取消归档' : '归档项目'}
                  </button>
                </div>
              </header>

              <div className="project-facts">
                <div>
                  <ListChecks size={17} />
                  <span>
                    <strong>{completedCount} / {tasks.length}</strong>
                    任务完成
                  </span>
                </div>
                <div>
                  <Gauge size={17} />
                  <span>
                    <strong>
                      {selectedProject.masteryAverage === null
                        ? '未评估'
                        : `${Math.round(selectedProject.masteryAverage)}%`}
                    </strong>
                    掌握度 · {selectedProject.masteryAssessed}/{selectedProject.masteryTotal}
                  </span>
                </div>
                <div>
                  <CalendarClock size={17} />
                  <span>
                    <strong>{selectedProject.targetDate ?? '未设置'}</strong>
                    目标日期
                  </span>
                </div>
              </div>

              <section className="goal-section">
                <div className="task-section-heading">
                  <div><span className="section-label">成功标准与衡量方式</span><h3>目标</h3></div>
                  <button className="text-action" type="button" onClick={() => setGoalDialogOpen(true)}><Plus size={14} />添加目标</button>
                </div>
                {goals.length === 0 ? (
                  <button className="goal-empty" type="button" onClick={() => setGoalDialogOpen(true)}><Target size={16} /><span><strong>定义可验证的目标</strong><small>目标可以使用里程碑、指标、工作量或人工确认衡量。</small></span></button>
                ) : (
                  <div className="goal-strip">
                    {goals.map((goal) => <article key={goal.id}><Target size={14} /><div><strong>{goal.title}</strong><span>{goal.successCriteria || '未填写成功标准'}</span></div><small>{measureLabel(goal.measureType)} · {goal.targetDate ?? '未设日期'}</small></article>)}
                  </div>
                )}
              </section>

              <section className="milestone-section">
                <div className="task-section-heading">
                  <div>
                    <span className="section-label">阶段结果</span>
                    <h3>里程碑</h3>
                  </div>
                  <button className="text-action" type="button" onClick={() => setMilestoneDialogOpen(true)}>
                    <Plus size={14} />
                    添加里程碑
                  </button>
                </div>
                {milestones.length === 0 ? (
                  <button className="milestone-empty" type="button" onClick={() => setMilestoneDialogOpen(true)}>
                    <span className="trace-node current" />
                    <span>
                      <strong>把项目拆成可验证的阶段结果</strong>
                      <small>例如教材章节、功能版本或训练周期。</small>
                    </span>
                  </button>
                ) : (
                  <div className="milestone-track">
                    {milestones.map((milestone) => (
                      <article key={milestone.id}>
                        <span className={`milestone-node milestone-${milestone.status}`}>
                          {milestone.progress >= 1 ? <Check size={12} /> : null}
                        </span>
                        <div>
                          <strong>{milestone.title}</strong>
                          <span>
                            进度 {Math.round(milestone.progress * 100)}%
                            {milestone.manualWeight ? ` · 权重 ${milestone.manualWeight}` : ''}
                            {milestone.mastery !== null ? ` · 掌握度 ${milestone.mastery}%` : ''}
                          </span>
                        </div>
                        <small>{milestone.plannedDate ?? '未设日期'}</small>
                      </article>
                    ))}
                  </div>
                )}
              </section>

              <section className="task-section">
                <div className="task-section-heading">
                  <div>
                    <span className="section-label">下一步行动</span>
                    <h3>任务</h3>
                  </div>
                  <button className="text-action" type="button" onClick={() => setTaskDialogOpen(true)}>
                    <Plus size={14} />
                    添加任务
                  </button>
                </div>

                {tasksQuery.isPending ? (
                  <p className="rail-message">正在读取任务…</p>
                ) : tasks.length === 0 ? (
                  <button className="task-empty" type="button" onClick={() => setTaskDialogOpen(true)}>
                    <Plus size={18} />
                    <span>
                      <strong>写下这个项目的第一步</strong>
                      <small>任务标题应当是一个可以直接开始的动作。</small>
                    </span>
                  </button>
                ) : (
                  <div className="task-list">
                    {tasks.map((task) => (
                      <article key={task.id} className={task.status === 'completed' ? 'completed' : ''}>
                        <button
                          type="button"
                          className="task-check"
                          aria-label={task.status === 'completed' ? '重新打开任务' : '完成任务'}
                          onClick={() =>
                            updateTask.mutate({
                              id: task.id,
                              status: task.status === 'completed' ? 'ready' : 'completed'
                            })
                          }
                        >
                          {task.status === 'completed' ? <Check size={14} /> : <Circle size={14} />}
                        </button>
                        <button type="button" className="task-copy task-detail-trigger" onClick={() => setSelectedTask(task)}>
                          <strong>{task.title}</strong>
                          <div>
                            <span>{taskStatusLabels[task.status]}</span>
                            {task.estimatedMinutes && <span>{task.estimatedMinutes} 分钟</span>}
                            {task.difficulty && <span>难度 {task.difficulty}</span>}
                            {(task.parentTaskId === null || task.checklistProgressEnabled) && <span>进度 {Math.round(task.progress * 100)}%</span>}
                            <span className={`priority priority-${task.priority}`}>
                              <Flag size={11} />
                              {priorityLabels[task.priority]}
                            </span>
                          </div>
                        </button>
                        <div className="task-tags">
                          {task.tagIds.map((tagId) => {
                            const tag = tagsQuery.data?.find((candidate) => candidate.id === tagId)
                            return tag ? (
                              <span key={tag.id} style={{ '--tag-color': tag.color ?? '#216E65' } as React.CSSProperties}>
                                {tag.name}
                              </span>
                            ) : null
                          })}
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </main>
      </div>}

      <ProjectDialog
        open={projectDialogOpen}
        onOpenChange={setProjectDialogOpen}
        areas={areasQuery.data ?? []}
        onCreated={async (project) => {
          setSelectedProjectId(project.id)
          await queryClient.invalidateQueries({ queryKey: ['projects'] })
        }}
      />
      <TaskDialog
        open={taskDialogOpen}
        onOpenChange={setTaskDialogOpen}
        project={selectedProject}
        tags={tagsQuery.data ?? []}
        milestones={milestones}
        goals={goals}
        tasks={tasks}
        onCreated={async () => {
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['tasks'] }),
            queryClient.invalidateQueries({ queryKey: ['projects'] })
          ])
        }}
      />
      <MilestoneDialog
        open={milestoneDialogOpen}
        onOpenChange={setMilestoneDialogOpen}
        project={selectedProject}
        goals={goals}
        onCreated={async () => {
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['milestones'] }),
            queryClient.invalidateQueries({ queryKey: ['projects'] })
          ])
        }}
      />
      <GoalDialog
        open={goalDialogOpen}
        onOpenChange={setGoalDialogOpen}
        project={selectedProject}
        onCreated={async () => {
          await queryClient.invalidateQueries({ queryKey: ['goals'] })
        }}
      />
      <AreaDialog
        open={areaDialogOpen}
        onOpenChange={setAreaDialogOpen}
        areas={areasQuery.data ?? []}
        onChanged={async () => {
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['areas'] }),
            queryClient.invalidateQueries({ queryKey: ['projects'] })
          ])
        }}
      />
      <TaskInspector
        task={selectedTask}
        tasks={tasks}
        onOpenChange={(open) => { if (!open) setSelectedTask(null) }}
        onChanged={async () => {
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['tasks'] }),
            queryClient.invalidateQueries({ queryKey: ['projects'] })
          ])
        }}
      />
    </div>
  )
}

interface ProjectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  areas: Area[]
  onCreated: (project: Project) => Promise<void>
}

function ProjectDialog({ open, onOpenChange, areas, onCreated }: ProjectDialogProps): React.JSX.Element {
  const [name, setName] = useState('')
  const [areaId, setAreaId] = useState('')
  const [description, setDescription] = useState('')
  const [targetDate, setTargetDate] = useState('')
  const [progressMode, setProgressMode] = useState<Project['progressMode']>('equal')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (): Promise<void> => {
    setBusy(true)
    setError('')
    const input: CreateProjectInput = {
      areaId: areaId || null,
      name,
      description,
      status: 'active',
      startDate: new Date().toISOString().slice(0, 10),
      targetDate: targetDate || null,
      successCriteria: '',
      progressMode
    }
    const result = await window.youtrace.planning.createProject(input)
    setBusy(false)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    await onCreated(result.data)
    setName('')
    setAreaId('')
    setDescription('')
    setTargetDate('')
    onOpenChange(false)
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content">
          <div className="dialog-heading">
            <div>
              <span className="section-label">定义一个结果容器</span>
              <Dialog.Title>新建项目</Dialog.Title>
              <Dialog.Description>项目承载成功标准、里程碑、任务和真实投入。</Dialog.Description>
            </div>
            <Dialog.Close className="dialog-close" aria-label="关闭">
              <X size={18} />
            </Dialog.Close>
          </div>
          <div className="dialog-form">
            <label>
              <span>项目名称</span>
              <input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：完成计算机网络课程" />
            </label>
            <label>
              <span>所属领域</span>
              <select value={areaId} onChange={(event) => setAreaId(event.target.value)}>
                <option value="">未归属领域</option>
                {areas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}
              </select>
            </label>
            <label>
              <span>项目说明</span>
              <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="这段工作为什么重要？" />
            </label>
            <div className="form-row">
              <label>
                <span>目标日期</span>
                <input type="date" value={targetDate} onChange={(event) => setTargetDate(event.target.value)} />
              </label>
              <label>
                <span>主进度模式</span>
                <select value={progressMode} onChange={(event) => setProgressMode(event.target.value as Project['progressMode'])}>
                  <option value="equal">等权进度</option>
                  <option value="workload">工作量进度</option>
                </select>
              </label>
            </div>
            {error && <div className="inline-error">{error}</div>}
          </div>
          <div className="dialog-actions">
            <Dialog.Close className="button button-secondary">取消</Dialog.Close>
            <button className="button button-primary" disabled={!name.trim() || busy} onClick={() => void submit()}>
              {busy ? '正在创建…' : '创建项目'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

interface TaskDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  project: Project | null
  tags: Array<{ id: string; name: string; color: string | null }>
  milestones: Milestone[]
  goals: Goal[]
  tasks: Task[]
  onCreated: () => Promise<void>
}

function TaskDialog({ open, onOpenChange, project, tags, milestones, goals, tasks, onCreated }: TaskDialogProps): React.JSX.Element {
  const [title, setTitle] = useState('')
  const [difficulty, setDifficulty] = useState('')
  const [priority, setPriority] = useState<Task['priority']>('medium')
  const [estimatedMinutes, setEstimatedMinutes] = useState('')
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([])
  const [milestoneId, setMilestoneId] = useState('')
  const [goalId, setGoalId] = useState('')
  const [parentTaskId, setParentTaskId] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const projectName = useMemo(() => project?.name ?? '', [project])

  const submit = async (): Promise<void> => {
    if (!project) return
    setBusy(true)
    setError('')
    const input: CreateTaskInput = {
      parentTaskId: parentTaskId || null,
      projectId: project.id,
      goalId: goalId || null,
      milestoneId: milestoneId || null,
      title,
      description: '',
      status: 'ready',
      difficulty: difficulty ? Number(difficulty) : null,
      priority,
      estimatedMinutes: estimatedMinutes ? Number(estimatedMinutes) : null,
      progressWeight: null,
      startDate: null,
      dueAt: null,
      verificationCriteria: '',
      includeInProgress: true,
      tagIds: selectedTagIds
    }
    const result = await window.youtrace.planning.createTask(input)
    setBusy(false)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    await onCreated()
    setTitle('')
    setDifficulty('')
    setEstimatedMinutes('')
    setSelectedTagIds([])
    setMilestoneId('')
    setGoalId('')
    setParentTaskId('')
    onOpenChange(false)
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content task-dialog">
          <div className="dialog-heading">
            <div>
              <span className="section-label">{projectName}</span>
              <Dialog.Title>新建任务</Dialog.Title>
              <Dialog.Description>写成一个可以直接开始、可以明确完成的动作。</Dialog.Description>
            </div>
            <Dialog.Close className="dialog-close" aria-label="关闭">
              <X size={18} />
            </Dialog.Close>
          </div>
          <div className="dialog-form">
            <label>
              <span>下一步是什么？</span>
              <input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：阅读第一章并整理分层模型" />
            </label>
            <div className="form-row form-row-three">
              <label>
                <span>难度</span>
                <select value={difficulty} onChange={(event) => setDifficulty(event.target.value)}>
                  <option value="">未设置</option>
                  <option value="1">1 · 轻松</option>
                  <option value="2">2 · 简单</option>
                  <option value="3">3 · 中等</option>
                  <option value="4">4 · 困难</option>
                  <option value="5">5 · 挑战</option>
                </select>
              </label>
              <label>
                <span>优先级</span>
                <select value={priority} onChange={(event) => setPriority(event.target.value as Task['priority'])}>
                  <option value="low">低</option>
                  <option value="medium">中</option>
                  <option value="high">高</option>
                  <option value="critical">关键</option>
                </select>
              </label>
              <label>
                <span>预计分钟</span>
                <input type="number" min="1" value={estimatedMinutes} onChange={(event) => setEstimatedMinutes(event.target.value)} />
              </label>
            </div>
            {milestones.length > 0 && (
              <label>
                <span>所属里程碑</span>
                <select value={milestoneId} onChange={(event) => setMilestoneId(event.target.value)}>
                  <option value="">不关联里程碑</option>
                  {milestones.map((milestone) => (
                    <option key={milestone.id} value={milestone.id}>
                      {milestone.title}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="form-row">
              <label>
                <span>所属目标</span>
                <select value={goalId} onChange={(event) => setGoalId(event.target.value)}>
                  <option value="">不关联目标</option>
                  {goals.map((goal) => <option key={goal.id} value={goal.id}>{goal.title}</option>)}
                </select>
              </label>
              <label>
                <span>父任务（创建子任务）</span>
                <select value={parentTaskId} onChange={(event) => setParentTaskId(event.target.value)}>
                  <option value="">顶层任务</option>
                  {tasks.filter((task) => task.status !== 'completed' && task.status !== 'cancelled').map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}
                </select>
              </label>
            </div>
            {tags.length > 0 && (
              <fieldset className="tag-picker">
                <legend>标签</legend>
                <div>
                  {tags.map((tag) => (
                    <button
                      type="button"
                      key={tag.id}
                      className={selectedTagIds.includes(tag.id) ? 'active' : ''}
                      onClick={() =>
                        setSelectedTagIds((current) =>
                          current.includes(tag.id)
                            ? current.filter((id) => id !== tag.id)
                            : [...current, tag.id]
                        )
                      }
                    >
                      <Tag size={12} />
                      {tag.name}
                    </button>
                  ))}
                </div>
              </fieldset>
            )}
            {error && <div className="inline-error">{error}</div>}
          </div>
          <div className="dialog-actions">
            <Dialog.Close className="button button-secondary">取消</Dialog.Close>
            <button className="button button-primary" disabled={!title.trim() || busy || !project} onClick={() => void submit()}>
              {busy ? '正在创建…' : '创建任务'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

interface MilestoneDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  project: Project | null
  goals: Goal[]
  onCreated: () => Promise<void>
}

function MilestoneDialog({
  open,
  onOpenChange,
  project,
  goals,
  onCreated
}: MilestoneDialogProps): React.JSX.Element {
  const [title, setTitle] = useState('')
  const [plannedDate, setPlannedDate] = useState('')
  const [estimatedMinutes, setEstimatedMinutes] = useState('')
  const [manualWeight, setManualWeight] = useState('')
  const [verificationCriteria, setVerificationCriteria] = useState('')
  const [goalId, setGoalId] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (): Promise<void> => {
    if (!project) return
    setBusy(true)
    setError('')
    const result = await window.youtrace.planning.createMilestone({
      projectId: project.id,
      goalId: goalId || null,
      title,
      description: '',
      plannedDate: plannedDate || null,
      estimatedMinutes: estimatedMinutes ? Number(estimatedMinutes) : null,
      manualWeight: manualWeight ? Number(manualWeight) : null,
      mastery: null,
      verificationCriteria,
      status: 'not_started',
      includeInProgress: true
    })
    setBusy(false)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    await onCreated()
    setTitle('')
    setPlannedDate('')
    setEstimatedMinutes('')
    setManualWeight('')
    setVerificationCriteria('')
    setGoalId('')
    onOpenChange(false)
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content">
          <div className="dialog-heading">
            <div>
              <span className="section-label">{project?.name ?? '当前项目'}</span>
              <Dialog.Title>新建里程碑</Dialog.Title>
              <Dialog.Description>里程碑是一项阶段性、可以验证的结果。</Dialog.Description>
            </div>
            <Dialog.Close className="dialog-close" aria-label="关闭">
              <X size={18} />
            </Dialog.Close>
          </div>
          <div className="dialog-form">
            <label>
              <span>里程碑名称</span>
              <input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：完成教材第一章" />
            </label>
            <label>
              <span>所属目标</span>
              <select value={goalId} onChange={(event) => setGoalId(event.target.value)}>
                <option value="">直接属于项目</option>
                {goals.map((goal) => <option key={goal.id} value={goal.id}>{goal.title}</option>)}
              </select>
            </label>
            <div className="form-row form-row-three">
              <label>
                <span>计划日期</span>
                <input type="date" value={plannedDate} onChange={(event) => setPlannedDate(event.target.value)} />
              </label>
              <label>
                <span>预计分钟</span>
                <input type="number" min="1" value={estimatedMinutes} onChange={(event) => setEstimatedMinutes(event.target.value)} />
              </label>
              <label>
                <span>手动权重</span>
                <input type="number" min="0.01" step="0.01" value={manualWeight} onChange={(event) => setManualWeight(event.target.value)} />
              </label>
            </div>
            <label>
              <span>验证标准</span>
              <textarea value={verificationCriteria} onChange={(event) => setVerificationCriteria(event.target.value)} placeholder="什么事实可以证明这个阶段已经完成？" />
            </label>
            {error && <div className="inline-error">{error}</div>}
          </div>
          <div className="dialog-actions">
            <Dialog.Close className="button button-secondary">取消</Dialog.Close>
            <button className="button button-primary" disabled={!title.trim() || busy || !project} onClick={() => void submit()}>
              {busy ? '正在创建…' : '创建里程碑'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function GoalDialog({
  open,
  onOpenChange,
  project,
  onCreated
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  project: Project | null
  onCreated: () => Promise<void>
}): React.JSX.Element {
  const [title, setTitle] = useState('')
  const [successCriteria, setSuccessCriteria] = useState('')
  const [targetDate, setTargetDate] = useState('')
  const [measureType, setMeasureType] = useState<Goal['measureType']>('milestone')
  const [error, setError] = useState('')
  const submit = async (): Promise<void> => {
    if (!project) return
    const result = await window.youtrace.planning.createGoal({
      projectId: project.id,
      title,
      successCriteria,
      targetDate: targetDate || null,
      measureType,
      status: 'active'
    })
    if (!result.ok) return setError(result.error.message)
    await onCreated()
    setTitle('')
    setSuccessCriteria('')
    setTargetDate('')
    onOpenChange(false)
  }
  return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="dialog-content"><div className="dialog-heading"><div><span className="section-label">{project?.name ?? '独立目标'}</span><Dialog.Title>新建目标</Dialog.Title><Dialog.Description>先定义什么结果算成功，再选择衡量方式。</Dialog.Description></div><Dialog.Close className="dialog-close" aria-label="关闭"><X size={18} /></Dialog.Close></div><div className="dialog-form"><label><span>目标名称</span><input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} /></label><label><span>成功标准</span><textarea value={successCriteria} onChange={(event) => setSuccessCriteria(event.target.value)} /></label><div className="form-row"><label><span>目标日期</span><input type="date" value={targetDate} onChange={(event) => setTargetDate(event.target.value)} /></label><label><span>衡量方式</span><select value={measureType} onChange={(event) => setMeasureType(event.target.value as Goal['measureType'])}><option value="milestone">里程碑完成度</option><option value="metric">数值指标</option><option value="workload">累计工作量</option><option value="manual">人工确认</option></select></label></div>{error && <div className="inline-error">{error}</div>}</div><div className="dialog-actions"><Dialog.Close className="button button-secondary">取消</Dialog.Close><button className="button button-primary" disabled={!title.trim() || !project} onClick={() => void submit()}>创建目标</button></div></Dialog.Content></Dialog.Portal></Dialog.Root>
}

function AreaDialog({
  open,
  onOpenChange,
  areas,
  onChanged
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  areas: Area[]
  onChanged: () => Promise<void>
}): React.JSX.Element {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState('#216E65')
  const [error, setError] = useState('')
  const create = async (): Promise<void> => {
    const result = await window.youtrace.planning.createArea({
      name,
      description,
      color,
      icon: null
    })
    if (!result.ok) return setError(result.error.message)
    setName('')
    setDescription('')
    await onChanged()
  }
  return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="dialog-content area-dialog"><div className="dialog-heading"><div><span className="section-label">长期责任分类</span><Dialog.Title>领域</Dialog.Title><Dialog.Description>预设可编辑和归档；项目只引用稳定领域 ID。</Dialog.Description></div><Dialog.Close className="dialog-close" aria-label="关闭"><X size={18} /></Dialog.Close></div><div className="area-list">{areas.map((area) => <article key={area.id}><span style={{ background: area.color ?? '#216E65' }} /><div><strong>{area.name}</strong><small>{area.description || '没有说明'}</small></div><button type="button" onClick={async () => { await window.youtrace.planning.updateArea({ id: area.id, archived: true }); await onChanged() }}><Archive size={12} />归档</button></article>)}</div><div className="dialog-form"><div className="form-row"><label><span>新领域名称</span><input value={name} onChange={(event) => setName(event.target.value)} /></label><label><span>颜色</span><input type="color" value={color} onChange={(event) => setColor(event.target.value)} /></label></div><label><span>说明</span><input value={description} onChange={(event) => setDescription(event.target.value)} /></label>{error && <div className="inline-error">{error}</div>}</div><div className="dialog-actions"><Dialog.Close className="button button-secondary">完成</Dialog.Close><button className="button button-primary" disabled={!name.trim()} onClick={() => void create()}><Plus size={14} />添加领域</button></div></Dialog.Content></Dialog.Portal></Dialog.Root>
}

function TaskInspector({
  task,
  tasks,
  onOpenChange,
  onChanged
}: {
  task: Task | null
  tasks: Task[]
  onOpenChange: (open: boolean) => void
  onChanged: () => Promise<void>
}): React.JSX.Element {
  const queryClient = useQueryClient()
  const [checkText, setCheckText] = useState('')
  const [dependencyId, setDependencyId] = useState('')
  const [overrideReason, setOverrideReason] = useState('')
  const [frequency, setFrequency] = useState<'daily' | 'weekly' | 'monthly' | 'weekdays' | 'interval'>('weekly')
  const [intervalValue, setIntervalValue] = useState('1')
  const [nextOccurrence, setNextOccurrence] = useState('')
  const [checklistEnabled, setChecklistEnabled] = useState(false)
  const [error, setError] = useState('')
  const checklistQuery = useQuery({
    queryKey: ['task-checklist', task?.id],
    enabled: Boolean(task),
    queryFn: async () => unwrap(await window.youtrace.planning.listChecklist(task!.id))
  })
  const dependenciesQuery = useQuery({
    queryKey: ['task-dependencies', task?.id],
    enabled: Boolean(task),
    queryFn: async () => unwrap(await window.youtrace.planning.listTaskDependencies(task!.id))
  })
  const recurrenceQuery = useQuery({
    queryKey: ['task-recurrence', task?.id],
    enabled: Boolean(task),
    queryFn: async () => unwrap(await window.youtrace.planning.getTaskRecurrence(task!.id))
  })
  useEffect(() => {
    const recurrence = recurrenceQuery.data
    if (!recurrence) return
    setFrequency(recurrence.frequency)
    setIntervalValue(recurrence.intervalValue.toString())
    setNextOccurrence(recurrence.nextOccurrence)
  }, [recurrenceQuery.data])
  useEffect(() => {
    setChecklistEnabled(task?.checklistProgressEnabled ?? false)
  }, [task])
  const refresh = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['task-checklist'] }),
      queryClient.invalidateQueries({ queryKey: ['task-dependencies'] }),
      queryClient.invalidateQueries({ queryKey: ['task-recurrence'] })
    ])
    await onChanged()
  }
  const quickUpdate = async (input: Parameters<typeof window.youtrace.planning.updateTask>[0]): Promise<void> => {
    const result = await window.youtrace.planning.updateTask(input)
    if (!result.ok) return setError(result.error.message)
    await refresh()
  }
  return <Dialog.Root open={task !== null} onOpenChange={onOpenChange}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="dialog-content task-inspector"><div className="dialog-heading"><div><span className="section-label">任务结构与快速操作</span><Dialog.Title>{task?.title}</Dialog.Title><Dialog.Description>子任务是独立对象；检查项是否参与进度由你明确选择。</Dialog.Description></div><Dialog.Close className="dialog-close" aria-label="关闭"><X size={18} /></Dialog.Close></div>{task && <div className="task-inspector-body"><section><header><ListPlus size={15} /><strong>检查清单</strong><small>{checklistEnabled ? '检查项参与进度' : '默认不参与进度'}</small></header><label className="checklist-progress-mode"><input type="checkbox" checked={checklistEnabled} onChange={async (event) => { setChecklistEnabled(event.target.checked); await window.youtrace.planning.setChecklistProgress({ taskId: task.id, enabled: event.target.checked }); await refresh() }} />使用检查清单计算这个任务的进度</label><div className="checklist-items">{(checklistQuery.data ?? []).map((item) => <label key={item.id}><input type="checkbox" checked={item.checked} onChange={async (event) => { await window.youtrace.planning.updateChecklistItem({ id: item.id, checked: event.target.checked }); await refresh() }} /><span>{item.text}</span><button type="button" aria-label={`删除检查项：${item.text}`} onClick={async () => { await window.youtrace.planning.deleteChecklistItem(item.id); await refresh() }}><X size={11} /></button></label>)}</div><div className="inline-create"><input aria-label="检查项内容" value={checkText} onChange={(event) => setCheckText(event.target.value)} /><button type="button" disabled={!checkText.trim()} onClick={async () => { await window.youtrace.planning.createChecklistItem({ taskId: task.id, text: checkText }); setCheckText(''); await refresh() }}><Plus size={12} />添加</button></div></section><section><header><Link2 size={15} /><strong>前置依赖</strong><small>未完成的前置项会显示阻塞来源</small></header><div className="dependency-list">{(dependenciesQuery.data ?? []).map((dependency) => <span key={dependency.prerequisiteTaskId}>{dependency.prerequisiteTitle}<em>{taskStatusLabels[dependency.prerequisiteStatus]}</em></span>)}</div><div className="form-row"><select aria-label="选择前置任务" value={dependencyId} onChange={(event) => setDependencyId(event.target.value)}><option value="">选择前置任务</option>{tasks.filter((candidate) => candidate.id !== task.id).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.title}</option>)}</select><input aria-label="覆盖原因" value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} placeholder="强制越过时的原因" /></div><button className="text-action" disabled={!dependencyId} onClick={async () => { const result = await window.youtrace.planning.addTaskDependency({ taskId: task.id, prerequisiteTaskId: dependencyId, overrideReason: overrideReason || null }); if (!result.ok) return setError(result.error.message); setDependencyId(''); setOverrideReason(''); await refresh() }}><Plus size={12} />添加依赖</button></section><section><header><Repeat2 size={15} /><strong>周期实例</strong><small>完成后生成独立的新实例，历史不变</small></header><div className="form-row form-row-three"><select aria-label="周期频率" value={frequency} onChange={(event) => setFrequency(event.target.value as typeof frequency)}><option value="daily">每日</option><option value="weekly">每周</option><option value="monthly">每月</option><option value="weekdays">工作日</option><option value="interval">自定义间隔</option></select><input aria-label="周期间隔" type="number" min="1" value={intervalValue} onChange={(event) => setIntervalValue(event.target.value)} /><input aria-label="下次发生日期" type="date" value={nextOccurrence} onChange={(event) => setNextOccurrence(event.target.value)} /></div><div className="inspector-actions"><button className="button button-secondary" onClick={async () => { await window.youtrace.planning.setTaskRecurrence({ taskId: task.id, rule: null }); setNextOccurrence(''); await refresh() }}>取消周期</button><button className="button button-secondary" disabled={!nextOccurrence} onClick={async () => { const result = await window.youtrace.planning.setTaskRecurrence({ taskId: task.id, rule: { frequency, intervalValue: Number(intervalValue), weekdays: frequency === 'weekdays' ? [1, 2, 3, 4, 5] : [], nextOccurrence } }); if (!result.ok) return setError(result.error.message); await refresh() }}><Repeat2 size={12} />保存周期</button></div></section><section className="task-quick-actions"><button onClick={() => void quickUpdate({ id: task.id, status: 'blocked' })}>标为阻塞</button><button onClick={() => void quickUpdate({ id: task.id, startDate: addLocalDays(1) })}>转明日</button><button onClick={() => void quickUpdate({ id: task.id, dueAt: task.dueAt ? new Date(Date.parse(task.dueAt) + 86_400_000).toISOString() : new Date(Date.now() + 86_400_000).toISOString() })}>延期一天</button><button onClick={() => void quickUpdate({ id: task.id, includeInProgress: !task.includeInProgress })}>{task.includeInProgress ? '设为仅参考' : '纳入进度'}</button></section>{error && <div className="inline-error">{error}</div>}</div>}</Dialog.Content></Dialog.Portal></Dialog.Root>
}

function addLocalDays(amount: number): string {
  const date = new Date()
  date.setDate(date.getDate() + amount)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 10)
}

function measureLabel(value: Goal['measureType']): string {
  return { milestone: '里程碑', metric: '指标', workload: '工作量', manual: '人工确认' }[value]
}
