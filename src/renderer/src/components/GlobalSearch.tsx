import * as Dialog from '@radix-ui/react-dialog'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { BookmarkPlus, FileText, Filter, Layers3, Pencil, Search, Tag, TimerReset, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { IpcResult, ParsedSearchInput, SearchResult } from '../../../shared/contracts'
import { QueryFailure } from './QueryFeedback'

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
  const [status, setStatus] = useState('')
  const [projectId, setProjectId] = useState('')
  const [tagId, setTagId] = useState('')
  const [difficulty, setDifficulty] = useState('')
  const [priority, setPriority] = useState('')
  const [dueFrom, setDueFrom] = useState('')
  const [dueTo, setDueTo] = useState('')
  const [overdueOnly, setOverdueOnly] = useState(false)
  const [untaggedOnly, setUntaggedOnly] = useState(false)
  const [hasEvidence, setHasEvidence] = useState('')
  const [saveName, setSaveName] = useState('')
  const [saving, setSaving] = useState(false)
  const [editingViewId, setEditingViewId] = useState('')
  const [actionError, setActionError] = useState('')
  const queryClient = useQueryClient()

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedQuery(query.trim()), 160)
    return () => window.clearTimeout(timeout)
  }, [query])

  const filters = useMemo<ParsedSearchInput>(() => ({
    query: debouncedQuery,
    entityTypes: [],
    statuses: status ? [status as ParsedSearchInput['statuses'][number]] : [],
    tagIds: tagId ? [tagId] : [],
    projectId: projectId || null,
    dueFrom: dueFrom || null,
    dueTo: dueTo || null,
    difficulties: difficulty ? [Number(difficulty)] : [],
    priorities: priority ? [priority as ParsedSearchInput['priorities'][number]] : [],
    overdueOnly,
    untaggedOnly,
    hasEvidence: hasEvidence === '' ? null : hasEvidence === 'yes',
    limit: 40
  }), [
    debouncedQuery,
    difficulty,
    dueFrom,
    dueTo,
    hasEvidence,
    overdueOnly,
    priority,
    projectId,
    status,
    tagId,
    untaggedOnly
  ])
  const hasFilters =
    status !== '' ||
    projectId !== '' ||
    tagId !== '' ||
    difficulty !== '' ||
    priority !== '' ||
    dueFrom !== '' ||
    dueTo !== '' ||
    overdueOnly ||
    untaggedOnly ||
    hasEvidence !== ''
  const projectsQuery = useQuery({
    queryKey: ['projects'],
    enabled: open,
    queryFn: async () => unwrap(await window.youtrace.planning.listProjects())
  })
  const tagsQuery = useQuery({
    queryKey: ['tags'],
    enabled: open,
    queryFn: async () => unwrap(await window.youtrace.planning.listTags())
  })
  const savedViewsQuery = useQuery({
    queryKey: ['saved-views'],
    enabled: open,
    queryFn: async () => unwrap(await window.youtrace.planning.listSavedViews())
  })
  const resultsQuery = useQuery({
    queryKey: ['global-search', filters],
    enabled: open && (debouncedQuery.length > 0 || hasFilters),
    queryFn: async () =>
      unwrap(await window.youtrace.planning.search(filters))
  })

  const results = resultsQuery.data ?? []
  const applyView = (view: ParsedSearchInput): void => {
    setQuery(view.query)
    setDebouncedQuery(view.query)
    setStatus(view.statuses[0] ?? '')
    setProjectId(view.projectId ?? '')
    setTagId(view.tagIds[0] ?? '')
    setDifficulty(view.difficulties[0]?.toString() ?? '')
    setPriority(view.priorities[0] ?? '')
    setDueFrom(view.dueFrom ?? '')
    setDueTo(view.dueTo ?? '')
    setOverdueOnly(view.overdueOnly)
    setUntaggedOnly(view.untaggedOnly)
    setHasEvidence(view.hasEvidence === null ? '' : view.hasEvidence ? 'yes' : 'no')
  }
  const saveView = async (): Promise<void> => {
    if (!saveName.trim()) return
    setSaving(true)
    const result = editingViewId
      ? await window.youtrace.planning.updateSavedView({ id: editingViewId, name: saveName, filters })
      : await window.youtrace.planning.saveView({ name: saveName, filters })
    setSaving(false)
    if (!result.ok) return setActionError(result.error.message)
    setActionError('')
    setSaveName('')
    setEditingViewId('')
    await queryClient.invalidateQueries({ queryKey: ['saved-views'] })
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) {
          setQuery('')
          setDebouncedQuery('')
        }
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
          <div className="search-saved-views" aria-label="保存的视图">
            {(savedViewsQuery.data ?? []).map((view) => (
              <span key={view.id}>
                <button type="button" onClick={() => applyView(view.filters)}>{view.name}</button>
                {!view.isPreset && (
                  <><button
                    type="button"
                    aria-label={`编辑视图：${view.name}`}
                    onClick={() => {
                      applyView(view.filters)
                      setSaveName(view.name)
                      setEditingViewId(view.id)
                    }}
                  >
                    <Pencil size={10} />
                  </button><button
                    type="button"
                    aria-label={`删除视图：${view.name}`}
                    onClick={async () => {
                      const result = await window.youtrace.planning.deleteSavedView(view.id)
                      if (!result.ok) return setActionError(result.error.message)
                      setActionError('')
                      if (editingViewId === view.id) { setEditingViewId(''); setSaveName('') }
                      await queryClient.invalidateQueries({ queryKey: ['saved-views'] })
                    }}
                  >
                    <Trash2 size={10} />
                  </button></>
                )}
              </span>
            ))}
          </div>
          {(projectsQuery.isError || tagsQuery.isError || savedViewsQuery.isError) && (
            <QueryFailure
              compact
              title="搜索筛选条件读取失败"
              detail="搜索正文仍可继续使用；重新读取后项目、标签和保存视图会恢复。"
              onRetry={() => void Promise.all([
                projectsQuery.refetch(),
                tagsQuery.refetch(),
                savedViewsQuery.refetch()
              ])}
            />
          )}
          {actionError && <div className="inline-error" role="alert">{actionError}</div>}
          <div className="search-filter-grid" aria-label="组合筛选">
            <span className="search-filter-label"><Filter size={13} />筛选</span>
            <select aria-label="筛选状态" value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">全部状态</option><option value="ready">待安排</option><option value="scheduled">已安排</option><option value="in_progress">进行中</option><option value="blocked">阻塞</option><option value="completed">已完成</option>
            </select>
            <select aria-label="筛选项目" value={projectId} onChange={(event) => setProjectId(event.target.value)}>
              <option value="">全部项目</option>{(projectsQuery.data ?? []).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
            <select aria-label="筛选标签" value={tagId} onChange={(event) => { setTagId(event.target.value); if (event.target.value) setUntaggedOnly(false) }}>
              <option value="">全部标签</option>{(tagsQuery.data ?? []).map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
            </select>
            <select aria-label="筛选难度" value={difficulty} onChange={(event) => setDifficulty(event.target.value)}>
              <option value="">全部难度</option>{[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>难度 {value}</option>)}
            </select>
            <select aria-label="筛选优先级" value={priority} onChange={(event) => setPriority(event.target.value)}>
              <option value="">全部优先级</option><option value="low">低</option><option value="medium">中</option><option value="high">高</option><option value="critical">关键</option>
            </select>
            <input aria-label="截止起始日期" type="date" value={dueFrom} onChange={(event) => setDueFrom(event.target.value)} />
            <input aria-label="截止结束日期" type="date" value={dueTo} onChange={(event) => setDueTo(event.target.value)} />
            <select aria-label="筛选证据" value={hasEvidence} onChange={(event) => setHasEvidence(event.target.value)}>
              <option value="">证据不限</option><option value="yes">已有证据</option><option value="no">没有证据</option>
            </select>
            <label><input type="checkbox" checked={overdueOnly} onChange={(event) => setOverdueOnly(event.target.checked)} />只看逾期</label>
            <label><input type="checkbox" checked={untaggedOnly} onChange={(event) => { setUntaggedOnly(event.target.checked); if (event.target.checked) setTagId('') }} />没有标签</label>
            <div className="search-save-view">
              <input aria-label="视图名称" value={saveName} onChange={(event) => setSaveName(event.target.value)} placeholder="命名当前筛选" />
              {editingViewId && <button type="button" onClick={() => { setEditingViewId(''); setSaveName('') }}>取消编辑</button>}
              <button type="button" disabled={!saveName.trim() || saving} onClick={() => void saveView()}>{editingViewId ? <Pencil size={13} /> : <BookmarkPlus size={13} />}{editingViewId ? '更新' : '保存'}</button>
            </div>
          </div>
          <div className="global-search-results">
            {!debouncedQuery && !hasFilters ? (
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
            ) : resultsQuery.isError ? (
              <QueryFailure
                title="搜索暂时失败"
                detail="索引和业务数据没有被删除，请重新搜索。"
                onRetry={() => void resultsQuery.refetch()}
              />
            ) : results.length === 0 ? (
              <div className="search-state">
                <strong>没有找到符合条件的内容</strong>
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
