import { Copy, Maximize2, Minus, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { WindowResizeEdge, WindowState } from '../../../shared/contracts'

interface TitleBarProps {
  workspaceName?: string
}

export function TitleBar({ workspaceName }: TitleBarProps): React.JSX.Element {
  const [windowState, setWindowState] = useState<WindowState>({
    maximized: false,
    focused: true
  })

  useEffect(() => {
    void window.youtrace.window.getState().then((result) => {
      if (result.ok) setWindowState(result.data)
    })
    return window.youtrace.window.onStateChanged(setWindowState)
  }, [])

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
          aria-label="关闭窗口并保留后台运行"
          title="关闭到托盘"
          onClick={() => void window.youtrace.window.close()}
        >
          <X size={17} strokeWidth={1.7} />
        </button>
      </div>
    </header>
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
