import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, FolderOpen, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import type {
  AppBootstrapState,
  DatabaseRecoveryState,
  InterruptedEffortRecovery,
  InterruptedEffortRecoveryAction,
  IpcResult,
  MigrationRecoveryAction,
  MigrationRecoveryState,
  WorkspaceSummary,
  WorkspaceUnavailableState
} from '../../../shared/contracts'
import { AppShell } from '../components/AppShell'
import { Onboarding } from '../pages/Onboarding'
import { TitleBar } from '../components/TitleBar'

function unwrap<T>(result: IpcResult<T>): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.data
}

export function App(): React.JSX.Element {
  const [localState, setLocalState] = useState<AppBootstrapState | null>(null)
  const [workspaceIssue, setWorkspaceIssue] = useState<WorkspaceUnavailableState | null>(null)
  const [workspaceIssueOpen, setWorkspaceIssueOpen] = useState(false)
  const bootstrap = useQuery({
    queryKey: ['bootstrap'],
    queryFn: async () => unwrap(await window.youtrace.app.getBootstrapState())
  })
  const state = localState ?? bootstrap.data
  const migrationRecovery = useQuery({
    queryKey: ['pending-migration'],
    enabled: state?.status === 'ready',
    queryFn: async () => unwrap(await window.youtrace.data.getPendingMigration())
  })
  const effortRecovery = useQuery({
    queryKey: ['pending-effort-recovery'],
    enabled: state?.status === 'ready',
    queryFn: async () => unwrap(await window.youtrace.execution.getPendingRecovery())
  })

  useEffect(
    () =>
      window.youtrace.app.onWorkspaceUnavailable((issue) => {
        setWorkspaceIssue(issue)
        setWorkspaceIssueOpen(true)
      }),
    []
  )

  if (bootstrap.isPending) {
    return (
      <div className="app-frame">
        <TitleBar />
        <main className="boot-screen" aria-live="polite">
          <div className="boot-mark" aria-hidden="true">
            <span />
          </div>
          <p>正在检查工作区…</p>
        </main>
      </div>
    )
  }

  if (bootstrap.isError || !state) {
    return (
      <div className="app-frame">
        <TitleBar />
        <main className="fatal-screen">
          <span className="eyebrow">启动未完成</span>
          <h1>无法读取应用状态</h1>
          <p>{bootstrap.error instanceof Error ? bootstrap.error.message : '请重新启动有迹。'}</p>
          <button className="button button-primary" onClick={() => void bootstrap.refetch()}>
            重新检查
          </button>
        </main>
      </div>
    )
  }

  if (state.status === 'database-recovery') {
    return (
      <div className="app-frame">
        <TitleBar />
        <DatabaseRecoveryScreen
          recovery={state.recovery}
          onReady={(workspace) => setLocalState({ status: 'ready', workspace })}
          onChooseAnother={() =>
            setLocalState({ status: 'needs-workspace', workspace: null })
          }
        />
      </div>
    )
  }

  if (state.status !== 'ready') {
    return (
      <div className="app-frame">
        <TitleBar />
        <Onboarding initialState={state} onReady={(workspace) => setLocalState({ status: 'ready', workspace })} />
      </div>
    )
  }

  const recoverWorkspace = (workspace: WorkspaceSummary): void => {
    setLocalState({ status: 'ready', workspace })
    setWorkspaceIssue(null)
    setWorkspaceIssueOpen(false)
  }

  return (
    <div className="app-frame">
      <div
        className="workspace-interaction-layer"
        inert={Boolean(
          (workspaceIssue && workspaceIssueOpen) ||
            migrationRecovery.data ||
            effortRecovery.data
        )}
      >
        <TitleBar workspaceName={state.workspace.name} />
        {workspaceIssue ? (
          <div className="workspace-disconnect-banner" role="status">
            <AlertTriangle size={16} />
            <span>工作区连接已中断，写入已经停止；当前页面草稿仍保留。</span>
            <button type="button" onClick={() => setWorkspaceIssueOpen(true)}>
              重新定位
            </button>
          </div>
        ) : null}
        <AppShell
          workspace={state.workspace}
          onWorkspaceChange={(workspace) => setLocalState({ status: 'ready', workspace })}
        />
      </div>
      {workspaceIssue && workspaceIssueOpen ? (
        <WorkspaceDisconnectDialog
          issue={workspaceIssue}
          onKeepDraft={() => setWorkspaceIssueOpen(false)}
          onRecovered={recoverWorkspace}
        />
      ) : null}
      {!workspaceIssue && migrationRecovery.data ? (
        <MigrationRecoveryDialog
          recovery={migrationRecovery.data}
          onRecovered={recoverWorkspace}
          onResolved={async () => {
            await migrationRecovery.refetch()
          }}
        />
      ) : null}
      {!workspaceIssue && !migrationRecovery.data && effortRecovery.data ? (
        <EffortRecoveryDialog
          recovery={effortRecovery.data}
          onResolved={async () => {
            await effortRecovery.refetch()
          }}
        />
      ) : null}
    </div>
  )
}

