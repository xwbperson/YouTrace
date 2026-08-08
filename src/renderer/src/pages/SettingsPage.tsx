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
import { QueryFailure } from '../components/QueryFeedback'

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
  const [maintenanceError, setMaintenanceError] = useState('')
  const [maintenanceBusy, setMaintenanceBusy] = useState('')
  const [saveError, setSaveError] = useState('')
  const [saveBusy, setSaveBusy] = useState(false)
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
  const backupStorageQuery = useQuery({
    queryKey: ['backup-storage-status'],
    queryFn: async () => unwrap(await window.youtrace.data.getBackupStorageStatus())
  })
  useEffect(() => {
    if (settingsQuery.data) setSettings(settingsQuery.data)
  }, [settingsQuery.data])
  useEffect(() => {
    if (preferencesQuery.data) setPreferences(preferencesQuery.data)
  }, [preferencesQuery.data])

  const save = async (): Promise<void> => {
    if (!settings || !preferences) return
    setSaveBusy(true)
    setSaveError('')
    try {
      const [notificationResult, preferenceResult] = await Promise.all([
        window.youtrace.reminders.updateSettings(settings),
        window.youtrace.settings.updatePreferences(preferences)
      ])
      if (!notificationResult.ok) return setSaveError(notificationResult.error.message)
      if (!preferenceResult.ok) return setSaveError(preferenceResult.error.message)
      setSaved(true)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['notification-settings'] }),
        queryClient.invalidateQueries({ queryKey: ['user-preferences'] })
      ])
      window.setTimeout(() => setSaved(false), 1_500)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : '设置保存失败，请重试。')
    } finally {
      setSaveBusy(false)
    }
  }

  const runMaintenance = async (
    label: string,
    operation: () => Promise<IpcResult<unknown>>,
    successMessage: (result: unknown) => string
  ): Promise<void> => {
    setMaintenanceBusy(label)
    setMaintenanceMessage('')
    setMaintenanceError('')
    try {
      const result = await operation()
      if (!result.ok) return setMaintenanceError(result.error.message)
      setMaintenanceMessage(successMessage(result.data))
      await backupStorageQuery.refetch()
    } catch (error) {
      setMaintenanceError(error instanceof Error ? error.message : `${label}失败，请重试。`)
    } finally {
      setMaintenanceBusy('')
    }
  }

  const runReminderAction = async (
    operation: () => Promise<IpcResult<unknown>>
  ): Promise<void> => {
    const result = await operation()
    if (!result.ok) return setSaveError(result.error.message)
    setSaveError('')
    await queryClient.invalidateQueries({ queryKey: ['upcoming-reminders'] })
  }

  return (
    <div className="settings-page">
      <header className="settings-toolbar">
        <div><span className="page-kicker">明确影响范围</span><h1>设置</h1><p>工作区内容仍只保存在你选择的本地目录。</p></div>
      </header>

      {(settingsQuery.isError || preferencesQuery.isError || tagsQuery.isError || upcomingQuery.isError || backupStorageQuery.isError) && (
        <QueryFailure
          title="部分设置读取失败"
          detail="当前页面不会用默认值覆盖读取失败的设置，请重新读取后再保存。"
          onRetry={() => void Promise.all([
            settingsQuery.refetch(),
            preferencesQuery.refetch(),
            tagsQuery.refetch(),
            upcomingQuery.refetch(),
            backupStorageQuery.refetch()
          ])}
        />
      )}
      {saveError && <div className="inline-error" role="alert">{saveError}</div>}

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
          </div>
          <fieldset className="close-behavior-setting">
            <legend>点击右上角关闭按钮时</legend>
            <label className={preferences.closeBehavior === 'tray' ? 'active' : ''}>
              <input type="radio" name="close-behavior" value="tray" checked={preferences.closeBehavior === 'tray'} onChange={() => setPreferences({ ...preferences, closeBehavior: 'tray' })} />
              <span><strong>最小化到托盘</strong><small>窗口隐藏，计时、备份和提醒继续运行。</small></span>
            </label>
            <label className={preferences.closeBehavior === 'quit' ? 'active' : ''}>
              <input type="radio" name="close-behavior" value="quit" checked={preferences.closeBehavior === 'quit'} onChange={() => setPreferences({ ...preferences, closeBehavior: 'quit' })} />
              <span><strong>直接退出程序</strong><small>关闭前确认，退出后后台计时和提醒停止。</small></span>
            </label>
          </fieldset>
          <div className="settings-grid">
            <ToggleSetting label="完成前确认" description="完成关键任务前再次确认。" checked={preferences.completionConfirmation} onChange={(completionConfirmation) => setPreferences({ ...preferences, completionConfirmation })} />
            <ToggleSetting label="自动备份" description="使用在线 SQLite 快照并在校验后登记。" checked={preferences.automaticBackupEnabled} onChange={(automaticBackupEnabled) => setPreferences({ ...preferences, automaticBackupEnabled })} />
          </div>
          <div className="preference-grid">
            <label><span>自动备份间隔（小时）</span><input type="number" min="1" max="168" value={preferences.automaticBackupIntervalHours} onChange={(event) => setPreferences({ ...preferences, automaticBackupIntervalHours: Number(event.target.value) })} /></label>
            <label><span>每日备份保留</span><input type="number" min="1" max="50" value={preferences.backupDailyRetention} onChange={(event) => setPreferences({ ...preferences, backupDailyRetention: Number(event.target.value) })} /></label>
            <label><span>每周备份保留</span><input type="number" min="1" max="52" value={preferences.backupWeeklyRetention} onChange={(event) => setPreferences({ ...preferences, backupWeeklyRetention: Number(event.target.value) })} /></label>
            <label><span>每月备份保留</span><input type="number" min="1" max="24" value={preferences.backupMonthlyRetention} onChange={(event) => setPreferences({ ...preferences, backupMonthlyRetention: Number(event.target.value) })} /></label>
          </div>
          {backupStorageQuery.data ? (
            <div className={`settings-note ${backupStorageQuery.data.canCreate ? '' : 'settings-note-warning'}`}>
              <HardDrive size={14} />
              <span>
                {backupStorageQuery.data.backupCount} 份备份占用 {formatBytes(backupStorageQuery.data.totalBytes)}；
                下一份预计 {formatBytes(backupStorageQuery.data.nextEstimatedBytes)}，磁盘可用 {formatBytes(backupStorageQuery.data.freeBytes)}。
                {backupStorageQuery.data.canCreate ? '' : ' 空间不足时不会创建新备份，也不会先删除现有可恢复副本。'}
              </span>
            </div>
          ) : null}
        </section>
      )}

      <section className="settings-section panel">
        <header><span><Bell size={17} /></span><div><h2>通知与静默时间</h2><p>选择最小化到托盘时，提醒仍由本地主进程调度。</p></div></header>
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
            <div className="settings-actions"><button className="button button-primary" type="button" disabled={saveBusy} onClick={() => void save()}>{saved ? <Check size={14} /> : <Save size={14} />}{saveBusy ? '正在保存…' : saved ? '已保存' : '保存通知设置'}</button></div>
          </>
        )}
        {(upcomingQuery.data ?? []).length > 0 && (
          <div className="upcoming-reminders">
            <h3>待处理提醒</h3>
            {(upcomingQuery.data ?? []).slice(0, 5).map((reminder) => <article key={reminder.id}><Clock3 size={13} /><strong>{reminder.title}</strong><span>{new Date(reminder.scheduledAt).toLocaleString('zh-CN')}</span><button aria-label={`延后提醒：${reminder.title}`} onClick={() => void runReminderAction(() => window.youtrace.reminders.snooze(reminder.id, 30))}><TimerReset size={12} />30 分钟</button><button aria-label={`关闭单项提醒：${reminder.title}`} onClick={() => void runReminderAction(() => window.youtrace.reminders.dismiss(reminder.id))}><X size={12} /></button><button aria-label={`不再提醒此对象：${reminder.title}`} onClick={() => void runReminderAction(() => window.youtrace.reminders.muteSource(reminder.sourceType, reminder.sourceId))}><BellOff size={12} /></button></article>)}
          </div>
        )}
      </section>
      <section className="settings-section panel">
        <header><span><ShieldCheck size={17} /></span><div><h2>数据维护</h2><p>常用安全操作；完整恢复和回收站位于“更多”。</p></div></header>
        <div className="maintenance-actions">
          <button className="button button-secondary" disabled={Boolean(maintenanceBusy)} onClick={() => void runMaintenance('完整性检查', () => window.youtrace.data.checkWorkspace(), (data) => `检查通过：${(data as { fileCount: number }).fileCount} 个文件`)}><ShieldCheck size={14} />{maintenanceBusy === '完整性检查' ? '检查中…' : '完整性检查'}</button>
          <button className="button button-secondary" disabled={Boolean(maintenanceBusy)} onClick={() => void runMaintenance('立即备份', () => window.youtrace.data.createBackup('设置页手动备份'), () => '已创建并校验备份')}><Database size={14} />{maintenanceBusy === '立即备份' ? '备份中…' : '立即备份'}</button>
          <button className="button button-secondary" disabled={Boolean(maintenanceBusy)} onClick={() => void runMaintenance('可读导出', () => window.youtrace.data.exportReadable(), () => '已导出 Markdown / CSV')}><Save size={14} />{maintenanceBusy === '可读导出' ? '导出中…' : '可读导出'}</button>
          <button className="button button-secondary" disabled={Boolean(maintenanceBusy)} onClick={() => void runMaintenance('重建搜索索引', () => window.youtrace.data.rebuildSearchIndex(), (data) => `已从业务表重建 ${(data as { indexedCount: number }).indexedCount} 条搜索索引`)}><TimerReset size={14} />{maintenanceBusy === '重建搜索索引' ? '重建中…' : '重建搜索索引'}</button>
        </div>
        {maintenanceMessage && <div className="settings-note"><Check size={14} /><span>{maintenanceMessage}</span></div>}
        {maintenanceError && <div className="inline-error" role="alert">{maintenanceError}</div>}
      </section>
      <div className="settings-sticky-save"><button className="button button-primary" disabled={!settings || !preferences || saveBusy} onClick={() => void save()}>{saved ? <Check size={14} /> : <Save size={14} />}{saveBusy ? '正在保存…' : saved ? '全部设置已保存' : '保存全部设置'}</button></div>
    </div>
  )
}

function ToggleSetting(props: { label: string; description: string; checked: boolean; onChange: (checked: boolean) => void }): React.JSX.Element {
  return <label className="toggle-setting"><span><strong>{props.label}</strong><small>{props.description}</small></span><input type="checkbox" checked={props.checked} onChange={(event) => props.onChange(event.target.checked)} /><i aria-hidden="true" /></label>
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = units[0]
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024
    unit = units[index]
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}`
}
