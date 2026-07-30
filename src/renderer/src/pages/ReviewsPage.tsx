import * as Dialog from '@radix-ui/react-dialog'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Archive,
  ArrowRight,
  CalendarClock,
  Check,
  ClipboardList,
  Clock3,
  GitBranch,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  X
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { IpcResult, Review } from '../../../shared/contracts'

function unwrap<T>(result: IpcResult<T>): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.data
}

function localDate(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 10)
}

function weekBounds(): { start: string; end: string } {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - (start.getDay() === 0 ? 6 : start.getDay() - 1))
  const end = new Date(start)
  end.setDate(end.getDate() + 6)
  return { start: localDate(start), end: localDate(end) }
}

export function ReviewsPage(): React.JSX.Element {
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const reviewsQuery = useQuery({
    queryKey: ['reviews'],
    queryFn: async () => unwrap(await window.youtrace.workflow.listReviews())
  })
  const reviews = reviewsQuery.data ?? []
  useEffect(() => {
    if (!selectedId && reviews[0]) setSelectedId(reviews[0].id)
    if (selectedId && !reviews.some((review) => review.id === selectedId)) {
      setSelectedId(reviews[0]?.id ?? null)
    }
  }, [reviews, selectedId])
  const selected = reviews.find((review) => review.id === selectedId) ?? null

  return (
    <div className="reviews-page">
      <header className="reviews-toolbar">
        <div>
          <span className="page-kicker">让事实改变后续计划</span>
          <h1>复盘</h1>
          <p>快照保留当时的计划，调整只作用于未来。</p>
        </div>
        <button className="button button-primary" type="button" onClick={() => setCreateOpen(true)}>
          <Plus size={15} />
          生成复盘
        </button>
      </header>

      {reviews.length === 0 ? (
        <div className="review-empty panel">
          <Archive size={29} />
          <strong>还没有复盘</strong>
          <p>先建立周期计划并记录一些投入，再生成第一份不可变事实快照。</p>
          <button className="button button-secondary" type="button" onClick={() => setCreateOpen(true)}>
            <Plus size={14} />
            生成本周复盘
          </button>
        </div>
      ) : (
        <div className="reviews-layout">
          <aside className="review-rail panel">
            {reviews.map((review) => (
              <button type="button" key={review.id} className={review.id === selectedId ? 'active' : ''} onClick={() => setSelectedId(review.id)}>
                <span>{review.reviewType === 'daily' ? '每日' : review.reviewType === 'weekly' ? '每周' : '每月'}</span>
                <strong>{review.title}</strong>
                <small>{review.startDate} — {review.endDate}</small>
                {review.status === 'completed' && <em><Check size={11} />已完成</em>}
              </button>
            ))}
          </aside>
          {selected && (
            <ReviewWorkspace
              key={selected.id}
              review={selected}
              onChanged={() => queryClient.invalidateQueries({ queryKey: ['reviews'] })}
              onDeleted={async () => {
                setSelectedId(null)
                await Promise.all([
                  queryClient.invalidateQueries({ queryKey: ['reviews'] }),
                  queryClient.invalidateQueries({ queryKey: ['trash'] })
                ])
              }}
            />
          )}
        </div>
      )}

      <CreateReviewDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={async (review) => {
          setSelectedId(review.id)
          await queryClient.invalidateQueries({ queryKey: ['reviews'] })
        }}
      />
    </div>
  )
}