interface DatabaseRecoveryScreenProps {
  recovery: DatabaseRecoveryState
  onReady: (workspace: WorkspaceSummary) => void
  onChooseAnother: () => void
}

function DatabaseRecoveryScreen({
  recovery,
  onReady,
  onChooseAnother
}: DatabaseRecoveryScreenProps): React.JSX.Element {
  const [busy, setBusy] = useState<'confirm' | 'report' | null>(null)
  const [error, setError] = useState('')

  const confirmRecovery = async (): Promise<void> => {
    setBusy('confirm')
    setError('')
    const result = await window.youtrace.workspace.confirmDatabaseRecovery(recovery.id)
    setBusy(null)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    onReady(result.data)
  }

  const revealReport = async (): Promise<void> => {
    setBusy('report')
    setError('')
    const result = await window.youtrace.workspace.revealDatabaseRecoveryReport()
    setBusy(null)
    if (!result.ok) setError(result.error.message)
  }

  return (
    <main className="database-recovery-screen">
      <section
        className="workspace-disconnect-dialog database-recovery-dialog"
        aria-labelledby="database-recovery-title"
      >
        <div className="workspace-disconnect-icon" aria-hidden="true">
          <AlertTriangle size={24} />
        </div>
        <div>
          <span className="section-label">危险写入已停止</span>
          <h1 id="database-recovery-title">工作区数据库未通过完整性检查</h1>
          <p>
            原数据库和最近备份都没有被删除。有迹已保存损坏文件的只读副本，并在独立目录中检查可恢复备份。
          </p>
        </div>
        <dl className="migration-recovery-details">
          <div>
            <dt>原工作区</dt>
            <dd>{recovery.sourcePath}</dd>
          </div>
          <div>
            <dt>损坏副本</dt>
            <dd>{recovery.preservedDatabasePath ?? '未找到可复制的数据库文件'}</dd>
          </div>
          <div>
            <dt>恢复候选</dt>
            <dd>{recovery.candidateWorkspacePath ?? '没有找到可独立打开的已验证备份'}</dd>
          </div>
        </dl>
        <div className="database-recovery-scope">
          <strong>受影响范围</strong>
          <ul>
            {recovery.affectedScope.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
        {recovery.failures.length > 0 ? (
          <details>
            <summary>查看未采用的备份检查结果（{recovery.failures.length}）</summary>
            <ul>{recovery.failures.map((failure) => <li key={failure}>{failure}</li>)}</ul>
          </details>
        ) : null}
        {error ? <div className="inline-error" role="alert">{error}</div> : null}
        <div className="workspace-disconnect-actions">
          <button
            type="button"
            className="button button-secondary"
            disabled={busy !== null}
            onClick={() => void revealReport()}
          >
            <FolderOpen size={15} />
            打开恢复报告
          </button>
          <button
            type="button"
            className="button button-secondary"
            disabled={busy !== null}
            onClick={onChooseAnother}
          >
            选择其他工作区
          </button>
          <button
            type="button"
            className="button button-primary"
            disabled={busy !== null || !recovery.candidateWorkspacePath}
            onClick={() => void confirmRecovery()}
          >
            <RefreshCw size={15} />
            {busy === 'confirm' ? '正在再次验证…' : '确认切换到恢复副本'}
          </button>
        </div>
      </section>
    </main>
  )
}

interface EffortRecoveryDialogProps {
  recovery: InterruptedEffortRecovery
  onResolved: () => Promise<void>
}

function EffortRecoveryDialog({
  recovery,
  onResolved
}: EffortRecoveryDialogProps): React.JSX.Element {
  const [endedAt, setEndedAt] = useState(toLocalDateTimeInput(recovery.lastHeartbeatAt))
  const [busy, setBusy] = useState<InterruptedEffortRecoveryAction['action'] | null>(null)
  const [error, setError] = useState('')

  const resolveRecovery = async (
    action: InterruptedEffortRecoveryAction['action']
  ): Promise<void> => {
    setBusy(action)
    setError('')
    const input: InterruptedEffortRecoveryAction =
      action === 'stop'
        ? { action, endedAt: new Date(endedAt).toISOString() }
        : { action }
    const result = await window.youtrace.execution.resolvePendingRecovery(input)
    setBusy(null)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    await onResolved()
  }

  return (
    <div className="workspace-disconnect-overlay">
      <section
        className="workspace-disconnect-dialog effort-recovery-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="effort-recovery-title"
        aria-describedby="effort-recovery-description"
      >
        <div className="workspace-disconnect-icon" aria-hidden="true">
          <AlertTriangle size={24} />
        </div>
        <div>
          <span className="section-label">离线时间已排除</span>
          <h1 id="effort-recovery-title">发现一段异常中断的计时</h1>
          <p id="effort-recovery-description">
            有迹已将它暂停在最后一次可靠记录处，没有把程序关闭后的时间计入努力。请确认如何继续。
          </p>
        </div>
        <dl className="migration-recovery-details">
          <div>
            <dt>事项</dt>
            <dd>{recovery.entityTitle ?? '当前事项'}</dd>
          </div>
          <div>
            <dt>开始时间</dt>
            <dd>{formatRecoveryTime(recovery.startedAt)}</dd>
          </div>
          <div>
            <dt>可靠记录</dt>
            <dd>{formatRecoveryTime(recovery.lastHeartbeatAt)}</dd>
          </div>
        </dl>
        <label>
          <span>如果已经做完，确认实际结束时间</span>
          <input
            className="effort-recovery-time"
            type="datetime-local"
            step={1}
            min={toLocalDateTimeInput(recovery.startedAt)}
            max={toLocalDateTimeInput(recovery.detectedAt)}
            value={endedAt}
            onChange={(event) => setEndedAt(event.target.value)}
          />
        </label>
        {error ? <div className="inline-error" role="alert">{error}</div> : null}
        <div className="workspace-disconnect-actions">
          <button
            type="button"
            className="button button-secondary"
            disabled={busy !== null}
            onClick={() => void resolveRecovery('retain')}
          >
            保留为暂停
          </button>
          <button
            type="button"
            className="button button-secondary"
            disabled={busy !== null}
            onClick={() => void resolveRecovery('resume')}
          >
            现在继续计时
          </button>
          <button
            type="button"
            className="button button-primary"
            disabled={busy !== null || !endedAt}
            onClick={() => void resolveRecovery('stop')}
          >
            {busy === 'stop' ? '正在保存…' : '按此时间停止'}
          </button>
        </div>
      </section>
    </div>
  )
}

function toLocalDateTimeInput(value: string): string {
  const date = new Date(value)
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 19)
}

function formatRecoveryTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'medium'
  }).format(new Date(value))
}

interface MigrationRecoveryDialogProps {
  recovery: MigrationRecoveryState
  onRecovered: (workspace: WorkspaceSummary) => void
  onResolved: () => Promise<void>
}

function MigrationRecoveryDialog({
  recovery,
  onRecovered,
  onResolved
}: MigrationRecoveryDialogProps): React.JSX.Element {
  const [busy, setBusy] = useState<MigrationRecoveryAction | 'report' | null>(null)
  const [error, setError] = useState('')

  const resolveRecovery = async (action: MigrationRecoveryAction): Promise<void> => {
    setBusy(action)
    setError('')
    const result = await window.youtrace.data.resolvePendingMigration(action)
    setBusy(null)
    if (!result.ok) {
      setError(
        result.error.recovery
          ? `${result.error.message} ${result.error.recovery}`
          : result.error.message
      )
      return
    }
    if (result.data) onRecovered(result.data.workspace)
    await onResolved()
  }

  const revealReport = async (): Promise<void> => {
    setBusy('report')
    setError('')
    const result = await window.youtrace.data.revealPendingMigrationReport()
    setBusy(null)
    if (!result.ok) setError(result.error.message)
  }

  return (
    <div className="workspace-disconnect-overlay">
      <section
        className="workspace-disconnect-dialog migration-recovery-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="migration-recovery-title"
        aria-describedby="migration-recovery-description"
      >
        <div className="workspace-disconnect-icon" aria-hidden="true">
          <AlertTriangle size={24} />
        </div>
        <div>
          <span className="section-label">源工作区仍在使用</span>
          <h1 id="migration-recovery-title">上次迁移没有完成</h1>
          <p id="migration-recovery-description">
            有迹没有切换到不完整目标。你可以继续使用源工作区、删除已标记的失败副本，或从干净目标重新迁移。
          </p>
        </div>
        <dl className="migration-recovery-details">
          <div>
            <dt>源工作区</dt>
            <dd>{recovery.sourcePath}</dd>
          </div>
          <div>
            <dt>失败目标</dt>
            <dd>{recovery.targetPath}</dd>
          </div>
          <div>
            <dt>失败原因</dt>
            <dd>{recovery.failureReason ?? '迁移在完成前中断。'}</dd>
          </div>
        </dl>
        {error ? <div className="inline-error" role="alert">{error}</div> : null}
        <div className="workspace-disconnect-actions migration-recovery-actions">
          <button
            type="button"
            className="button button-secondary"
            disabled={busy !== null}
            onClick={() => void revealReport()}
          >
            <FolderOpen size={15} />
            打开报告目录
          </button>
          <button
            type="button"
            className="button button-secondary"
            disabled={busy !== null}
            onClick={() => void resolveRecovery('return')}
          >
            继续使用源工作区
          </button>
          <button
            type="button"
            className="button button-danger"
            disabled={busy !== null}
            onClick={() => void resolveRecovery('discard')}
          >
            删除失败副本
          </button>
          <button
            type="button"
            className="button button-primary"
            disabled={busy !== null}
            onClick={() => void resolveRecovery('retry')}
          >
            <RefreshCw size={15} />
            {busy === 'retry' ? '正在重新迁移…' : '清理并重新迁移'}
          </button>
        </div>
      </section>
    </div>
  )
}

