import { AlertTriangle, RefreshCw } from 'lucide-react'

export function QueryFailure({
  title,
  detail,
  error,
  onRetry,
  retryLabel = '重新读取',
  compact = false
}: {
  title: string
  detail?: string
  error?: unknown
  onRetry: () => void
  retryLabel?: string
  compact?: boolean
}): React.JSX.Element {
  const message = detail ?? (error instanceof Error ? error.message : typeof error === 'string' ? error : '数据没有被清空，请重新读取。')
  return (
    <div className={`query-failure${compact ? ' compact' : ''}`} role="alert">
      <AlertTriangle size={compact ? 15 : 18} />
      <div>
        <strong>{title}</strong>
        <span>{message}</span>
      </div>
      <button type="button" onClick={onRetry}>
        <RefreshCw size={13} />
        {retryLabel}
      </button>
    </div>
  )
}
