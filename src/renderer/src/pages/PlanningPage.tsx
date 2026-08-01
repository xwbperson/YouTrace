import * as Dialog from '@radix-ui/react-dialog'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  BookOpen,
  CalendarClock,
  Check,
  ChevronRight,
  Circle,
  Archive,
  ArchiveRestore,
  Flag,
  Gauge,
  History,
  Link2,
  Layers3,
  ListChecks,
  ListPlus,
  Pencil,
  Plus,
  Repeat2,
  Tag,
  Target,
  Trash2,
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
  ProjectHistoryEntry,
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
  const [editingProject, setEditingProject] = useState<Project | null>(null)
  const [taskDialogOpen, setTaskDialogOpen] = useState(false)
  const [editingTask, setEditingTask] = useState<Task | null>(null)
  const [milestoneDialogOpen, setMilestoneDialogOpen] = useState(false)
  const [editingMilestone, setEditingMilestone] = useState<Milestone | null>(null)
  const [goalDialogOpen, setGoalDialogOpen] = useState(false)
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null)
  const [areaDialogOpen, setAreaDialogOpen] = useState(false)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [projectActionError, setProjectActionError] = useState('')

  const projectsQuery = useQuery({
    queryKey: ['projects', showArchived],
    queryFn: async () => unwrap(await window.youtrace.planning.listProjects(showArchived))
  })
  const areasQuery = useQuery({
    queryKey: ['areas'],
    queryFn: async () => unwrap(await window.youtrace.planning.listAreas(true))
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
  const historyQuery = useQuery({
    queryKey: ['project-history', selectedProjectId],
    enabled: selectedProjectId !== null,
    queryFn: async () =>
      unwrap(await window.youtrace.planning.listProjectHistory(selectedProjectId!))
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

  const openCreateProjectDialog = (): void => {
    setEditingProject(null)
    setProjectDialogOpen(true)
  }

  const openEditProjectDialog = (): void => {
    if (!selectedProject) return
    setEditingProject(selectedProject)
    setProjectDialogOpen(true)
  }

  const changeProjectDialogOpen = (open: boolean): void => {
    setProjectDialogOpen(open)
    if (!open) setEditingProject(null)
  }

  const openCreateTaskDialog = (): void => {
    setEditingTask(null)
    setTaskDialogOpen(true)
  }

  const changeTaskDialogOpen = (open: boolean): void => {
    setTaskDialogOpen(open)
    if (!open) setEditingTask(null)
  }

  const openCreateMilestoneDialog = (): void => {
    setEditingMilestone(null)
    setMilestoneDialogOpen(true)
  }

  const changeMilestoneDialogOpen = (open: boolean): void => {
    setMilestoneDialogOpen(open)
    if (!open) setEditingMilestone(null)
  }

  const openCreateGoalDialog = (): void => {
    setEditingGoal(null)
    setGoalDialogOpen(true)
  }

  const changeGoalDialogOpen = (open: boolean): void => {
    setGoalDialogOpen(open)
    if (!open) setEditingGoal(null)
  }

  const updateTask = useMutation({
    mutationFn: async (input: { id: string; status: Task['status'] }) =>
      unwrap(await window.youtrace.planning.updateTask(input)),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['tasks'] }),
        queryClient.invalidateQueries({ queryKey: ['projects'] }),
        queryClient.invalidateQueries({ queryKey: ['project-history'] })
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
          <button className="button button-secondary" type="button" onClick={openCreateProjectDialog}>
            <Layers3 size={16} />
            新建项目
          </button>
          <button
            className="button button-primary"
            type="button"
            disabled={!selectedProject}
            onClick={openCreateTaskDialog}
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
              <button className="button button-secondary" onClick={openCreateProjectDialog}>
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
                    <span className="project-status-badge">{projectStatusLabels[selectedProject.status]}</span>
                    <select
                      className="project-progress-mode"
                      aria-label="主进度模式"
                      value={selectedProject.progressMode}
                      onChange={async (event) => {
                        setProjectActionError('')
                        const result = await window.youtrace.planning.updateProject({
                          id: selectedProject.id,
                          progressMode: event.target.value as Project['progressMode']
                        })
                        if (result.ok) {
                          await Promise.all([
                            queryClient.invalidateQueries({ queryKey: ['projects'] }),
                            queryClient.invalidateQueries({ queryKey: ['project-history'] })
                          ])
                        } else {
                          setProjectActionError(result.error.message)
                        }
                      }}
                    >
                      <option value="equal">等权进度</option>
                      <option value="workload">工作量进度</option>
                    </select>
                    <button
                      type="button"
                      className="project-edit-action"
                      onClick={openEditProjectDialog}
                    >
                      <Pencil size={14} />
                      编辑项目
                    </button>
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
                      const result = selectedProject.status === 'archived'
                        ? await window.youtrace.planning.trashProject(selectedProject.id)
                        : await window.youtrace.planning.updateProject({
                            id: selectedProject.id,
                            status: 'archived'
                          })
                      if (!result.ok) {
                        setProjectActionError(result.error.message)
                        return
                      }
                      await queryClient.invalidateQueries({ queryKey: ['projects'] })
                    }}
                  >
                    {selectedProject.status === 'archived' ? <Trash2 size={12} /> : <Archive size={12} />}
                    {selectedProject.status === 'archived' ? '移至回收站' : '归档项目'}
                  </button>
                  {selectedProject.status === 'archived' ? (
                    <button
                      type="button"
                      className="project-archive-action"
                      onClick={async () => {
                        const result = await window.youtrace.planning.updateProject({ id: selectedProject.id, status: 'active' })
                        if (!result.ok) return setProjectActionError(result.error.message)
                        await queryClient.invalidateQueries({ queryKey: ['projects'] })
                      }}
                    >
                      <ArchiveRestore size={12} />取消归档
                    </button>
                  ) : null}
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

              {milestones.length === 0 && tasks.length === 0 ? (
                <section className="project-structure-guide" aria-labelledby="project-structure-title">
                  <span className="project-structure-icon" aria-hidden="true">
                    <BookOpen size={19} />
                  </span>
                  <div>
                    <span className="section-label">建议下一步</span>
                    <h3 id="project-structure-title">先按章节搭骨架，再添加每章实际需要的阶段</h3>
                    <p>
                      把每个章节建成里程碑；预习、听课、复习、习题或测试建成任务并关联章节。每章需要哪些阶段都可以不同。
                    </p>
                  </div>
                   <button className="button button-secondary" type="button" onClick={openCreateMilestoneDialog}>
                    <Plus size={15} />
                    添加第一章
                  </button>
                </section>
              ) : null}

              <section className="goal-section">
                <div className="task-section-heading">
                  <div><span className="section-label">成功标准与衡量方式</span><h3>目标</h3></div>
                   <button className="text-action" type="button" onClick={openCreateGoalDialog}><Plus size={14} />添加目标</button>
                </div>
                {goals.length === 0 ? (
                   <button className="goal-empty" type="button" onClick={openCreateGoalDialog}><Target size={16} /><span><strong>定义可验证的目标</strong><small>目标可以使用里程碑、指标、工作量或人工确认衡量。</small></span></button>
                ) : (
                  <div className="goal-strip">
                    {goals.map((goal) => <article key={goal.id}><Target size={14} /><div><strong>{goal.title}</strong><span>{goal.successCriteria || '未填写成功标准'}</span></div><small>{measureLabel(goal.measureType)} · {goal.targetDate ?? '未设日期'}</small><div className="entity-card-actions"><button type="button" aria-label={`编辑目标：${goal.title}`} onClick={() => { setEditingGoal(goal); setGoalDialogOpen(true) }}><Pencil size={13} /></button><button type="button" aria-label={`删除目标：${goal.title}`} onClick={async () => { const result = await window.youtrace.planning.trashGoal(goal.id); if (!result.ok) return setProjectActionError(result.error.message); await Promise.all([queryClient.invalidateQueries({ queryKey: ['goals'] }), queryClient.invalidateQueries({ queryKey: ['milestones'] }), queryClient.invalidateQueries({ queryKey: ['tasks'] })]) }}><Trash2 size={13} /></button></div></article>)}
                  </div>
                )}
              </section>

              <section className="milestone-section">
                <div className="task-section-heading">
                  <div>
                    <span className="section-label">阶段结果</span>
                    <h3>里程碑</h3>
                  </div>
                   <button className="text-action" type="button" onClick={openCreateMilestoneDialog}>
                    <Plus size={14} />
                    添加里程碑
                  </button>
                </div>
                {milestones.length === 0 ? (
                   <button className="milestone-empty" type="button" onClick={openCreateMilestoneDialog}>
                    <span className="trace-node current" />
                    <span>
                      <strong>先添加第一章（章节作为里程碑）</strong>
                      <small>以后每新增一章，就新增一个里程碑。</small>
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
                        <div className="entity-card-actions"><button type="button" aria-label={`编辑里程碑：${milestone.title}`} onClick={() => { setEditingMilestone(milestone); setMilestoneDialogOpen(true) }}><Pencil size={13} /></button><button type="button" aria-label={`删除里程碑：${milestone.title}`} onClick={async () => { const result = await window.youtrace.planning.trashMilestone(milestone.id); if (!result.ok) return setProjectActionError(result.error.message); await Promise.all([queryClient.invalidateQueries({ queryKey: ['milestones'] }), queryClient.invalidateQueries({ queryKey: ['tasks'] }), queryClient.invalidateQueries({ queryKey: ['projects'] })]) }}><Trash2 size={13} /></button></div>
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
                   <button className="text-action" type="button" onClick={openCreateTaskDialog}>
                    <Plus size={14} />
                    添加任务
                  </button>
                </div>

                {tasksQuery.isPending ? (
                  <p className="rail-message">正在读取任务…</p>
                ) : tasks.length === 0 ? (
                  <button
                    className="task-empty"
                    type="button"
                    onClick={() => milestones.length === 0 ? openCreateMilestoneDialog() : openCreateTaskDialog()}
                  >
                    <Plus size={18} />
                    <span>
                      <strong>{milestones.length === 0 ? '先建立章节里程碑' : '为章节添加实际需要的阶段'}</strong>
                      <small>
                        {milestones.length === 0
                          ? '章节建好后，再把预习、复习、习题等任务关联到对应章节。'
                          : '预习、复习、习题或测试都可以作为任务，不要求每章相同。'}
                      </small>
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

              <section className="project-history-section" data-testid="project-history">
                <div className="task-section-heading">
                  <div>
                    <span className="section-label">永久记录</span>
                    <h3>项目历史</h3>
                  </div>
                  {historyQuery.data ? (
                    <div className="project-history-summary" aria-label="项目投入汇总">
                      <span>{historyQuery.data.effortCount} 次投入</span>
                      <span>累计 {historyQuery.data.totalMinutes} 分钟</span>
                      {historyQuery.data.hasMore ? (
                        <span>
                          最近 {historyQuery.data.entries.length} / 共{' '}
                          {historyQuery.data.effortCount + historyQuery.data.changeCount} 条
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                {historyQuery.isPending ? (
                  <p className="project-history-message" role="status">正在读取项目历史…</p>
                ) : historyQuery.isError ? (
                  <p className="project-history-message error" role="alert">项目历史暂时无法读取，请稍后重试。</p>
                ) : !historyQuery.data || historyQuery.data.entries.length === 0 ? (
                  <div className="project-history-empty">
                    <History size={18} />
                    <span>
                      <strong>还没有项目活动</strong>
                      <small>任务变更和投入记录会按时间出现在这里。</small>
                    </span>
                  </div>
                ) : (
                  <ol className="project-history-list">
                    {historyQuery.data.entries.map((entry) => (
                      <ProjectHistoryItem key={`${entry.kind}-${entry.id}`} entry={entry} />
                    ))}
                  </ol>
                )}
              </section>
            </>
          )}
        </main>
      </div>}

      <ProjectDialog
        open={projectDialogOpen}
        onOpenChange={changeProjectDialogOpen}
        areas={areasQuery.data ?? []}
        project={editingProject}
        onSaved={async (project) => {
          setSelectedProjectId(project.id)
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['projects'] }),
            queryClient.invalidateQueries({ queryKey: ['project-history'] })
          ])
        }}
      />
      <TaskDialog
        open={taskDialogOpen}
        onOpenChange={changeTaskDialogOpen}
        project={selectedProject}
        task={editingTask}
        tags={tagsQuery.data ?? []}
        milestones={milestones}
        goals={goals}
        tasks={tasks}
        onSaved={async () => {
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['tasks'] }),
            queryClient.invalidateQueries({ queryKey: ['projects'] }),
            queryClient.invalidateQueries({ queryKey: ['project-history'] })
          ])
        }}
      />
      <MilestoneDialog
        open={milestoneDialogOpen}
        onOpenChange={changeMilestoneDialogOpen}
        project={selectedProject}
        milestone={editingMilestone}
        goals={goals}
        onSaved={async () => {
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['milestones'] }),
            queryClient.invalidateQueries({ queryKey: ['projects'] }),
            queryClient.invalidateQueries({ queryKey: ['project-history'] })
          ])
        }}
      />
      <GoalDialog
        open={goalDialogOpen}
        onOpenChange={changeGoalDialogOpen}
        project={selectedProject}
        goal={editingGoal}
        onSaved={async () => {
          await queryClient.invalidateQueries({ queryKey: ['goals'] })
          await queryClient.invalidateQueries({ queryKey: ['project-history'] })
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
        onEdit={(task) => {
          setSelectedTask(null)
          setEditingTask(task)
          setTaskDialogOpen(true)
        }}
        onTrash={async (task) => {
          const result = await window.youtrace.planning.trashTask(task.id)
          if (!result.ok) return setProjectActionError(result.error.message)
          setSelectedTask(null)
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['tasks'] }),
            queryClient.invalidateQueries({ queryKey: ['projects'] }),
            queryClient.invalidateQueries({ queryKey: ['project-history'] })
          ])
        }}
        onChanged={async () => {
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['tasks'] }),
            queryClient.invalidateQueries({ queryKey: ['projects'] }),
            queryClient.invalidateQueries({ queryKey: ['project-history'] })
          ])
        }}
      />
      {projectActionError ? (
        <div className="data-feedback error" role="alert">
          {projectActionError}
          <button type="button" aria-label="关闭提示" onClick={() => setProjectActionError('')}>
            <X size={13} />
          </button>
        </div>
      ) : null}
    </div>
  )
}

