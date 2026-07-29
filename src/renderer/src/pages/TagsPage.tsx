import * as Dialog from '@radix-ui/react-dialog'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Clock3, Layers3, Plus, Tag, X } from 'lucide-react'
import { useState } from 'react'
import type { IpcResult } from '../../../shared/contracts'

function unwrap<T>(result: IpcResult<T>): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.data
}

export function TagsPage(): React.JSX.Element {
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const tagsQuery = useQuery({
    queryKey: ['tags'],
    queryFn: async () => unwrap(await window.youtrace.planning.listTags())
  })

  const tags = tagsQuery.data ?? []

  return (
    <main className="tags-page">
      <header className="tags-header">
        <div>
          <span className="page-kicker">跨模块横向关系</span>
          <h1>标签</h1>
          <p>标签可以为空，也可以多选；删除标签只解除关系，不删除业务对象。</p>
        </div>
        <button className="button button-primary" onClick={() => setDialogOpen(true)}>
          <Plus size={16} />
          新建标签
        </button>
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
            <article className="panel tag-card" key={tag.id}>
              <header>
                <span style={{ background: tag.color ?? '#216E65' }} />
                <strong>{tag.name}</strong>
              </header>
              <p>{tag.description || '没有说明。'}</p>
              <footer>
                <span><Layers3 size={13} />跨模块对象</span>
                <span><Clock3 size={13} />投入统计</span>
              </footer>
            </article>
          ))}
        </div>
      )}

      <CreateTagDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreated={async () => {
          await queryClient.invalidateQueries({ queryKey: ['tags'] })
        }}
      />
    </main>
  )
}

function CreateTagDialog({
  open,
  onOpenChange,
  onCreated
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => Promise<void>
}): React.JSX.Element {
  const [name, setName] = useState('')
  const [color, setColor] = useState('#216E65')
  const [description, setDescription] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const create = async (): Promise<void> => {
    setBusy(true)
    setError('')
    const result = await window.youtrace.planning.createTag({
      name,
      color,
      icon: null,
      description
    })
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
              <Dialog.Title>新建标签</Dialog.Title>
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
            <button className="button button-primary" disabled={!name.trim() || busy} onClick={() => void create()}>
              {busy ? '正在创建…' : '创建标签'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
