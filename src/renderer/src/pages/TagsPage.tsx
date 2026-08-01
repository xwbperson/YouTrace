import * as Dialog from '@radix-ui/react-dialog'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, BarChart3, Clock3, Layers3, Merge, Pencil, Plus, RotateCcw, Tag, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import type { IpcResult, Tag as TraceTag } from '../../../shared/contracts'

function unwrap<T>(result: IpcResult<T>): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.data
}

export function TagsPage(): React.JSX.Element {
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [selectedTagId, setSelectedTagId] = useState('')
  const [mergeSourceId, setMergeSourceId] = useState('')
  const [editingTag, setEditingTag] = useState<TraceTag | null>(null)
  const [deleteTag, setDeleteTag] = useState<TraceTag | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const tagsQuery = useQuery({
    queryKey: ['tags', showArchived],
    queryFn: async () => unwrap(await window.youtrace.planning.listTags(showArchived))
  })

  const tags = tagsQuery.data ?? []
  const statsQuery = useQuery({
    queryKey: ['tag-stats', selectedTagId],
    enabled: Boolean(selectedTagId),
    queryFn: async () => unwrap(await window.youtrace.planning.getTagStats(selectedTagId))
  })

  return (
    <main className="tags-page">
      <header className="tags-header">
        <div>
          <span className="page-kicker">跨模块横向关系</span>
          <h1>标签</h1>
          <p>标签可以为空，也可以多选；删除标签只解除关系，不删除业务对象。</p>
        </div>
        <div className="toolbar-actions"><label className="archive-toggle"><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} />显示已归档</label><button className="button button-primary" onClick={() => { setEditingTag(null); setDialogOpen(true) }}><Plus size={16} />新建标签</button></div>
      </header>

      {tags.length === 0 ? (
        <div className="record-empty panel tags-empty">
          <Tag size={25} />
          <strong>还没有自定义标签</strong>
          <p>创建一个横跨项目、任务、备忘、投入和成果的分类。</p>
        </div>
      ) : (
        <div className="tag-gallery">
          {tags.map((tag) => (
            <article className={`panel tag-card ${selectedTagId === tag.id ? 'selected' : ''} ${tag.archived ? 'archived' : ''}`} key={tag.id}>
              <header>
                <span style={{ background: tag.color ?? '#216E65' }} />
                <strong>{tag.name}</strong>
              </header>
              <p>{tag.description || '没有说明。'}</p>
              <footer>
                {!tag.archived && <button type="button" onClick={() => setSelectedTagId(tag.id)}><BarChart3 size={13} />查看统计</button>}
                <button type="button" onClick={() => { setEditingTag(tag); setDialogOpen(true) }}><Pencil size={13} />编辑</button>
                {!tag.archived && <button type="button" onClick={() => setMergeSourceId(tag.id)}><Merge size={13} />合并</button>}
                <button type="button" onClick={async () => { await window.youtrace.planning.archiveTag(tag.id, !tag.archived); setSelectedTagId(''); await queryClient.invalidateQueries({ queryKey: ['tags'] }) }}>{tag.archived ? <><RotateCcw size={13} />恢复</> : <><Archive size={13} />归档</>}</button>
                {tag.archived && <button type="button" className="danger" onClick={() => setDeleteTag(tag)}><Trash2 size={13} />删除</button>}
              </footer>
            </article>
          ))}
        </div>
      )}

      {statsQuery.data && (
        <section className="tag-stats-panel panel" aria-label="标签聚合统计">
          <header>
            <div><span className="section-label">对象、投入与风险保持同一标签关系</span><h2>{tags.find((tag) => tag.id === selectedTagId)?.name} 聚合</h2></div>
            <button type="button" aria-label="关闭标签统计" onClick={() => setSelectedTagId('')}><X size={15} /></button>
          </header>
          <div>
            <span><strong>{Object.values(statsQuery.data.entityCounts).reduce((sum, value) => sum + value, 0)}</strong>关联对象</span>
            <span><strong>{statsQuery.data.totalEffortMinutes}</strong>投入分钟</span>
            <span><strong>{statsQuery.data.completedTasks}</strong>完成任务</span>
            <span><strong>{statsQuery.data.atRiskCountdowns}</strong>近期期限</span>
          </div>
          <p>
            难度分布：{Object.entries(statsQuery.data.difficultyDistribution).map(([difficulty, count]) => `${difficulty}级 ${count}`).join(' · ') || '暂无任务难度数据'}
          </p>
          <footer>{Object.entries(statsQuery.data.entityCounts).map(([type, count]) => <span key={type}><Layers3 size={11} />{type} {count}</span>)}<span><Clock3 size={11} />统计只汇总真实投入</span></footer>
        </section>
      )}

      <TagDialog
        key={editingTag?.id ?? 'new-tag'}
        open={dialogOpen}
        tag={editingTag}
        onOpenChange={(open) => { setDialogOpen(open); if (!open) setEditingTag(null) }}
        onCreated={async () => {
          await queryClient.invalidateQueries({ queryKey: ['tags'] })
        }}
      />
      <DeleteTagDialog tag={deleteTag} onOpenChange={(open) => { if (!open) setDeleteTag(null) }} onDeleted={async () => { setDeleteTag(null); await Promise.all([queryClient.invalidateQueries({ queryKey: ['tags'] }), queryClient.invalidateQueries({ queryKey: ['trash'] })]) }} />
      <MergeTagDialog
        sourceId={mergeSourceId}
        tags={tags}
        onOpenChange={(open) => { if (!open) setMergeSourceId('') }}
        onMerged={async (targetId) => {
          setMergeSourceId('')
          setSelectedTagId(targetId)
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['tags'] }),
            queryClient.invalidateQueries({ queryKey: ['tag-stats'] })
          ])
        }}
      />
    </main>
  )
}