function ProjectHistoryItem({ entry }: { entry: ProjectHistoryEntry }): React.JSX.Element {
  return (
    <li className={entry.kind === 'effort' ? 'effort' : 'change'}>
      <span className="project-history-marker">
        {entry.kind === 'effort' ? <Gauge size={14} /> : <History size={14} />}
      </span>
      <div className="project-history-copy">
        <strong>{entry.title}</strong>
        <span>{entry.summary}</span>
      </div>
      <div className="project-history-meta">
        {entry.minutes !== null ? <b>投入 {entry.minutes}m</b> : <b>{historyActionLabel(entry.action)}</b>}
        <time dateTime={entry.occurredAt}>{formatHistoryTime(entry.occurredAt)}</time>
      </div>
    </li>
  )
}

function historyActionLabel(action: string): string {
  return (
    {
      created: '创建',
      updated: '更新',
      trashed: '回收站',
      restored: '已恢复',
      corrected: '已更正',
      dependency_overridden: '强制开始'
    }[action] ?? action.replaceAll('_', ' ')
  )
}

function formatHistoryTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value))
}

interface ProjectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  areas: Area[]
  project: Project | null
  onSaved: (project: Project) => Promise<void>
}

function ProjectDialog({ open, onOpenChange, areas, project, onSaved }: ProjectDialogProps): React.JSX.Element {
  const [name, setName] = useState('')
  const [areaId, setAreaId] = useState('')
  const [description, setDescription] = useState('')
  const [successCriteria, setSuccessCriteria] = useState('')
  const [status, setStatus] = useState<Project['status']>('active')
  const [startDate, setStartDate] = useState('')
  const [targetDate, setTargetDate] = useState('')
  const [progressMode, setProgressMode] = useState<Project['progressMode']>('equal')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setName(project?.name ?? '')
    setAreaId(project?.areaId ?? '')
    setDescription(project?.description ?? '')
    setSuccessCriteria(project?.successCriteria ?? '')
    setStatus(project?.status ?? 'active')
    setStartDate(project?.startDate ?? new Date().toISOString().slice(0, 10))
    setTargetDate(project?.targetDate ?? '')
    setProgressMode(project?.progressMode ?? 'equal')
    setError('')
    setBusy(false)
  }, [open, project])

  const submit = async (): Promise<void> => {
    setBusy(true)
    setError('')
    const result = project
      ? await window.youtrace.planning.updateProject({
          id: project.id,
          areaId: areaId || null,
          name,
          description,
          successCriteria,
          status,
          startDate: startDate || null,
          targetDate: targetDate || null,
          progressMode
        })
      : await window.youtrace.planning.createProject({
          areaId: areaId || null,
          name,
          description,
          status,
          startDate: startDate || null,
          targetDate: targetDate || null,
          successCriteria,
          progressMode
        } satisfies CreateProjectInput)
    setBusy(false)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    await onSaved(result.data)
    onOpenChange(false)
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content">
          <div className="dialog-heading">
            <div>
              <span className="section-label">{project ? '更新项目范围' : '定义一个结果容器'}</span>
              <Dialog.Title>{project ? '编辑项目' : '新建项目'}</Dialog.Title>
              <Dialog.Description>
                {project ? '修改名称、说明、目标日期、所属领域或进度方式。' : '项目承载成功标准、里程碑、任务和真实投入。'}
              </Dialog.Description>
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
                {areas.filter((area) => !area.archived || area.id === project?.areaId).map((area) => <option key={area.id} value={area.id}>{area.name}{area.archived ? '（已归档）' : ''}</option>)}
              </select>
            </label>
            <label>
              <span>项目说明</span>
              <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="这段工作为什么重要？" />
            </label>
            <label><span>成功标准</span><textarea value={successCriteria} onChange={(event) => setSuccessCriteria(event.target.value)} placeholder="达到什么结果才算项目完成？" /></label>
            <div className="form-row form-row-three">
              <label>
                <span>状态</span>
                <select value={status} onChange={(event) => setStatus(event.target.value as Project['status'])}>
                  {Object.entries(projectStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label>
                <span>开始日期</span>
                <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
              </label>
              <label>
                <span>目标日期</span>
                <input type="date" value={targetDate} onChange={(event) => setTargetDate(event.target.value)} />
              </label>
            </div>
            <div className="form-row">
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
              {busy ? (project ? '正在保存…' : '正在创建…') : (project ? '保存修改' : '创建项目')}
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
  task: Task | null
  tags: Array<{ id: string; name: string; color: string | null }>
  milestones: Milestone[]
  goals: Goal[]
  tasks: Task[]
  onSaved: () => Promise<void>
}

function TaskDialog({ open, onOpenChange, project, task, tags, milestones, goals, tasks, onSaved }: TaskDialogProps): React.JSX.Element {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState<Task['status']>('ready')
  const [difficulty, setDifficulty] = useState('')
  const [priority, setPriority] = useState<Task['priority']>('medium')
  const [estimatedMinutes, setEstimatedMinutes] = useState('')
  const [progressWeight, setProgressWeight] = useState('')
  const [startDate, setStartDate] = useState('')
  const [dueAt, setDueAt] = useState('')
  const [verificationCriteria, setVerificationCriteria] = useState('')
  const [includeInProgress, setIncludeInProgress] = useState(true)
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([])
  const [milestoneId, setMilestoneId] = useState('')
  const [goalId, setGoalId] = useState('')
  const [parentTaskId, setParentTaskId] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const projectName = useMemo(() => project?.name ?? '', [project])

  useEffect(() => {
    if (!open) return
    setTitle(task?.title ?? '')
    setDescription(task?.description ?? '')
    setStatus(task?.status ?? 'ready')
    setDifficulty(task?.difficulty?.toString() ?? '')
    setPriority(task?.priority ?? 'medium')
    setEstimatedMinutes(task?.estimatedMinutes?.toString() ?? '')
    setProgressWeight(task?.progressWeight?.toString() ?? '')
    setStartDate(task?.startDate ?? '')
    setDueAt(task?.dueAt ? toDateTimeLocal(task.dueAt) : '')
    setVerificationCriteria(task?.verificationCriteria ?? '')
    setIncludeInProgress(task?.includeInProgress ?? true)
    setSelectedTagIds(task?.tagIds ?? [])
    setMilestoneId(task?.milestoneId ?? '')
    setGoalId(task?.goalId ?? '')
    setParentTaskId(task?.parentTaskId ?? '')
    setError('')
    setBusy(false)
  }, [open, task])

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
      description,
      status,
      difficulty: difficulty ? Number(difficulty) : null,
      priority,
      estimatedMinutes: estimatedMinutes ? Number(estimatedMinutes) : null,
      progressWeight: progressWeight ? Number(progressWeight) : null,
      startDate: startDate || null,
      dueAt: dueAt ? new Date(dueAt).toISOString() : null,
      verificationCriteria,
      includeInProgress,
      tagIds: selectedTagIds
    }
    const result = task
      ? await window.youtrace.planning.updateTask({ id: task.id, ...input })
      : await window.youtrace.planning.createTask(input)
    setBusy(false)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    await onSaved()
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
              <Dialog.Title>{task ? '编辑任务' : '新建任务'}</Dialog.Title>
              <Dialog.Description>{task ? '修改任务内容、归属、时间和完成标准。' : '写成一个可以直接开始、可以明确完成的动作。'}</Dialog.Description>
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
            <label>
              <span>任务说明</span>
              <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="补充范围、资料或注意事项" />
            </label>
            <div className="form-row form-row-three">
              <label>
                <span>状态</span>
                <select value={status} onChange={(event) => setStatus(event.target.value as Task['status'])}>
                  {Object.entries(taskStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
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
            </div>
            <div className="form-row form-row-three">
              <label><span>预计分钟</span><input type="number" min="1" value={estimatedMinutes} onChange={(event) => setEstimatedMinutes(event.target.value)} /></label>
              <label><span>进度权重</span><input type="number" min="0.01" step="0.01" value={progressWeight} onChange={(event) => setProgressWeight(event.target.value)} /></label>
              <label><span>开始日期</span><input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
            </div>
            <label><span>截止时间</span><input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} /></label>
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
                  {tasks.filter((candidate) => candidate.id !== task?.id && candidate.status !== 'completed' && candidate.status !== 'cancelled').map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.title}</option>)}
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
            <label><span>完成验证标准</span><textarea value={verificationCriteria} onChange={(event) => setVerificationCriteria(event.target.value)} placeholder="什么事实能证明任务已经完成？" /></label>
            <label className="checklist-progress-mode"><input type="checkbox" checked={includeInProgress} onChange={(event) => setIncludeInProgress(event.target.checked)} />纳入项目进度</label>
            {error && <div className="inline-error">{error}</div>}
          </div>
          <div className="dialog-actions">
            <Dialog.Close className="button button-secondary">取消</Dialog.Close>
            <button className="button button-primary" disabled={!title.trim() || busy || !project} onClick={() => void submit()}>
              {busy ? '正在保存…' : task ? '保存修改' : '创建任务'}
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
  milestone: Milestone | null
  goals: Goal[]
  onSaved: () => Promise<void>
}

