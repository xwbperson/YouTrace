import { useQuery } from '@tanstack/react-query'
import { ChevronRight, Plus } from 'lucide-react'
import type { IpcResult } from '../../../shared/contracts'
import { CountdownCard } from '../pages/CalendarPage'
import { QueryFailure } from './QueryFeedback'

function unwrap<T>(result: IpcResult<T>): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.data
}

export function CountdownSummary({ onOpenCalendar }: { onOpenCalendar: () => void }): React.JSX.Element {
  const query = useQuery({
    queryKey: ['countdowns'],
    queryFn: async () => unwrap(await window.youtrace.temporal.listCountdowns(new Date().toISOString()))
  })
  const countdowns = (query.data ?? []).slice(0, 3)
  return (
    <section className="countdowns panel">
      <div className="panel-heading compact">
        <div><span className="section-label">临近时刻</span><h2>倒计时</h2></div>
        <button className="icon-action" type="button" aria-label="管理倒计时" onClick={onOpenCalendar}>{countdowns.length > 0 ? <ChevronRight size={17} /> : <Plus size={17} />}</button>
      </div>
      {query.isPending ? (
        <p className="rail-message">正在读取倒计时…</p>
      ) : query.isError ? (
        <QueryFailure compact title="倒计时加载失败" error={query.error} onRetry={() => void query.refetch()} />
      ) : countdowns.length === 0 ? <button className="countdown-empty" type="button" onClick={onOpenCalendar}><span className="countdown-number">—</span><p>建立一个明确期限后，这里会显示剩余时间和所需速度。</p></button> : <div className="home-countdown-list">{countdowns.map((countdown) => <CountdownCard key={countdown.id} countdown={countdown} compact />)}</div>}
    </section>
  )
}