function MergeTagDialog({
  sourceId,
  tags,
  onOpenChange,
  onMerged
}: {
  sourceId: string
  tags: Array<{ id: string; name: string }>
  onOpenChange: (open: boolean) => void
  onMerged: (targetId: string) => Promise<void>
}): React.JSX.Element {
  const [targetId, setTargetId] = useState('')
  const [error, setError] = useState('')
  const merge = async (): Promise<void> => {
    const result = await window.youtrace.planning.mergeTags({
      sourceTagId: sourceId,
      targetTagId: targetId
    })
    if (!result.ok) return setError(result.error.message)
    setTargetId('')
    await onMerged(result.data.id)
  }
  const source = tags.find((tag) => tag.id === sourceId)
  return <Dialog.Root open={Boolean(sourceId)} onOpenChange={onOpenChange}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="dialog-content"><div className="dialog-heading"><div><span className="section-label">关系去重，业务对象保留</span><Dialog.Title>合并“{source?.name}”</Dialog.Title><Dialog.Description>源标签会归档，全部关联转移到目标标签。</Dialog.Description></div><Dialog.Close className="dialog-close" aria-label="关闭"><X size={18} /></Dialog.Close></div><div className="dialog-form"><label><span>目标标签</span><select value={targetId} onChange={(event) => setTargetId(event.target.value)}><option value="">请选择</option>{tags.filter((tag) => tag.id !== sourceId).map((tag) => <option value={tag.id} key={tag.id}>{tag.name}</option>)}</select></label>{error && <div className="inline-error">{error}</div>}</div><div className="dialog-actions"><Dialog.Close className="button button-secondary">取消</Dialog.Close><button className="button button-primary" disabled={!targetId} onClick={() => void merge()}><Merge size={14} />合并标签</button></div></Dialog.Content></Dialog.Portal></Dialog.Root>
}

function TagDialog({
  open,
  tag,
  onOpenChange,
  onCreated
}: {
  open: boolean
  tag: TraceTag | null
  onOpenChange: (open: boolean) => void
  onCreated: () => Promise<void>
}): React.JSX.Element {
  const [name, setName] = useState(tag?.name ?? '')
  const [color, setColor] = useState(tag?.color ?? '#216E65')
  const [description, setDescription] = useState(tag?.description ?? '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async (): Promise<void> => {
    setBusy(true)
    setError('')
    const input = {
      name,
      color,
      icon: tag?.icon ?? null,
      description
    }
    const result = tag
      ? await window.youtrace.planning.updateTag({ id: tag.id, ...input })
      : await window.youtrace.planning.createTag(input)
    setBusy(false)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    await onCreated()
    setName('')
    setDescription('')
    onOpenChange(false)
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content">
          <div className="dialog-heading">
            <div>
              <span className="section-label">全局分类</span>
              <Dialog.Title>{tag ? '编辑标签' : '新建标签'}</Dialog.Title>
              <Dialog.Description>同名活动标签不区分大小写且保持唯一。</Dialog.Description>
            </div>
            <Dialog.Close className="dialog-close" aria-label="关闭"><X size={18} /></Dialog.Close>
          </div>
          <div className="dialog-form">
            <label><span>标签名称</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} /></label>
            <div className="tag-color-field">
              <label><span>颜色</span><input type="color" value={color} onChange={(event) => setColor(event.target.value)} /></label>
              <span style={{ color }}><Tag size={15} />{name || '标签预览'}</span>
            </div>
            <label><span>说明</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} /></label>
            {error && <div className="inline-error">{error}</div>}
          </div>
          <div className="dialog-actions">
            <Dialog.Close className="button button-secondary">取消</Dialog.Close>
            <button className="button button-primary" disabled={!name.trim() || busy} onClick={() => void save()}>
              {busy ? '正在保存…' : tag ? '保存修改' : '创建标签'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function DeleteTagDialog({ tag, onOpenChange, onDeleted }: { tag: TraceTag | null; onOpenChange: (open: boolean) => void; onDeleted: () => Promise<void> }): React.JSX.Element {
  const [error, setError] = useState('')
  const submit = async (): Promise<void> => {
    if (!tag) return
    const result = await window.youtrace.planning.trashTag(tag.id)
    if (!result.ok) return setError(result.error.message)
    await onDeleted()
  }
  return <Dialog.Root open={tag !== null} onOpenChange={onOpenChange}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="dialog-content destructive-dialog"><div className="dialog-heading"><div><span className="section-label">可从数据中心恢复</span><Dialog.Title>删除“{tag?.name}”</Dialog.Title><Dialog.Description>标签会移入回收站；业务对象不会被删除，永久删除标签时只解除标签关系。</Dialog.Description></div><Dialog.Close className="dialog-close" aria-label="关闭"><X size={18} /></Dialog.Close></div>{error && <div className="inline-error">{error}</div>}<div className="dialog-actions"><Dialog.Close className="button button-secondary">取消</Dialog.Close><button className="button button-danger" onClick={() => void submit()}><Trash2 size={14} />移入回收站</button></div></Dialog.Content></Dialog.Portal></Dialog.Root>
}
