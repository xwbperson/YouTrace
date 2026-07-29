import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import type { AppBootstrapState, IpcResult } from '../../../shared/contracts'
import { AppShell } from '../components/AppShell'
import { Onboarding } from '../pages/Onboarding'
import { TitleBar } from '../components/TitleBar'

function unwrap<T>(result: IpcResult<T>): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.data
}

export function App(): React.JSX.Element {
  const [localState, setLocalState] = useState<AppBootstrapState | null>(null)
  const bootstrap = useQuery({
    queryKey: ['bootstrap'],
    queryFn: async () => unwrap(await window.youtrace.app.getBootstrapState())
  })

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

  return (
    <div className="app-frame">
      <TitleBar workspaceName={state.workspace.name} />
      <AppShell
        workspace={state.workspace}
        onWorkspaceChange={(workspace) => setLocalState({ status: 'ready', workspace })}
      />
    </div>
  )
}
