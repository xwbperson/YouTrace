import {
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
  TimerReset
} from 'lucide-react'
import { useMemo, useState } from 'react'
import type { WorkspaceSummary } from '../../../shared/contracts'
import { PlanningPage } from '../pages/PlanningPage'

interface AppShellProps {
  workspace: WorkspaceSummary
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

export function AppShell({ workspace }: AppShellProps): React.JSX.Element {
  const [active, setActive] = useState<(typeof navigation)[number]['id']>('home')
  const today = useMemo(
    () =>
      new Intl.DateTimeFormat('zh-CN', {
        month: 'long',
        day: 'numeric',
        weekday: 'long'
      }).format(new Date()),
    []
  )

  return (
    <div className="workspace-shell">
      <aside className="sidebar">
        <button className="workspace-switcher" type="button" aria-label="当前工作区">
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
                {item.id === 'memos' && <small>0</small>}
              </button>
            )
          })}
        </nav>

        <div className="sidebar-section">
          <span className="sidebar-label">整理</span>
          <button type="button">
            <Tags size={17} />
            <span>标签</span>
          </button>
          <button type="button">
            <LayoutTemplate size={17} />
            <span>模板</span>
          </button>
          <button type="button">
            <MoreHorizontal size={17} />
            <span>更多</span>
          </button>
        </div>

        <div className="sidebar-footer">
          <button type="button">
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
        {active === 'plan' ? (
          <PlanningPage />
        ) : (
          <>
            <header className="global-toolbar">
          <div>
            <span className="page-kicker">{today}</span>
            <h1>今天，从一件真正重要的事开始。</h1>
          </div>
          <div className="toolbar-actions">
            <button className="search-trigger" type="button">
              <Search size={17} />
              <span>搜索目标、任务和记录</span>
              <kbd>Ctrl K</kbd>
            </button>
            <button className="button button-primary quick-create" type="button">
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
              <button type="button" className="text-action">
                安排今天
                <ChevronRight size={15} />
              </button>
            </div>

            <div className="empty-focus">
              <div className="focus-orbit" aria-hidden="true">
                <span />
              </div>
              <div>
                <strong>还没有选定今日重点</strong>
                <p>从一个目标中挑选下一步，或先快速记录脑中的事情。</p>
              </div>
              <button className="button button-secondary" type="button">
                <Plus size={16} />
                创建第一项任务
              </button>
            </div>

            <div className="capacity-line">
              <span>
                <Clock3 size={15} />
                今日容量
              </span>
              <div className="capacity-track">
                <span style={{ width: '0%' }} />
              </div>
              <strong>0 / 8 小时</strong>
            </div>
          </section>

          <section className="countdowns panel">
            <div className="panel-heading compact">
              <div>
                <span className="section-label">临近时刻</span>
                <h2>倒计时</h2>
              </div>
              <button className="icon-action" type="button" aria-label="新建倒计时">
                <Plus size={17} />
              </button>
            </div>
            <div className="countdown-empty">
              <span className="countdown-number">—</span>
              <p>建立一个明确期限后，这里会显示剩余时间和所需速度。</p>
            </div>
          </section>

          <section className="trace-panel panel">
            <div className="panel-heading">
              <div>
                <span className="section-label">努力轨迹</span>
                <h2>计划只是起点，事实从投入开始</h2>
              </div>
              <button type="button" className="text-action">
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
                  <strong>开始第一段专注</strong>
                  <p>计时结束后，投入、结果、困难和下一步会一起留在这里。</p>
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
              <button type="button" className="timer-button">
                <span>
                  <Clock3 size={21} />
                </span>
                <strong>开始计时</strong>
                <small>先选择一项任务</small>
              </button>
            </div>
          </section>

          <section className="weekly-panel panel">
            <div className="panel-heading compact">
              <div>
                <span className="section-label">本周事实</span>
                <h2>真实投入</h2>
              </div>
              <strong className="weekly-total">0h</strong>
            </div>
            <div className="weekly-bars" aria-label="本周暂无投入记录">
              {['一', '二', '三', '四', '五', '六', '日'].map((day) => (
                <div key={day}>
                  <span style={{ height: '4px' }} />
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
            <button type="button" className="memo-entry">
              写下突然想到的事情…
              <kbd>Ctrl N</kbd>
            </button>
            <p>可以稍后转换为任务、知识点或错题，原始内容会保留。</p>
          </section>
            </main>
          </>
        )}
      </section>
    </div>
  )
}