function ReviewWorkspace(props: {
  review: Review
  onChanged: () => Promise<unknown>
  onDeleted: () => Promise<void>
}): React.JSX.Element {
  const { review } = props
  const queryClient = useQueryClient()
  const [isEditing, setIsEditing] = useState(review.status === 'draft')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [importantOutcomes, setImportantOutcomes] = useState(review.importantOutcomes)
  const [blockers, setBlockers] = useState(review.blockers)
  const [nextFirstStep, setNextFirstStep] = useState(review.nextFirstStep)
  const [nextCommitments, setNextCommitments] = useState(review.nextCommitments)
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>(
    review.snapshot.tasks
      .filter((task) => task.status !== 'completed' && task.status !== 'cancelled')
      .map((task) => task.id)
  )
  const [reason, setReason] = useState('')
  const [newDueDate, setNewDueDate] = useState('')
  const [splitTitle, setSplitTitle] = useState('')
  const [draftDirty, setDraftDirty] = useState(false)
  const [draftHandled, setDraftHandled] = useState(false)
  const draftKey = `review:${review.id}`
  const draftsQuery = useQuery({
    queryKey: ['recovery-drafts'],
    queryFn: async () => unwrap(await window.youtrace.data.listRecoveryDrafts())
  })
  const recoveryDraft = (draftsQuery.data ?? []).find((draft) => draft.key === draftKey)
  const effortMinutes = review.snapshot.efforts.reduce((sum, effort) => sum + effort.effectiveMinutes, 0)
  const incomplete = review.snapshot.tasks.filter((task) => task.status !== 'completed' && task.status !== 'cancelled')

  useEffect(() => {
    if (!draftsQuery.isSuccess || !draftDirty || (recoveryDraft && !draftHandled)) return
    const timer = window.setTimeout(() => {
      void window.youtrace.data.saveRecoveryDraft({
        key: draftKey,
        label: review.title,
        content: importantOutcomes,
        context: {
          blockers,
          nextFirstStep,
          nextCommitments
        }
      })
    }, 750)
    return () => window.clearTimeout(timer)
  }, [
    blockers,
    draftDirty,
    draftHandled,
    draftKey,
    draftsQuery.isSuccess,
    importantOutcomes,
    nextCommitments,
    nextFirstStep,
    recoveryDraft,
    review.title
  ])

  const save = async (status: 'draft' | 'completed'): Promise<void> => {
    const result = await window.youtrace.workflow.updateReview({
      id: review.id,
      importantOutcomes,
      blockers,
      nextFirstStep,
      nextCommitments,
      status
    })
    if (result.ok) {
      setDraftDirty(false)
      setDraftHandled(true)
      await window.youtrace.data.discardRecoveryDraft(draftKey)
      await queryClient.invalidateQueries({ queryKey: ['recovery-drafts'] })
      await props.onChanged()
      setIsEditing(status === 'draft')
    }
  }

  const cancelEditing = async (): Promise<void> => {
    setImportantOutcomes(review.importantOutcomes)
    setBlockers(review.blockers)
    setNextFirstStep(review.nextFirstStep)
    setNextCommitments(review.nextCommitments)
    setDraftDirty(false)
    setDraftHandled(true)
    await window.youtrace.data.discardRecoveryDraft(draftKey)
    await queryClient.invalidateQueries({ queryKey: ['recovery-drafts'] })
    setIsEditing(false)
  }

  const adjust = async (action: 'reschedule' | 'cancel' | 'split'): Promise<void> => {
    if (selectedTaskIds.length === 0 || !reason.trim()) return
    const adjustments = selectedTaskIds.map((taskId) => {
      const task = incomplete.find((candidate) => candidate.id === taskId)!
      return action === 'reschedule'
        ? { taskId, action, newDueAt: new Date(`${newDueDate}T12:00:00`).toISOString() } as const
        : action === 'cancel'
          ? { taskId, action } as const
          : {
              taskId,
              action,
              newTitle:
                selectedTaskIds.length > 1 ? `${splitTitle}：${task.title}` : splitTitle,
              estimatedMinutes: null,
              newDueAt: newDueDate
                ? new Date(`${newDueDate}T12:00:00`).toISOString()
                : null
            } as const
    })
    const result = await window.youtrace.workflow.applyReviewAdjustments({
      reviewId: review.id,
      reason,
      adjustments
    })
    if (result.ok) {
      setReason('')
      setNewDueDate('')
      setSplitTitle('')
      await props.onChanged()
    }
  }

  return (
    <main className="review-workspace panel">
      <header>
        <div>
          <span className="section-label">快照生成于 {new Date(review.snapshot.generatedAt).toLocaleString('zh-CN')}</span>
          <h2>{review.title}</h2>
        </div>
        <div className="review-header-actions">
          <span className={`review-status ${review.status}`}>{review.status === 'completed' ? '已完成' : '草稿'}</span>
          {review.status === 'completed' && !isEditing && (
            <button className="button button-secondary" type="button" onClick={() => setIsEditing(true)}>
              <Pencil size={13} />
              编辑复盘
            </button>
          )}
          {!isEditing && (
            <button className="review-delete-action" type="button" onClick={() => setDeleteOpen(true)}>
              <Trash2 size={13} />
              删除复盘
            </button>
          )}
          {review.status === 'draft' && (
            <button className="review-delete-action" type="button" onClick={() => setDeleteOpen(true)}>
              <Trash2 size={13} />
              删除复盘
            </button>
          )}
        </div>
      </header>

      <div className="snapshot-metrics">
        <article><ClipboardList size={16} /><span>计划事项</span><strong>{review.snapshot.tasks.length}</strong></article>
        <article><Clock3 size={16} /><span>真实投入</span><strong>{Math.round(effortMinutes / 6) / 10}h</strong></article>
        <article><Check size={16} /><span>已完成</span><strong>{review.snapshot.tasks.filter((task) => task.status === 'completed').length}</strong></article>
        <article><Archive size={16} /><span>成果证据</span><strong>{review.snapshot.evidence.length}</strong></article>
      </div>

      <section className="snapshot-section">
        <div className="review-section-heading"><span>不可变计划快照</span><small>后续调整不会改写这里</small></div>
        <div className="snapshot-list">
          {review.snapshot.tasks.map((task) => (
            <article key={task.id}>
              <span className={`snapshot-dot ${task.status}`} />
              <strong>{task.title}</strong>
              <small>{task.status === 'completed' ? '已完成' : '原计划未完成'} · {task.dueAt?.slice(0, 10) ?? '无截止日期'}</small>
            </article>
          ))}
          {review.snapshot.tasks.length === 0 && <p>这个周期没有捕获到计划任务。</p>}
        </div>
      </section>

      {isEditing ? <section className="review-editor">
        {recoveryDraft && !draftHandled ? (
          <div className="memo-recovery-banner review-recovery-banner" role="status">
            <div>
              <RotateCcw size={16} />
              <span>
                <strong>发现这份复盘上次未提交的文字</strong>
                <small>{new Date(recoveryDraft.updatedAt).toLocaleString('zh-CN')}</small>
              </span>
            </div>
            <button
              type="button"
              className="button button-secondary"
              onClick={async () => {
                await window.youtrace.data.discardRecoveryDraft(draftKey)
                setDraftHandled(true)
                await queryClient.invalidateQueries({ queryKey: ['recovery-drafts'] })
              }}
            >
              放弃草稿
            </button>
            <button
              type="button"
              className="button button-primary"
              onClick={() => {
                setImportantOutcomes(recoveryDraft.content)
                if (typeof recoveryDraft.context.blockers === 'string') {
                  setBlockers(recoveryDraft.context.blockers)
                }
                if (typeof recoveryDraft.context.nextFirstStep === 'string') {
                  setNextFirstStep(recoveryDraft.context.nextFirstStep)
                }
                if (typeof recoveryDraft.context.nextCommitments === 'string') {
                  setNextCommitments(recoveryDraft.context.nextCommitments)
                }
                setDraftHandled(true)
                setDraftDirty(true)
              }}
            >
              恢复草稿
            </button>
          </div>
        ) : null}
        <label><span>重要成果</span><textarea value={importantOutcomes} onChange={(event) => { setImportantOutcomes(event.target.value); setDraftDirty(true); setDraftHandled(true) }} placeholder="这个周期真正完成了什么？" /></label>
        <label><span>阻塞与延期原因</span><textarea value={blockers} onChange={(event) => { setBlockers(event.target.value); setDraftDirty(true); setDraftHandled(true) }} placeholder="记录事实，不把原因改写成结果。" /></label>
        <label><span>下一周期第一步</span><textarea value={nextFirstStep} onChange={(event) => { setNextFirstStep(event.target.value); setDraftDirty(true); setDraftHandled(true) }} /></label>
        <label><span>下一周期承诺</span><textarea value={nextCommitments} onChange={(event) => { setNextCommitments(event.target.value); setDraftDirty(true); setDraftHandled(true) }} /></label>
      </section> : <section className="review-readonly-grid" aria-label="复盘正文">
        <ReviewTextBlock label="重要成果" value={importantOutcomes} />
        <ReviewTextBlock label="阻塞与延期原因" value={blockers} />
        <ReviewTextBlock label="下一周期第一步" value={nextFirstStep} />
        <ReviewTextBlock label="下一周期承诺" value={nextCommitments} />
      </section>}

      {isEditing && review.status === 'draft' && incomplete.length > 0 && (
        <section className="adjustment-panel">
          <div className="review-section-heading"><span>调整未来计划</span><small>已执行 {review.adjustmentCount} 次调整</small></div>
          <div className="adjustment-form">
            <fieldset className="review-task-selection"><legend>选择原任务（可多选）</legend>{incomplete.map((task) => <label key={task.id}><input type="checkbox" checked={selectedTaskIds.includes(task.id)} onChange={(event) => setSelectedTaskIds((current) => event.target.checked ? [...current, task.id] : current.filter((id) => id !== task.id))} /><span>{task.title}</span></label>)}</fieldset>
            <label><span>新日期</span><input type="date" value={newDueDate} onChange={(event) => setNewDueDate(event.target.value)} /></label>
            <label><span>拆分出的新任务</span><input value={splitTitle} onChange={(event) => setSplitTitle(event.target.value)} placeholder="仅拆分时填写" /></label>
            <label className="adjustment-reason"><span>调整原因</span><input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="必填：为什么改变计划？" /></label>
          </div>
          <div className="adjustment-actions">
            <button type="button" disabled={selectedTaskIds.length === 0 || !reason.trim() || !newDueDate} onClick={() => void adjust('reschedule')}><CalendarClock size={14} />批量顺延</button>
            <button type="button" disabled={selectedTaskIds.length === 0 || !reason.trim() || !splitTitle.trim()} onClick={() => void adjust('split')}><GitBranch size={14} />批量拆分</button>
            <button type="button" disabled={selectedTaskIds.length === 0 || !reason.trim()} onClick={() => void adjust('cancel')}><X size={14} />批量取消</button>
          </div>
        </section>
      )}

      {isEditing && (
        <footer className="review-actions">
          {review.status === 'draft' ? (
            <>
              <button className="button button-secondary" type="button" onClick={() => void save('draft')}><RotateCcw size={14} />保存草稿</button>
              <button className="button button-primary" type="button" onClick={() => void save('completed')}><Check size={14} />完成复盘</button>
            </>
          ) : (
            <>
              <button className="button button-secondary" type="button" onClick={() => void cancelEditing()}><X size={14} />取消编辑</button>
              <button className="button button-primary" type="button" onClick={() => void save('completed')}><Check size={14} />保存修改</button>
            </>
          )}
        </footer>
      )}
      <DeleteReviewDialog
        review={deleteOpen ? review : null}
        onOpenChange={setDeleteOpen}
        onDeleted={props.onDeleted}
      />
    </main>
  )
}

