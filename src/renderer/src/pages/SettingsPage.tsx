import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Bell,
  Check,
  Clock3,
  Database,
  FolderOpen,
  HardDrive,
  MoonStar,
  Save,
  ShieldCheck
} from 'lucide-react'
import { useEffect, useState } from 'react'
import type {
  IpcResult,
  NotificationSettings,
  WorkspaceSummary
} from '../../../shared/contracts'

function unwrap<T>(result: IpcResult<T>): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.data
}

export function SettingsPage({ workspace }: { workspace: WorkspaceSummary }): React.JSX.Element {
  const queryClient = useQueryClient()
  const [settings, setSettings] = useState<NotificationSettings | null>(null)
  const [saved, setSaved] = useState(false)
  const settingsQuery = useQuery({
    queryKey: ['notification-settings'],
    queryFn: async () => unwrap(await window.youtrace.reminders.getSettings())
  })
  const upcomingQuery = useQuery({
    queryKey: ['upcoming-reminders'],
    queryFn: async () => unwrap(await window.youtrace.reminders.listUpcoming())
  })
  useEffect(() => {
    if (settingsQuery.data) setSettings(settingsQuery.data)
  }, [settingsQuery.data])

  const save = async (): Promise<void> => {
    if (!settings) return
    const result = await window.youtrace.reminders.updateSettings(settings)
    if (!result.ok) return
    setSaved(true)
    await queryClient.invalidateQueries({ queryKey: ['notification-settings'] })
    window.setTimeout(() => setSaved(false), 1_500)
  }

  return (
    <div className="settings-page">
      <header className="settings-toolbar">
        <div><span className="page-kicker">明确影响范围</span><h1>设置</h1><p>工作区内容仍只保存在你选择的本地目录。</p></div>
      </header>

      <section className="settings-section panel">
        <header><span><HardDrive size={17} /></span><div><h2>工作区与数据</h2><p>当前连接、存储位置和写入模式。</p></div></header>
        <div className="workspace-setting-card">
          <span className="workspace-setting-icon"><Database size={20} /></span>
          <div><strong>{workspace.name}</strong><small>{workspace.path}</small><em>{workspace.readOnly ? '只读连接' : '可写 · SQLite WAL'}</em></div>
          <button className="button button-secondary" type="button" onClick={() => void window.youtrace.workspace.reveal()}><FolderOpen size={14} />打开文件夹</button>
        </div>
        <div className="settings-note"><ShieldCheck size={14} /><span>应用外仅保存工作区路径与最近打开时间，不保存任务、备忘或成果内容。</span></div>
      </section>

      <section className="settings-section panel">
        <header><span><Bell size={17} /></span><div><h2>通知与静默时间</h2><p>主窗口隐藏到托盘后，提醒仍由本地主进程调度。</p></div></header>
        {settings && (
          <>
            <div className="settings-grid">
              <ToggleSetting label="启用系统提醒" description="关闭后不生成新的系统通知。" checked={settings.enabled} onChange={(enabled) => setSettings({ ...settings, enabled })} />
              <ToggleSetting label="任务截止" description="到期前 30 分钟提醒。" checked={settings.taskDue} onChange={(taskDue) => setSettings({ ...settings, taskDue })} />
              <ToggleSetting label="时间块" description="开始前 10 分钟提醒。" checked={settings.timeBlocks} onChange={(timeBlocks) => setSettings({ ...settings, timeBlocks })} />
              <ToggleSetting label="倒计时" description="目标时间前 24 小时提醒。" checked={settings.countdowns} onChange={(countdowns) => setSettings({ ...settings, countdowns })} />
              <ToggleSetting label="复习队列" description="按指定复习日期提醒。" checked={settings.reviews} onChange={(reviews) => setSettings({ ...settings, reviews })} />
              <ToggleSetting label="停滞与过载" description="提示长期无行动项目和超容量计划。" checked={settings.stagnation && settings.overload} onChange={(value) => setSettings({ ...settings, stagnation: value, overload: value })} />
            </div>
            <div className="quiet-hours">
              <span><MoonStar size={15} />静默时间</span>
              <label><span>开始</span><input aria-label="静默开始" type="time" value={settings.quietStart} onChange={(event) => setSettings({ ...settings, quietStart: event.target.value })} /></label>
              <label><span>结束</span><input aria-label="静默结束" type="time" value={settings.quietEnd} onChange={(event) => setSettings({ ...settings, quietEnd: event.target.value })} /></label>
              <p>静默期间到期的提醒保留为待处理；恢复后会去重汇总。</p>
            </div>
            <div className="settings-actions"><button className="button button-primary" type="button" onClick={() => void save()}>{saved ? <Check size={14} /> : <Save size={14} />}{saved ? '已保存' : '保存通知设置'}</button></div>
          </>
        )}
        {(upcomingQuery.data ?? []).length > 0 && (
          <div className="upcoming-reminders">
            <h3>待处理提醒</h3>
            {(upcomingQuery.data ?? []).slice(0, 5).map((reminder) => <article key={reminder.id}><Clock3 size={13} /><strong>{reminder.title}</strong><span>{new Date(reminder.scheduledAt).toLocaleString('zh-CN')}</span></article>)}
          </div>
        )}
      </section>
    </div>
  )
}

function ToggleSetting(props: { label: string; description: string; checked: boolean; onChange: (checked: boolean) => void }): React.JSX.Element {
  return <label className="toggle-setting"><span><strong>{props.label}</strong><small>{props.description}</small></span><input type="checkbox" checked={props.checked} onChange={(event) => props.onChange(event.target.checked)} /><i aria-hidden="true" /></label>
}
