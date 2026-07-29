import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Bell,
  BellOff,
  CalendarDays,
  Check,
  Clock3,
  Database,
  FolderOpen,
  HardDrive,
  MoonStar,
  Palette,
  Save,
  ShieldCheck,
  TimerReset,
  X
} from 'lucide-react'
import { useEffect, useState } from 'react'
import type {
  IpcResult,
  NotificationSettings,
  UserPreferences,
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
  const [preferences, setPreferences] = useState<UserPreferences | null>(null)
  const [maintenanceMessage, setMaintenanceMessage] = useState('')
  const settingsQuery = useQuery({
    queryKey: ['notification-settings'],
    queryFn: async () => unwrap(await window.youtrace.reminders.getSettings())
  })
  const upcomingQuery = useQuery({
    queryKey: ['upcoming-reminders'],
    queryFn: async () => unwrap(await window.youtrace.reminders.listUpcoming())
  })
  const preferencesQuery = useQuery({
    queryKey: ['user-preferences'],
    queryFn: async () => unwrap(await window.youtrace.settings.getPreferences())
  })
  const tagsQuery = useQuery({
    queryKey: ['tags'],
    queryFn: async () => unwrap(await window.youtrace.planning.listTags())
  })
  useEffect(() => {
    if (settingsQuery.data) setSettings(settingsQuery.data)
  }, [settingsQuery.data])
  useEffect(() => {
    if (preferencesQuery.data) setPreferences(preferencesQuery.data)
  }, [preferencesQuery.data])

  const save = async (): Promise<void> => {
    if (!settings || !preferences) return
    const [notificationResult, preferenceResult] = await Promise.all([
      window.youtrace.reminders.updateSettings(settings),
      window.youtrace.settings.updatePreferences(preferences)
    ])
    if (!notificationResult.ok || !preferenceResult.ok) return
    setSaved(true)
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['notification-settings'] }),
      queryClient.invalidateQueries({ queryKey: ['user-preferences'] })
    ])
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

      {preferences && (
        <section className="settings-section panel">
          <header><span><CalendarDays size={17} /></span><div><h2>计划、时间与难度</h2><p>日期语义、每日容量和默认任务属性。</p></div></header>
          <div className="preference-grid">
            <label><span>工作区时区</span><input value={preferences.timezone} onChange={(event) => setPreferences({ ...preferences, timezone: event.target.value })} /></label>
            <label><span>每日容量（分钟）</span><input type="number" min="30" max="1440" value={preferences.dailyCapacityMinutes} onChange={(event) => setPreferences({ ...preferences, dailyCapacityMinutes: Number(event.target.value) })} /></label>
            <label><span>默认任务时长</span><input type="number" min="5" value={preferences.defaultTaskMinutes} onChange={(event) => setPreferences({ ...preferences, defaultTaskMinutes: Number(event.target.value) })} /></label>
            <label><span>默认优先级</span><select value={preferences.defaultPriority} onChange={(event) => setPreferences({ ...preferences, defaultPriority: event.target.value as UserPreferences['defaultPriority'] })}><option value="low">低</option><option value="medium">中</option><option value="high">高</option><option value="critical">关键</option></select></label>
          </div>
          <div className="working-days"><span>工作日</span>{['日', '一', '二', '三', '四', '五', '六'].map((label, value) => <button type="button" key={label} className={preferences.workingDays.includes(value) ? 'active' : ''} onClick={() => setPreferences({ ...preferences, workingDays: preferences.workingDays.includes(value) ? preferences.workingDays.filter((day) => day !== value) : [...preferences.workingDays, value].sort() })}>{label}</button>)}</div>
          <div className="difficulty-settings">{preferences.difficultyLabels.map((label, index) => <label key={index}><span>难度 {index + 1}</span><input value={label} onChange={(event) => { const labels = [...preferences.difficultyLabels] as UserPreferences['difficultyLabels']; labels[index] = event.target.value; setPreferences({ ...preferences, difficultyLabels: labels }) }} /></label>)}</div>
        </section>
      )}

      {preferences && (
        <section className="settings-section panel">
          <header><span><Palette size={17} /></span><div><h2>外观与后台</h2><p>主题、字号、密度和关闭窗口行为。</p></div></header>
          <div className="preference-grid">
            <label><span>主题</span><select value={preferences.theme} onChange={(event) => { const theme = event.target.value as UserPreferences['theme']; setPreferences({ ...preferences, theme }); document.documentElement.dataset.theme = theme }}><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></label>
            <label><span>字号比例</span><input type="number" min="0.9" max="1.25" step="0.05" value={preferences.fontScale} onChange={(event) => { const fontScale = Number(event.target.value); setPreferences({ ...preferences, fontScale }); document.documentElement.style.setProperty('--user-font-scale', fontScale.toString()) }} /></label>
            <label><span>界面密度</span><select value={preferences.density} onChange={(event) => setPreferences({ ...preferences, density: event.target.value as UserPreferences['density'] })}><option value="compact">紧凑</option><option value="comfortable">舒适</option></select></label>
            <label><span>关闭主窗口</span><select value={preferences.closeBehavior} onChange={(event) => setPreferences({ ...preferences, closeBehavior: event.target.value as UserPreferences['closeBehavior'] })}><option value="tray">隐藏到托盘</option><option value="quit">退出程序</option></select></label>
          </div>
          <div className="settings-grid">
            <ToggleSetting label="完成前确认" description="完成关键任务前再次确认。" checked={preferences.completionConfirmation} onChange={(completionConfirmation) => setPreferences({ ...preferences, completionConfirmation })} />
            <ToggleSetting label="自动备份" description="使用在线 SQLite 快照并在校验后登记。" checked={preferences.automaticBackupEnabled} onChange={(automaticBackupEnabled) => setPreferences({ ...preferences, automaticBackupEnabled })} />
          </div>
          <div className="preference-grid">
            <label><span>自动备份间隔（小时）</span><input type="number" min="1" max="168" value={preferences.automaticBackupIntervalHours} onChange={(event) => setPreferences({ ...preferences, automaticBackupIntervalHours: Number(event.target.value) })} /></label>
            <label><span>自动备份保留份数</span><input type="number" min="1" max="50" value={preferences.backupRetentionCount} onChange={(event) => setPreferences({ ...preferences, backupRetentionCount: Number(event.target.value) })} /></label>
          </div>
        </section>
      )}

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
            <div className="muted-tags-setting">
              <span><BellOff size={14} />按标签关闭提醒</span>
              <div>
                {(tagsQuery.data ?? []).map((tag) => (
                  <button
                    type="button"
                    key={tag.id}
                    className={settings.mutedTagIds.includes(tag.id) ? 'active' : ''}
                    onClick={() =>
                      setSettings({
                        ...settings,
                        mutedTagIds: settings.mutedTagIds.includes(tag.id)
                          ? settings.mutedTagIds.filter((id) => id !== tag.id)
                          : [...settings.mutedTagIds, tag.id]
                      })
                    }
                  >
                    <i style={{ background: tag.color ?? '#64736e' }} />{tag.name}
                  </button>
                ))}
              </div>
            </div>
            <div className="settings-actions"><button className="button button-primary" type="button" onClick={() => void save()}>{saved ? <Check size={14} /> : <Save size={14} />}{saved ? '已保存' : '保存通知设置'}</button></div>
          </>
        )}
        {(upcomingQuery.data ?? []).length > 0 && (
          <div className="upcoming-reminders">
            <h3>待处理提醒</h3>
            {(upcomingQuery.data ?? []).slice(0, 5).map((reminder) => <article key={reminder.id}><Clock3 size={13} /><strong>{reminder.title}</strong><span>{new Date(reminder.scheduledAt).toLocaleString('zh-CN')}</span><button aria-label={`延后提醒：${reminder.title}`} onClick={async () => { await window.youtrace.reminders.snooze(reminder.id, 30); await queryClient.invalidateQueries({ queryKey: ['upcoming-reminders'] }) }}><TimerReset size={12} />30 分钟</button><button aria-label={`关闭单项提醒：${reminder.title}`} onClick={async () => { await window.youtrace.reminders.dismiss(reminder.id); await queryClient.invalidateQueries({ queryKey: ['upcoming-reminders'] }) }}><X size={12} /></button><button aria-label={`不再提醒此对象：${reminder.title}`} onClick={async () => { await window.youtrace.reminders.muteSource(reminder.sourceType, reminder.sourceId); await queryClient.invalidateQueries({ queryKey: ['upcoming-reminders'] }) }}><BellOff size={12} /></button></article>)}
          </div>
        )}
      </section>
      <section className="settings-section panel">
        <header><span><ShieldCheck size={17} /></span><div><h2>数据维护</h2><p>常用安全操作；完整恢复和回收站位于“更多”。</p></div></header>
        <div className="maintenance-actions">
          <button className="button button-secondary" onClick={async () => { const result = await window.youtrace.data.checkWorkspace(); setMaintenanceMessage(result.ok ? `检查通过：${result.data.fileCount} 个文件` : result.error.message) }}><ShieldCheck size={14} />完整性检查</button>
          <button className="button button-secondary" onClick={async () => { const result = await window.youtrace.data.createBackup('设置页手动备份'); setMaintenanceMessage(result.ok ? '已创建并校验备份' : result.error.message) }}><Database size={14} />立即备份</button>
          <button className="button button-secondary" onClick={async () => { const result = await window.youtrace.data.exportReadable(); setMaintenanceMessage(result.ok ? '已导出 Markdown / CSV' : result.error.message) }}><Save size={14} />可读导出</button>
          <button className="button button-secondary" onClick={async () => { const result = await window.youtrace.data.rebuildSearchIndex(); setMaintenanceMessage(result.ok ? `已从业务表重建 ${result.data.indexedCount} 条搜索索引` : result.error.message) }}><TimerReset size={14} />重建搜索索引</button>
        </div>
        {maintenanceMessage && <div className="settings-note"><Check size={14} /><span>{maintenanceMessage}</span></div>}
      </section>
      <div className="settings-sticky-save"><button className="button button-primary" disabled={!settings || !preferences} onClick={() => void save()}>{saved ? <Check size={14} /> : <Save size={14} />}{saved ? '全部设置已保存' : '保存全部设置'}</button></div>
    </div>
  )
}

function ToggleSetting(props: { label: string; description: string; checked: boolean; onChange: (checked: boolean) => void }): React.JSX.Element {
  return <label className="toggle-setting"><span><strong>{props.label}</strong><small>{props.description}</small></span><input type="checkbox" checked={props.checked} onChange={(event) => props.onChange(event.target.checked)} /><i aria-hidden="true" /></label>
}