function ReviewTextBlock({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <article>
      <span>{label}</span>
      <p>{value || '未填写'}</p>
    </article>
  )
}

function DeleteReviewDialog(props: {
  review: Review | null
  onOpenChange: (open: boolean) => void
  onDeleted: () => Promise<void>
}): React.JSX.Element {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (): Promise<void> => {
    if (!props.review) return
    setBusy(true)
    setError('')
    const result = await window.youtrace.workflow.trashReview(props.review.id)
    setBusy(false)
    if (!result.ok) return setError(result.error.message)
    await window.youtrace.data.discardRecoveryDraft(`review:${props.review.id}`)
    props.onOpenChange(false)
    await props.onDeleted()
  }
  return (
    <Dialog.Root open={props.review !== null} onOpenChange={props.onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content destructive-dialog">
          <div className="dialog-heading">
            <div>
              <span className="section-label">可从回收站恢复</span>
              <Dialog.Title>删除“{props.review?.title}”</Dialog.Title>
              <Dialog.Description>复盘正文和原快照会一起进入回收站；已经执行的任务调整不会撤销。</Dialog.Description>
            </div>
            <Dialog.Close className="dialog-close" aria-label="关闭"><X size={18} /></Dialog.Close>
          </div>
          {error && <div className="inline-error">{error}</div>}
          <div className="dialog-actions">
            <Dialog.Close className="button button-secondary">取消</Dialog.Close>
            <button className="button button-danger" disabled={busy} onClick={() => void submit()}>
              <Trash2 size={14} />
              {busy ? '正在删除…' : '移入回收站'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function CreateReviewDialog(props: { open: boolean; onOpenChange: (open: boolean) => void; onCreated: (review: Review) => Promise<void> }): React.JSX.Element {
  const bounds = useMemo(weekBounds, [props.open])
  const [reviewType, setReviewType] = useState<'daily' | 'weekly' | 'monthly'>('weekly')
  const [startDate, setStartDate] = useState(bounds.start)
  const [endDate, setEndDate] = useState(bounds.end)
  const [title, setTitle] = useState('本周复盘')
  const [error, setError] = useState('')
  const submit = async (): Promise<void> => {
    const result = await window.youtrace.workflow.createReview({ reviewType, startDate, endDate, title })
    if (!result.ok) return setError(result.error.message)
    await props.onCreated(result.data)
    props.onOpenChange(false)
  }
  return <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="dialog-content"><div className="dialog-heading"><div><span className="section-label">先冻结事实，再写判断</span><Dialog.Title>生成复盘</Dialog.Title><Dialog.Description>系统会保存这个周期的计划、任务、投入和成果快照。</Dialog.Description></div><Dialog.Close className="dialog-close" aria-label="关闭"><X size={18} /></Dialog.Close></div><div className="dialog-form"><label><span>复盘标题</span><input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} /></label><div className="form-row form-row-three"><label><span>周期</span><select value={reviewType} onChange={(event) => setReviewType(event.target.value as typeof reviewType)}><option value="daily">每日</option><option value="weekly">每周</option><option value="monthly">每月</option></select></label><label><span>开始日期</span><input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label><label><span>结束日期</span><input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label></div>{error && <div className="inline-error">{error}</div>}</div><div className="dialog-actions"><Dialog.Close className="button button-secondary">取消</Dialog.Close><button className="button button-primary" disabled={!title.trim()} onClick={() => void submit()}>生成快照<ArrowRight size={14} /></button></div></Dialog.Content></Dialog.Portal></Dialog.Root>
}
