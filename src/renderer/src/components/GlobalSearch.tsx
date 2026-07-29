import * as Dialog from '@radix-ui/react-dialog'
import { useQuery } from '@tanstack/react-query'
import { FileText, Layers3, Search, Tag, TimerReset, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { IpcResult, SearchResult } from '../../../shared/contracts'

function unwrap<T>(result: IpcResult<T>): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.data
}

export function GlobalSearch({
  open,
  onOpenChange,
  onNavigate
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onNavigate: (entityType: string, entityId: string) => void
}): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedQuery(query.trim()), 160)
    return () => window.clearTimeout(timeout)
  }, [query])

  const resultsQuery = useQuery({
    queryKey: ['global-search', debouncedQuery],
    enabled: open && debouncedQuery.length > 0,
    queryFn: async () =>
      unwrap(
        await window.youtrace.planning.search({
          query: debouncedQuery,
          entityTypes: [],
          limit: 40
        })
      )
  })

  const results = resultsQuery.data ?? []

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) setQuery('')
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay search-overlay" />
        <Dialog.Content className="global-search-dialog">
          <Dialog.Title className="sr-only">全局搜索</Dialog.Title>
          <div className="global-search-input">
            <Search size={19} />
            <input
              autoFocus
              aria-label="搜索目标、任务和记录"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索目标、任务、备忘、投入和成果…"
            />
            <kbd>Esc</kbd>
          </div>
          <div className="global-search-results">
            {!debouncedQuery ? (
              <div className="search-guidance">
                <span className="section-label">跨模块搜索</span>
                <p>输入中文短词、中英文标题或正文。业务表是事实来源，索引可以随时重建。</p>
                <div>
                  <span><Layers3 size={14} />项目与里程碑</span>
                  <span><FileText size={14} />任务与备忘</span>
                  <span><TimerReset size={14} />投入与成果</span>
                </div>
              </div>
            ) : resultsQuery.isPending ? (
              <div className="search-state">正在搜索…</div>
            ) : results.length === 0 ? (
              <div className="search-state">
                <strong>没有找到“{debouncedQuery}”</strong>
                <span>可以尝试更短的词，或检查内容是否已进入回收站。</span>
              </div>
            ) : (
              <>
                <div className="search-result-count">{results.length} 个结果</div>
                {results.map((result) => (
                  <button
                    key={`${result.entityType}:${result.entityId}`}
                    className="search-result"
                    onClick={() => {
                      onNavigate(result.entityType, result.entityId)
                      onOpenChange(false)
                    }}
                  >
                    <span className="search-result-icon">{iconFor(result)}</span>
                    <span>
                      <strong>{result.title}</strong>
                      <small>{result.snippet || entityLabel(result.entityType)}</small>
                    </span>
                    <em>{entityLabel(result.entityType)}</em>
                  </button>
                ))}
              </>
            )}
          </div>
          <footer className="search-footer">
            <span><kbd>↑</kbd><kbd>↓</kbd> 浏览</span>
            <span><kbd>Enter</kbd> 打开</span>
            <Dialog.Close className="search-close"><X size={14} />关闭</Dialog.Close>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function iconFor(result: SearchResult): React.JSX.Element {
  if (result.entityType === 'project' || result.entityType === 'milestone') return <Layers3 size={16} />
  if (result.entityType === 'effort') return <TimerReset size={16} />
  if (result.entityType === 'tag') return <Tag size={16} />
  return <FileText size={16} />
}

function entityLabel(type: string): string {
  return {
    project: '项目',
    goal: '目标',
    milestone: '里程碑',
    task: '任务',
    memo: '备忘',
    evidence: '成果',
    effort: '投入'
  }[type] ?? type
}
