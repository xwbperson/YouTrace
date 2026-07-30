import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, FolderOpen, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import type {
  AppBootstrapState,
  IpcResult,
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

  useEffect(
    () =>
      window.youtrace.app.onWorkspaceUnavailable((issue) => {
        setWorkspaceIssue(issue)
        setWorkspaceIssueOpen(true)
      }),
    []
  )

  const state = localState ?? bootstrap.data

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
        inert={Boolean(workspaceIssue && workspaceIssueOpen)}
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
