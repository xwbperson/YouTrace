import * as Dialog from '@radix-ui/react-dialog'
import {
  AlertTriangle,
  Archive,
  CalendarDays,
  ChevronRight,
  CircleDotDashed,
  ClipboardCheck,
  Clock3,
  FileText,
  Home,
  Inbox,
  LayoutTemplate,
  MoreHorizontal,
  Plus,
  Search,
  Settings,
  Tags,
  TimerReset,
  X
} from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import type { WorkspaceSummary } from '../../../shared/contracts'
import { PlanningPage } from '../pages/PlanningPage'
import { TodayPage } from '../pages/TodayPage'
import { RecordsPage } from '../pages/RecordsPage'
import { MemosPage } from '../pages/MemosPage'
import { TagsPage } from '../pages/TagsPage'
import { GlobalSearch } from './GlobalSearch'
import { CalendarPage } from '../pages/CalendarPage'
import { CountdownSummary } from './CountdownSummary'
import { ReviewsPage } from '../pages/ReviewsPage'
import { TemplatesPage } from '../pages/TemplatesPage'
import { SettingsPage } from '../pages/SettingsPage'
import { DataPage } from '../pages/DataPage'

interface AppShellProps {
  workspace: WorkspaceSummary
  onWorkspaceChange: (workspace: WorkspaceSummary) => void
}

const navigation = [
  { id: 'home', label: '首页', icon: Home },
  { id: 'today', label: '今日', icon: CircleDotDashed },
  { id: 'plan', label: '计划', icon: ClipboardCheck },
  { id: 'calendar', label: '日历', icon: CalendarDays },
  { id: 'records', label: '记录', icon: TimerReset },
  { id: 'memos', label: '备忘', icon: FileText },
  { id: 'reviews', label: '复盘', icon: Archive }
] as const