interface WorkspaceDisconnectDialogProps {
  issue: WorkspaceUnavailableState
  onKeepDraft: () => void
  onRecovered: (workspace: WorkspaceSummary) => void
}

function WorkspaceDisconnectDialog({
  issue,
  onKeepDraft,
  onRecovered
}: WorkspaceDisconnectDialogProps): React.JSX.Element {
  const [selectedPath, setSelectedPath] = useState(issue.lastPath)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const chooseDirectory = async (): Promise<void> => {
    setError('')
    const result = await window.youtrace.dialog.selectDirectory()
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    if (result.data) setSelectedPath(result.data)
  }

  const reconnect = async (): Promise<void> => {
    if (!selectedPath.trim()) {
      setError('请先选择原工作区或它的完整副本。')
      return
    }
    setBusy(true)
    setError('')
    const result = await window.youtrace.workspace.reconnect({
      rootPath: selectedPath
    })
    setBusy(false)
    if (!result.ok) {
      setError(
        result.error.recovery
          ? `${result.error.message} ${result.error.recovery}`
          : result.error.message
      )
      return
    }
    onRecovered(result.data)
  }

  return (
    <div className="workspace-disconnect-overlay">
      <section
        className="workspace-disconnect-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="workspace-disconnect-title"
        aria-describedby="workspace-disconnect-description"
      >
        <div className="workspace-disconnect-icon" aria-hidden="true">
          <AlertTriangle size={24} />
        </div>
        <div>
          <span className="section-label">写入保护已启用</span>
          <h1 id="workspace-disconnect-title">工作区连接已中断</h1>
          <p id="workspace-disconnect-description">
            有迹没有继续写入原路径。当前页面和未提交文字仍保留，可先返回页面复制草稿，再重新定位原工作区。
          </p>
        </div>
        <div className="workspace-disconnect-reason" role="status">
          <strong>检测结果</strong>
          <span>{issue.reason}</span>
        </div>
        <label>
          <span>原工作区或完整副本</span>
          <div className="workspace-disconnect-path">
            <input
              autoFocus
              aria-label="重新定位的工作区路径"
              value={selectedPath}
              onChange={(event) => setSelectedPath(event.target.value)}
            />
            <button type="button" onClick={() => void chooseDirectory()}>
              <FolderOpen size={16} />
              选择文件夹
            </button>
          </div>
        </label>
        {error ? <div className="inline-error" role="alert">{error}</div> : null}
        <div className="workspace-disconnect-actions">
          <button type="button" className="button button-secondary" onClick={onKeepDraft}>
            返回页面复制草稿
          </button>
          <button
            type="button"
            className="button button-primary"
            disabled={busy}
            onClick={() => void reconnect()}
          >
            <RefreshCw size={15} />
            {busy ? '正在验证…' : '验证并重新连接'}
          </button>
        </div>
      </section>
    </div>
  )
}
