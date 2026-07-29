import * as Dialog from '@radix-ui/react-dialog'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CalendarClock,
  Check,
  ChevronRight,
  Circle,
  Flag,
  Gauge,
  Layers3,
  ListChecks,
  Plus,
  Tag,
  X
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type {
  CreateProjectInput,
  CreateTaskInput,
  IpcResult,
  Project,
  Task
} from '../../../shared/contracts'

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
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [projectDialogOpen, setProjectDialogOpen] = useState(false)
  const [taskDialogOpen, setTaskDialogOpen] = useState(false)

  const projectsQuery = useQuery({
    queryKey: ['projects'],
    queryFn: async () => unwrap(await window.youtrace.planning.listProjects())
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

  const projects = projectsQuery.data ?? []
  useEffect(() => {
    if (!selectedProjectId && projects[0]) setSelectedProjectId(projects[0].id)
    if (selectedProjectId && !projects.some((project) => project.id === selectedProjectId)) {
      setSelectedProjectId(projects[0]?.id ?? null)
    }
  }, [projects, selectedProjectId])

  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null
  const tasks = tasksQuery.data ?? []
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

      <div className="planning-layout">
        <aside className="project-rail panel">
          <div className="rail-heading">
            <span>项目</span>
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
                        <div className="task-copy">
                          <strong>{task.title}</strong>
                          <div>
                            <span>{taskStatusLabels[task.status]}</span>
                            {task.estimatedMinutes && <span>{task.estimatedMinutes} 分钟</span>}
                            {task.difficulty && <span>难度 {task.difficulty}</span>}
                            <span className={`priority priority-${task.priority}`}>
                              <Flag size={11} />
                              {priorityLabels[task.priority]}
                            </span>
                          </div>
                        </div>
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
      </div>

      <ProjectDialog
        open={projectDialogOpen}
        onOpenChange={setProjectDialogOpen}
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
        onCreated={async () => {
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
  onCreated: (project: Project) => Promise<void>
}

function ProjectDialog({ open, onOpenChange, onCreated }: ProjectDialogProps): React.JSX.Element {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [targetDate, setTargetDate] = useState('')
  const [progressMode, setProgressMode] = useState<Project['progressMode']>('equal')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (): Promise<void> => {
    setBusy(true)
    setError('')
    const input: CreateProjectInput = {
      areaId: null,
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
  onCreated: () => Promise<void>
}

function TaskDialog({ open, onOpenChange, project, tags, onCreated }: TaskDialogProps): React.JSX.Element {
  const [title, setTitle] = useState('')
  const [difficulty, setDifficulty] = useState('')
  const [priority, setPriority] = useState<Task['priority']>('medium')
  const [estimatedMinutes, setEstimatedMinutes] = useState('')
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const projectName = useMemo(() => project?.name ?? '', [project])

  const submit = async (): Promise<void> => {
    if (!project) return
    setBusy(true)
    setError('')
    const input: CreateTaskInput = {
      parentTaskId: null,
      projectId: project.id,
      goalId: null,
      milestoneId: null,
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