export function AppShell({ workspace, onWorkspaceChange }: AppShellProps): React.JSX.Element {
  const queryClient = useQueryClient()
  const [active, setActive] = useState<string>('home')
  const [searchOpen, setSearchOpen] = useState(false)
  const [workspacePrompt, setWorkspacePrompt] = useState<{
    kind: 'locked' | 'error'
    rootPath: string | null
    message: string
    recovery: string | null
  } | null>(null)
  const today = useMemo(
    () =>
      new Intl.DateTimeFormat('zh-CN', {
        month: 'long',
        day: 'numeric',
        weekday: 'long'
      }).format(new Date()),
    []
  )
  const preferencesQuery = useQuery({
    queryKey: ['user-preferences'],
    queryFn: async () => {
      const result = await window.youtrace.settings.getPreferences()
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    }
  })
  const dashboardTasksQuery = useQuery({
    queryKey: ['dashboard-tasks'],
    queryFn: async () => {
      const result = await window.youtrace.planning.listTasks({
        projectId: null,
        statuses: ['ready', 'scheduled', 'in_progress', 'blocked'],
        tagIds: [],
        includeDeleted: false,
        limit: 100,
        offset: 0
      })
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    }
  })
  const weekRange = useMemo(() => {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    start.setDate(start.getDate() - (start.getDay() === 0 ? 6 : start.getDay() - 1))
    const end = new Date(start)
    end.setDate(end.getDate() + 7)
    return { start: start.toISOString(), end: end.toISOString() }
  }, [])
  const dashboardEffortsQuery = useQuery({
    queryKey: ['dashboard-efforts', weekRange.start, weekRange.end],
    queryFn: async () => {
      const result = await window.youtrace.execution.listEfforts({
        entityType: null,
        entityId: null,
        from: weekRange.start,
        to: weekRange.end,
        limit: 500,
        offset: 0
      })
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    }
  })
  const dashboardMemosQuery = useQuery({
    queryKey: ['memos', 'inbox'],
    queryFn: async () => {
      const result = await window.youtrace.execution.listMemos(true)
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    }
  })
  const dashboardTasks = dashboardTasksQuery.data ?? []
  const dashboardFocus = dashboardTasks.slice(0, 3)
  const dashboardEfforts = dashboardEffortsQuery.data ?? []
  const weeklyMinutes = dashboardEfforts.reduce((sum, effort) => sum + effort.effectiveMinutes, 0)
  const dailyMinutes = [1, 2, 3, 4, 5, 6, 0].map((day) =>
    dashboardEfforts
      .filter((effort) => new Date(effort.startedAt).getDay() === day)
      .reduce((sum, effort) => sum + effort.effectiveMinutes, 0)
  )
  const maxDailyMinutes = Math.max(1, ...dailyMinutes)
  const plannedMinutes = dashboardFocus.reduce(
    (sum, task) => sum + (task.estimatedMinutes ?? preferencesQuery.data?.defaultTaskMinutes ?? 30),
    0
  )
  const capacityMinutes = preferencesQuery.data?.dailyCapacityMinutes ?? 480

  useEffect(() => {
    const preferences = preferencesQuery.data
    if (!preferences) return
    document.documentElement.dataset.theme = preferences.theme
    document.documentElement.dataset.density = preferences.density
    document.documentElement.style.setProperty('--user-font-scale', preferences.fontScale.toString())
  }, [preferencesQuery.data])

  useEffect(() => {
    const listener = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setSearchOpen(true)
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        setActive('memos')
      }
    }
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])

  useEffect(
    () =>
      window.youtrace.reminders.onNavigate(({ sourceType }) => {
        if (sourceType === 'time_block' || sourceType === 'countdown') setActive('calendar')
        else if (sourceType === 'review') setActive('plan')
        else if (sourceType === 'overload') setActive('calendar')
        else if (sourceType === 'stagnation') setActive('plan')
        else setActive('today')
      }),
    []
  )

  const switchWorkspace = async (): Promise<void> => {
    const selection = await window.youtrace.dialog.selectDirectory()
    if (!selection.ok || !selection.data) return
    const result = await window.youtrace.workspace.open({
      rootPath: selection.data,
      readOnly: false
    })
    if (!result.ok) {
      setWorkspacePrompt({
        kind: result.error.code === 'WORKSPACE_LOCKED' ? 'locked' : 'error',
        rootPath: selection.data,
        message: result.error.message,
        recovery: result.error.recovery ?? null
      })
      return
    }
    queryClient.clear()
    onWorkspaceChange(result.data)
  }

  const openWorkspaceReadOnly = async (): Promise<void> => {
    if (!workspacePrompt?.rootPath) return
    const result = await window.youtrace.workspace.open({
      rootPath: workspacePrompt.rootPath,
      readOnly: true
    })
    if (!result.ok) {
      setWorkspacePrompt({
        kind: 'error',
        rootPath: workspacePrompt.rootPath,
        message: result.error.message,
        recovery: result.error.recovery ?? null
      })
      return
    }
    setWorkspacePrompt(null)
    queryClient.clear()
    onWorkspaceChange(result.data)
  }

  return (
    <div className="workspace-shell">
      <aside className="sidebar">
        <button className="workspace-switcher" type="button" aria-label="切换工作区" onClick={() => void switchWorkspace()}>
          <span className="workspace-monogram">{workspace.name.slice(0, 1)}</span>
          <span>
            <strong>{workspace.name}</strong>
            <small>{workspace.readOnly ? '只读工作区' : '本地工作区'}</small>
          </span>
          <ChevronRight size={15} />
        </button>

        <nav className="primary-navigation" aria-label="主导航">
          {navigation.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.id}
                type="button"
                className={active === item.id ? 'active' : ''}
                aria-current={active === item.id ? 'page' : undefined}
                onClick={() => setActive(item.id)}
              >
                <Icon size={18} strokeWidth={1.8} />
                <span>{item.label}</span>
                {item.id === 'memos' && <small>{dashboardMemosQuery.data?.length ?? 0}</small>}
              </button>
            )
          })}
        </nav>

        <div className="sidebar-section">
          <span className="sidebar-label">整理</span>
          <button type="button" onClick={() => setActive('tags')}>
            <Tags size={17} />
            <span>标签</span>
          </button>
          <button type="button" onClick={() => setActive('templates')}>
            <LayoutTemplate size={17} />
            <span>模板</span>
          </button>
          <button type="button" onClick={() => setActive('data')}>
            <MoreHorizontal size={17} />
            <span>更多</span>
          </button>
        </div>

        <div className="sidebar-footer">
          <button type="button" onClick={() => setActive('settings')}>
            <Settings size={17} />
            <span>设置</span>
          </button>
          <div className="storage-indicator" title={workspace.path}>
            <span />
            <small>工作区已连接</small>
          </div>
        </div>
      </aside>

      <section className="workspace-content">
        {active !== 'home' ? (
          active === 'plan' ? (
            <PlanningPage />
          ) : active === 'today' ? (
            <TodayPage />
          ) : active === 'records' ? (
            <RecordsPage />
          ) : active === 'calendar' ? (
            <CalendarPage />
          ) : active === 'reviews' ? (
            <ReviewsPage />
          ) : active === 'templates' ? (
            <TemplatesPage />
          ) : active === 'settings' ? (
            <SettingsPage workspace={workspace} />
          ) : active === 'data' ? (
            <DataPage />
          ) : active === 'memos' ? (
            <MemosPage />
          ) : active === 'tags' ? (
            <TagsPage />
          ) : (
            <SectionPlaceholder section={navigation.find((item) => item.id === active)?.label ?? '功能'} />
          )
        ) : (
          <>
            <header className="global-toolbar">
          <div>
            <span className="page-kicker">{today}</span>
            <h1>今天，从一件真正重要的事开始。</h1>
          </div>
          <div className="toolbar-actions">
            <button className="search-trigger" type="button" onClick={() => setSearchOpen(true)}>
              <Search size={17} />
              <span>搜索目标、任务和记录</span>
              <kbd>Ctrl K</kbd>
            </button>
            <button className="button button-primary quick-create" type="button" onClick={() => setActive('plan')}>
              <Plus size={17} />
              新建
            </button>
          </div>
            </header>

            <main className="dashboard">
          <section className="today-focus panel">
            <div className="panel-heading">
              <div>
                <span className="section-label">今日重点</span>
                <h2>把下一步放到轨迹上</h2>
              </div>
              <button type="button" className="text-action" onClick={() => setActive('today')}>
                安排今天
                <ChevronRight size={15} />
              </button>
            </div>

            <div className="empty-focus">
              <div className="focus-orbit" aria-hidden="true">
                <span />
              </div>
              <div>
                <strong>{dashboardFocus[0]?.title ?? '还没有选定今日重点'}</strong>
                <p>{dashboardFocus.length ? `当前候选 ${dashboardFocus.length} 项；在今日执行台可开始计时或快速调整。` : '从一个目标中挑选下一步，或先快速记录脑中的事情。'}</p>
              </div>
              <button className="button button-secondary" type="button" onClick={() => setActive(dashboardFocus.length ? 'today' : 'plan')}>
                <Plus size={16} />
                {dashboardFocus.length ? '进入今日执行台' : '创建第一项任务'}
              </button>
            </div>

            <div className="capacity-line">
              <span>
                <Clock3 size={15} />
                今日容量
              </span>
              <div className="capacity-track">
                <span style={{ width: `${Math.min(100, Math.round((plannedMinutes / capacityMinutes) * 100))}%` }} />
              </div>
              <strong>{formatDashboardMinutes(plannedMinutes)} / {formatDashboardMinutes(capacityMinutes)}</strong>
            </div>
          </section>

          <CountdownSummary onOpenCalendar={() => setActive('calendar')} />

          <section className="trace-panel panel">
            <div className="panel-heading">
              <div>
                <span className="section-label">努力轨迹</span>
                <h2>计划只是起点，事实从投入开始</h2>
              </div>
              <button type="button" className="text-action" onClick={() => setActive('records')}>
                查看记录
                <ChevronRight size={15} />
              </button>
            </div>

            <div className="trace-zero">
              <div className="trace-line" aria-hidden="true">
                <span className="trace-node current" />
                <span className="trace-node" />
                <span className="trace-node" />
              </div>
              <div className="trace-copy">
                <article>
                  <small>此刻</small>
                  <strong>{dashboardEfforts[0]?.entityTitle ?? '开始第一段专注'}</strong>
                  <p>{dashboardEfforts[0]?.result || '计时结束后，投入、结果、困难和下一步会一起留在这里。'}</p>
                </article>
                <article className="muted">
                  <small>随后</small>
                  <strong>形成阶段成果</strong>
                </article>
                <article className="muted">
                  <small>复盘时</small>
                  <strong>根据事实调整计划</strong>
                </article>
              </div>
              <button type="button" className="timer-button" onClick={() => setActive('today')}>
                <span>
                  <Clock3 size={21} />
                </span>
                <strong>开始计时</strong>
                <small>{dashboardFocus[0]?.title ?? '先选择一项任务'}</small>
              </button>
            </div>
          </section>

          <section className="weekly-panel panel">
            <div className="panel-heading compact">
              <div>
                <span className="section-label">本周事实</span>
                <h2>真实投入</h2>
              </div>
              <strong className="weekly-total">{formatDashboardMinutes(weeklyMinutes)}</strong>
            </div>
            <div className="weekly-bars" aria-label="本周暂无投入记录">
              {['一', '二', '三', '四', '五', '六', '日'].map((day, index) => (
                <div key={day}>
                  <span style={{ height: `${Math.max(4, Math.round((dailyMinutes[index]! / maxDailyMinutes) * 64))}px` }} />
                  <small>{day}</small>
                </div>
              ))}
            </div>
          </section>

          <section className="inbox-panel panel">
            <div className="panel-heading compact">
              <div>
                <span className="section-label">先捕捉，再整理</span>
                <h2>快速备忘</h2>
              </div>
              <Inbox size={18} />
            </div>
            <button type="button" className="memo-entry" onClick={() => setActive('memos')}>
              写下突然想到的事情…
              <kbd>Ctrl N</kbd>
            </button>
            <p>可以稍后转换为任务、知识点或错题，原始内容会保留。</p>
          </section>
            </main>
          </>
        )}
      </section>
      <GlobalSearch
        open={searchOpen}
        onOpenChange={setSearchOpen}
        onNavigate={(entityType) => {
          if (entityType === 'memo') setActive('memos')
          else if (entityType === 'effort' || entityType === 'evidence') setActive('records')
          else setActive('plan')
        }}
      />
      <Dialog.Root open={workspacePrompt !== null} onOpenChange={(open) => { if (!open) setWorkspacePrompt(null) }}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog-content destructive-dialog">
            <div className="dialog-heading">
              <div>
                <span className="section-label"><AlertTriangle size={14} />工作区无法正常打开</span>
                <Dialog.Title>{workspacePrompt?.kind === 'locked' ? '工作区正在被使用' : '打开工作区失败'}</Dialog.Title>
                <Dialog.Description>{workspacePrompt?.message}</Dialog.Description>
              </div>
              <Dialog.Close className="dialog-close" aria-label="关闭"><X size={18} /></Dialog.Close>
            </div>
            {workspacePrompt?.recovery ? <div className="inline-error">{workspacePrompt.recovery}</div> : null}
            <div className="dialog-actions">
              <Dialog.Close className="button button-secondary">关闭</Dialog.Close>
              {workspacePrompt?.kind === 'locked' ? <button className="button button-primary" type="button" onClick={() => void openWorkspaceReadOnly()}>以只读方式打开</button> : null}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}

function formatDashboardMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours}h ${rest}m` : `${hours}h`
}

function SectionPlaceholder({ section }: { section: string }): React.JSX.Element {
  return (
    <main className="section-placeholder">
      <span className="section-label">正在接入完整闭环</span>
      <h1>{section}</h1>
      <p>这一模块正在按项目规范连接领域服务与本地工作区数据。</p>
    </main>
  )
}