function MilestoneDialog({
  open,
  onOpenChange,
  project,
  milestone,
  goals,
  onSaved
}: MilestoneDialogProps): React.JSX.Element {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [plannedDate, setPlannedDate] = useState('')
  const [estimatedMinutes, setEstimatedMinutes] = useState('')
  const [manualWeight, setManualWeight] = useState('')
  const [mastery, setMastery] = useState('')
  const [verificationCriteria, setVerificationCriteria] = useState('')
  const [goalId, setGoalId] = useState('')
  const [status, setStatus] = useState<Milestone['status']>('not_started')
  const [includeInProgress, setIncludeInProgress] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setTitle(milestone?.title ?? '')
    setDescription(milestone?.description ?? '')
    setPlannedDate(milestone?.plannedDate ?? '')
    setEstimatedMinutes(milestone?.estimatedMinutes?.toString() ?? '')
    setManualWeight(milestone?.manualWeight?.toString() ?? '')
    setMastery(milestone?.mastery?.toString() ?? '')
    setVerificationCriteria(milestone?.verificationCriteria ?? '')
    setGoalId(milestone?.goalId ?? '')
    setStatus(milestone?.status ?? 'not_started')
    setIncludeInProgress(milestone?.includeInProgress ?? true)
    setError('')
    setBusy(false)
  }, [open, milestone])

  const submit = async (): Promise<void> => {
    if (!project) return
    setBusy(true)
    setError('')
    const input = {
      projectId: project.id,
      goalId: goalId || null,
      title,
      description,
      plannedDate: plannedDate || null,
      estimatedMinutes: estimatedMinutes ? Number(estimatedMinutes) : null,
      manualWeight: manualWeight ? Number(manualWeight) : null,
      mastery: mastery ? Number(mastery) : null,
      verificationCriteria,
      status,
      includeInProgress
    }
    const result = milestone
      ? await window.youtrace.planning.updateMilestone({ id: milestone.id, ...input })
      : await window.youtrace.planning.createMilestone(input)
    setBusy(false)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    await onSaved()
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
              <Dialog.Title>{milestone ? '编辑里程碑' : '新建里程碑'}</Dialog.Title>
              <Dialog.Description>{milestone ? '修改章节或阶段结果的范围、日期与验证方式。' : '里程碑是一项阶段性、可以验证的结果。'}</Dialog.Description>
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
            <label><span>说明</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} /></label>
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
            <div className="form-row">
              <label><span>状态</span><select value={status} onChange={(event) => setStatus(event.target.value as Milestone['status'])}><option value="not_started">未开始</option><option value="in_progress">进行中</option><option value="completed">已完成</option><option value="verified">已验证</option><option value="accepted">已认可</option><option value="paused">暂停</option><option value="cancelled">已取消</option></select></label>
              <label><span>掌握度</span><input type="number" min="0" max="100" value={mastery} onChange={(event) => setMastery(event.target.value)} /></label>
            </div>
            <label>
              <span>验证标准</span>
              <textarea value={verificationCriteria} onChange={(event) => setVerificationCriteria(event.target.value)} placeholder="什么事实可以证明这个阶段已经完成？" />
            </label>
            <label className="checklist-progress-mode"><input type="checkbox" checked={includeInProgress} onChange={(event) => setIncludeInProgress(event.target.checked)} />纳入项目进度</label>
            {error && <div className="inline-error">{error}</div>}
          </div>
          <div className="dialog-actions">
            <Dialog.Close className="button button-secondary">取消</Dialog.Close>
            <button className="button button-primary" disabled={!title.trim() || busy || !project} onClick={() => void submit()}>
              {busy ? '正在保存…' : milestone ? '保存修改' : '创建里程碑'}
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
  goal,
  onSaved
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  project: Project | null
  goal: Goal | null
  onSaved: () => Promise<void>
}): React.JSX.Element {
  const [title, setTitle] = useState('')
  const [successCriteria, setSuccessCriteria] = useState('')
  const [targetDate, setTargetDate] = useState('')
  const [measureType, setMeasureType] = useState<Goal['measureType']>('milestone')
  const [status, setStatus] = useState<Goal['status']>('active')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setTitle(goal?.title ?? '')
    setSuccessCriteria(goal?.successCriteria ?? '')
    setTargetDate(goal?.targetDate ?? '')
    setMeasureType(goal?.measureType ?? 'milestone')
    setStatus(goal?.status ?? 'active')
    setError('')
    setBusy(false)
  }, [open, goal])

  const submit = async (): Promise<void> => {
    if (!project) return
    setBusy(true)
    const input = {
      projectId: project.id,
      title,
      successCriteria,
      targetDate: targetDate || null,
      measureType,
      status
    }
    const result = goal
      ? await window.youtrace.planning.updateGoal({ id: goal.id, ...input })
      : await window.youtrace.planning.createGoal(input)
    setBusy(false)
    if (!result.ok) return setError(result.error.message)
    await onSaved()
    onOpenChange(false)
  }
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content">
          <div className="dialog-heading">
            <div>
              <span className="section-label">{project?.name ?? '独立目标'}</span>
              <Dialog.Title>{goal ? '编辑目标' : '新建目标'}</Dialog.Title>
              <Dialog.Description>{goal ? '修改目标、成功标准、日期与衡量方式。' : '先定义什么结果算成功，再选择衡量方式。'}</Dialog.Description>
            </div>
            <Dialog.Close className="dialog-close" aria-label="关闭"><X size={18} /></Dialog.Close>
          </div>
          <div className="dialog-form">
            <label><span>目标名称</span><input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} /></label>
            <label><span>成功标准</span><textarea value={successCriteria} onChange={(event) => setSuccessCriteria(event.target.value)} /></label>
            <div className="form-row form-row-three">
              <label><span>目标日期</span><input type="date" value={targetDate} onChange={(event) => setTargetDate(event.target.value)} /></label>
              <label><span>衡量方式</span><select value={measureType} onChange={(event) => setMeasureType(event.target.value as Goal['measureType'])}><option value="milestone">里程碑完成度</option><option value="metric">数值指标</option><option value="workload">累计工作量</option><option value="manual">人工确认</option></select></label>
              <label><span>状态</span><select value={status} onChange={(event) => setStatus(event.target.value as Goal['status'])}><option value="planned">计划中</option><option value="active">进行中</option><option value="paused">暂停</option><option value="completed">已完成</option><option value="cancelled">已取消</option></select></label>
            </div>
            {error && <div className="inline-error">{error}</div>}
          </div>
          <div className="dialog-actions">
            <Dialog.Close className="button button-secondary">取消</Dialog.Close>
            <button className="button button-primary" disabled={!title.trim() || !project || busy} onClick={() => void submit()}>{busy ? '正在保存…' : goal ? '保存修改' : '创建目标'}</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
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
  const [editingArea, setEditingArea] = useState<Area | null>(null)

  const resetForm = (): void => {
    setEditingArea(null)
    setName('')
    setDescription('')
    setColor('#216E65')
    setError('')
  }

  const edit = (area: Area): void => {
    setEditingArea(area)
    setName(area.name)
    setDescription(area.description)
    setColor(area.color ?? '#216E65')
    setError('')
  }

  const save = async (): Promise<void> => {
    const input = { name, description, color, icon: editingArea?.icon ?? null }
    const result = editingArea
      ? await window.youtrace.planning.updateArea({ id: editingArea.id, ...input })
      : await window.youtrace.planning.createArea(input)
    if (!result.ok) return setError(result.error.message)
    resetForm()
    await onChanged()
  }
  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => { if (!nextOpen) resetForm(); onOpenChange(nextOpen) }}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content area-dialog">
          <div className="dialog-heading"><div><span className="section-label">长期责任分类</span><Dialog.Title>领域</Dialog.Title><Dialog.Description>可修改名称和说明；归档后可恢复或移入回收站。</Dialog.Description></div><Dialog.Close className="dialog-close" aria-label="关闭"><X size={18} /></Dialog.Close></div>
          <div className="area-list">
            {areas.map((area) => (
              <article key={area.id} className={area.archived ? 'archived' : ''}>
                <span style={{ background: area.color ?? '#216E65' }} />
                <div><strong>{area.name}{area.archived ? ' · 已归档' : ''}</strong><small>{area.description || '没有说明'}</small></div>
                <div className="area-row-actions">
                  <button type="button" onClick={() => edit(area)}><Pencil size={12} />编辑</button>
                  <button type="button" onClick={async () => { const result = await window.youtrace.planning.updateArea({ id: area.id, archived: !area.archived }); if (!result.ok) return setError(result.error.message); await onChanged() }}>{area.archived ? <ArchiveRestore size={12} /> : <Archive size={12} />}{area.archived ? '恢复' : '归档'}</button>
                  {area.archived ? <button type="button" className="danger" onClick={async () => { const result = await window.youtrace.planning.trashArea(area.id); if (!result.ok) return setError(result.error.message); if (editingArea?.id === area.id) resetForm(); await onChanged() }}><Trash2 size={12} />回收站</button> : null}
                </div>
              </article>
            ))}
          </div>
          <div className="dialog-form">
            <div className="form-row"><label><span>{editingArea ? '领域名称' : '新领域名称'}</span><input value={name} onChange={(event) => setName(event.target.value)} /></label><label><span>颜色</span><input type="color" value={color} onChange={(event) => setColor(event.target.value)} /></label></div>
            <label><span>说明</span><input value={description} onChange={(event) => setDescription(event.target.value)} /></label>
            {error && <div className="inline-error">{error}</div>}
          </div>
          <div className="dialog-actions">
            {editingArea ? <button className="button button-secondary" type="button" onClick={resetForm}>取消编辑</button> : <Dialog.Close className="button button-secondary">完成</Dialog.Close>}
            <button className="button button-primary" disabled={!name.trim()} onClick={() => void save()}>{editingArea ? <Pencil size={14} /> : <Plus size={14} />}{editingArea ? '保存修改' : '添加领域'}</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function TaskInspector({
  task,
  tasks,
  onOpenChange,
  onEdit,
  onTrash,
  onChanged
}: {
  task: Task | null
  tasks: Task[]
  onOpenChange: (open: boolean) => void
  onEdit: (task: Task) => void
  onTrash: (task: Task) => Promise<void>
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
  return <Dialog.Root open={task !== null} onOpenChange={onOpenChange}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="dialog-content task-inspector"><div className="dialog-heading"><div><span className="section-label">任务结构与快速操作</span><Dialog.Title>{task?.title}</Dialog.Title><Dialog.Description>子任务是独立对象；检查项是否参与进度由你明确选择。</Dialog.Description></div><Dialog.Close className="dialog-close" aria-label="关闭"><X size={18} /></Dialog.Close></div>{task && <div className="task-inspector-body"><section><header><ListPlus size={15} /><strong>检查清单</strong><small>{checklistEnabled ? '检查项参与进度' : '默认不参与进度'}</small></header><label className="checklist-progress-mode"><input type="checkbox" checked={checklistEnabled} onChange={async (event) => { setChecklistEnabled(event.target.checked); await window.youtrace.planning.setChecklistProgress({ taskId: task.id, enabled: event.target.checked }); await refresh() }} />使用检查清单计算这个任务的进度</label><div className="checklist-items">{(checklistQuery.data ?? []).map((item) => <label key={item.id}><input type="checkbox" checked={item.checked} onChange={async (event) => { await window.youtrace.planning.updateChecklistItem({ id: item.id, checked: event.target.checked }); await refresh() }} /><input className="checklist-text-input" aria-label={`编辑检查项：${item.text}`} defaultValue={item.text} onBlur={async (event) => { const text = event.target.value.trim(); if (!text || text === item.text) return; await window.youtrace.planning.updateChecklistItem({ id: item.id, text }); await refresh() }} /><button type="button" aria-label={`删除检查项：${item.text}`} onClick={async () => { await window.youtrace.planning.deleteChecklistItem(item.id); await refresh() }}><X size={11} /></button></label>)}</div><div className="inline-create"><input aria-label="检查项内容" value={checkText} onChange={(event) => setCheckText(event.target.value)} /><button type="button" disabled={!checkText.trim()} onClick={async () => { await window.youtrace.planning.createChecklistItem({ taskId: task.id, text: checkText }); setCheckText(''); await refresh() }}><Plus size={12} />添加</button></div></section><section><header><Link2 size={15} /><strong>前置依赖</strong><small>未完成的前置项会显示阻塞来源</small></header><div className="dependency-list">{(dependenciesQuery.data ?? []).map((dependency) => <span key={dependency.prerequisiteTaskId}>{dependency.prerequisiteTitle}<em>{taskStatusLabels[dependency.prerequisiteStatus]}</em></span>)}</div><div className="form-row"><select aria-label="选择前置任务" value={dependencyId} onChange={(event) => setDependencyId(event.target.value)}><option value="">选择前置任务</option>{tasks.filter((candidate) => candidate.id !== task.id).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.title}</option>)}</select><input aria-label="覆盖原因" value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} placeholder="强制越过时的原因" /></div><button className="text-action" disabled={!dependencyId} onClick={async () => { const result = await window.youtrace.planning.addTaskDependency({ taskId: task.id, prerequisiteTaskId: dependencyId, overrideReason: overrideReason || null }); if (!result.ok) return setError(result.error.message); setDependencyId(''); setOverrideReason(''); await refresh() }}><Plus size={12} />添加依赖</button></section><section><header><Repeat2 size={15} /><strong>周期实例</strong><small>完成后生成独立的新实例，历史不变</small></header><div className="form-row form-row-three"><select aria-label="周期频率" value={frequency} onChange={(event) => setFrequency(event.target.value as typeof frequency)}><option value="daily">每日</option><option value="weekly">每周</option><option value="monthly">每月</option><option value="weekdays">工作日</option><option value="interval">自定义间隔</option></select><input aria-label="周期间隔" type="number" min="1" value={intervalValue} onChange={(event) => setIntervalValue(event.target.value)} /><input aria-label="下次发生日期" type="date" value={nextOccurrence} onChange={(event) => setNextOccurrence(event.target.value)} /></div><div className="inspector-actions"><button className="button button-secondary" onClick={async () => { await window.youtrace.planning.setTaskRecurrence({ taskId: task.id, rule: null }); setNextOccurrence(''); await refresh() }}>取消周期</button><button className="button button-secondary" disabled={!nextOccurrence} onClick={async () => { const result = await window.youtrace.planning.setTaskRecurrence({ taskId: task.id, rule: { frequency, intervalValue: Number(intervalValue), weekdays: frequency === 'weekdays' ? [1, 2, 3, 4, 5] : [], nextOccurrence } }); if (!result.ok) return setError(result.error.message); await refresh() }}><Repeat2 size={12} />保存周期</button></div></section><section className="task-quick-actions"><button onClick={() => void quickUpdate({ id: task.id, status: 'blocked' })}>标为阻塞</button><button onClick={() => void quickUpdate({ id: task.id, startDate: addLocalDays(1) })}>转明日</button><button onClick={() => void quickUpdate({ id: task.id, dueAt: task.dueAt ? new Date(Date.parse(task.dueAt) + 86_400_000).toISOString() : new Date(Date.now() + 86_400_000).toISOString() })}>延期一天</button><button onClick={() => void quickUpdate({ id: task.id, includeInProgress: !task.includeInProgress })}>{task.includeInProgress ? '设为仅参考' : '纳入进度'}</button></section><div className="dialog-actions inspector-entity-actions"><button className="button button-secondary" type="button" onClick={() => onEdit(task)}><Pencil size={13} />编辑任务</button><button className="button button-danger" type="button" onClick={() => void onTrash(task)}><Trash2 size={13} />移至回收站</button></div>{error && <div className="inline-error">{error}</div>}</div>}</Dialog.Content></Dialog.Portal></Dialog.Root>
}

function addLocalDays(amount: number): string {
  const date = new Date()
  date.setDate(date.getDate() + amount)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 10)
}

function toDateTimeLocal(value: string): string {
  const date = new Date(value)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

function measureLabel(value: Goal['measureType']): string {
  return { milestone: '里程碑', metric: '指标', workload: '工作量', manual: '人工确认' }[value]
}
