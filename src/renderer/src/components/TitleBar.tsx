import * as Dialog from '@radix-ui/react-dialog'
import { Clock3, Copy, Maximize2, Minus, Power, X } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import type { EffortEntry, WindowResizeEdge, WindowState } from '../../../shared/contracts'

interface TitleBarProps {
  workspaceName?: string
}

export function TitleBar({ workspaceName }: TitleBarProps): React.JSX.Element {
  const [windowState, setWindowState] = useState<WindowState>({
    maximized: false,
    focused: true
  })
  const [quitOpen, setQuitOpen] = useState(false)
  const [activeEffort, setActiveEffort] = useState<EffortEntry | null>(null)
  const [quitLoading, setQuitLoading] = useState(false)
  const [quitBusy, setQuitBusy] = useState<'stop' | 'suspend' | 'quit' | null>(null)
  const [quitError, setQuitError] = useState('')
  const preferencesQuery = useQuery({
    queryKey: ['user-preferences'],
    enabled: Boolean(workspaceName),
    queryFn: async () => {
      const result = await window.youtrace.settings.getPreferences()
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    }
  })
  const closesToTray = preferencesQuery.data?.closeBehavior !== 'quit'

  useEffect(() => {
    void window.youtrace.window.getState().then((result) => {
      if (result.ok) setWindowState(result.data)
    })
    return window.youtrace.window.onStateChanged(setWindowState)
  }, [])

  const requestQuit = async (): Promise<void> => {
    setQuitOpen(true)
    setQuitLoading(true)
    setQuitError('')
    const result = await window.youtrace.execution.getActiveEffort()
    setQuitLoading(false)
    if (result.ok) {
      setActiveEffort(result.data)
      return
    }
    setActiveEffort(null)
    if (workspaceName) {
      setQuitError('无法检查当前计时。你仍可直接退出，未结束会话会在下次启动时进入恢复流程。')
    }
  }

  useEffect(() => window.youtrace.window.onQuitRequested(() => void requestQuit()), [workspaceName])

  const confirmQuit = async (action: 'stop' | 'suspend' | 'quit'): Promise<void> => {
    setQuitBusy(action)
    setQuitError('')
    if (activeEffort && action === 'stop') {
      const result = await window.youtrace.execution.stopEffort({
        id: activeEffort.id,
        result: '退出程序时保存',
        interruptions: '',
        obstacles: '',
        nextStep: '',
        energy: null,
        perceivedDifficulty: null
      })
      if (!result.ok) {
        setQuitBusy(null)
        setQuitError(result.error.message)
        return
      }
    } else if (activeEffort && action === 'suspend') {
      const result = await window.youtrace.execution.suspendEffort(activeEffort.id)
      if (!result.ok) {
        setQuitBusy(null)
        setQuitError(result.error.message)
        return
      }
    }
    const result = await window.youtrace.window.quit()
    if (!result.ok) {
      setQuitBusy(null)
      setQuitError(result.error.message)
    }
  }

  return (
    <>
    <header className={`titlebar${windowState.focused ? '' : ' titlebar-unfocused'}`}>
      <div className="titlebar-drag">
        <div className="app-glyph" aria-hidden="true">
          <span />
        </div>
        <span className="titlebar-product">有迹</span>
        {workspaceName && (
          <>
            <span className="titlebar-divider" />
            <span className="titlebar-workspace">{workspaceName}</span>
          </>
        )}
      </div>
      <div className="window-controls">
        <button
          type="button"
          aria-label="最小化窗口"
          title="最小化"
          onClick={() => void window.youtrace.window.minimize()}
        >
          <Minus size={16} strokeWidth={1.7} />
        </button>
        <button
          type="button"
          aria-label={windowState.maximized ? '还原窗口' : '最大化窗口'}
          title={windowState.maximized ? '还原' : '最大化'}
          onClick={async () => {
            const result = await window.youtrace.window.toggleMaximize()
            if (result.ok) setWindowState(result.data)
          }}
        >
          {windowState.maximized ? (
            <Copy size={13} strokeWidth={1.7} />
          ) : (
            <Maximize2 size={14} strokeWidth={1.7} />
          )}
        </button>
        <button
          type="button"
          className="window-close"
          aria-label={closesToTray ? '关闭窗口并保留后台运行' : '关闭窗口并退出程序'}
          title={closesToTray ? '最小化到托盘' : '直接退出程序'}
          onClick={() => {
            if (closesToTray) void window.youtrace.window.close()
            else void requestQuit()
          }}
        >
          <X size={17} strokeWidth={1.7} />
        </button>
      </div>
    </header>
    <Dialog.Root open={quitOpen} onOpenChange={(open) => { if (!quitBusy) setQuitOpen(open) }}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content quit-dialog">
          <div className="dialog-heading">
            <div>
              <span className="section-label">退出前确认</span>
              <Dialog.Title>
                {activeEffort ? `“${activeEffort.entityTitle ?? '当前事项'}”仍在计时` : '退出有迹？'}
              </Dialog.Title>
              <Dialog.Description>
                {activeEffort
                  ? '你可以把这段投入保存到当前时刻，或暂停后在下次启动时继续；退出后的离线时间不会计入努力。'
                  : '退出后后台提醒会停止；下次启动时会重新计算并汇总错过的提醒。'}
              </Dialog.Description>
            </div>
            <Dialog.Close className="dialog-close" aria-label="关闭" disabled={quitBusy !== null}>
              <X size={18} />
            </Dialog.Close>
          </div>
          {quitLoading ? (
            <div className="quit-dialog-loading" role="status">
              <Clock3 size={18} />
              正在检查当前计时…
            </div>
          ) : null}
          {quitError ? <div className="inline-error" role="alert">{quitError}</div> : null}
          <div className="dialog-actions quit-dialog-actions">
            <Dialog.Close className="button button-secondary" disabled={quitBusy !== null}>取消</Dialog.Close>
            {activeEffort ? (
              <>
                <button
                  className="button button-secondary"
                  type="button"
                  disabled={quitLoading || quitBusy !== null}
                  onClick={() => void confirmQuit('suspend')}
                >
                  {quitBusy === 'suspend' ? '正在暂停…' : '暂停计时并退出'}
                </button>
                <button
                  className="button button-primary"
                  type="button"
                  disabled={quitLoading || quitBusy !== null}
                  onClick={() => void confirmQuit('stop')}
                >
                  <Power size={15} />
                  {quitBusy === 'stop' ? '正在保存…' : '保存到现在并退出'}
                </button>
              </>
            ) : (
              <button
                className="button button-primary"
                type="button"
                disabled={quitLoading || quitBusy !== null}
                onClick={() => void confirmQuit('quit')}
              >
                <Power size={15} />
                {quitBusy === 'quit' ? '正在退出…' : '退出程序'}
              </button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
    {!windowState.maximized &&
      ([
        'north',
        'south',
        'east',
        'west',
        'north-east',
        'north-west',
        'south-east',
        'south-west'
      ] as WindowResizeEdge[]).map((edge) => (
        <div
          key={edge}
          className={`window-resize-handle resize-${edge}`}
          aria-hidden="true"
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId)
            window.youtrace.window.startResize(edge, event.screenX, event.screenY)
          }}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              window.youtrace.window.moveResize(event.screenX, event.screenY)
            }
          }}
          onPointerUp={(event) => {
            event.currentTarget.releasePointerCapture(event.pointerId)
            window.youtrace.window.endResize()
          }}
          onPointerCancel={() => window.youtrace.window.endResize()}
        />
      ))}
    </>
  )
}
