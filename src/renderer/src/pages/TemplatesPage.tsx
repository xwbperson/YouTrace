import * as Dialog from '@radix-ui/react-dialog'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowRight,
  Archive,
  BookOpen,
  Code2,
  Dumbbell,
  GraduationCap,
  Layers3,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  X
} from 'lucide-react'
import { useEffect, useState } from 'react'
import type { IpcResult, Project, ProjectTemplate, TemplatePreview } from '../../../shared/contracts'

function unwrap<T>(result: IpcResult<T>): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.data
}

const icons = [GraduationCap, BookOpen, Code2, Dumbbell, Layers3]

export function TemplatesPage(): React.JSX.Element {
  const queryClient = useQueryClient()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [projectName, setProjectName] = useState('')
  const [preview, setPreview] = useState<TemplatePreview | null>(null)
  const [saveOpen, setSaveOpen] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<ProjectTemplate | null>(null)
  const [deleteTemplate, setDeleteTemplate] = useState<ProjectTemplate | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [appliedName, setAppliedName] = useState('')
  const templatesQuery = useQuery({
    queryKey: ['templates', showArchived],
    queryFn: async () => unwrap(await window.youtrace.workflow.listTemplates(showArchived))
  })
  const projectsQuery = useQuery({
    queryKey: ['projects'],
    queryFn: async () => unwrap(await window.youtrace.planning.listProjects())
  })
  const templates = templatesQuery.data ?? []
  useEffect(() => {
    if (!selectedId && templates[0]) setSelectedId(templates[0].id)
  }, [selectedId, templates])

  const selectTemplate = async (template: ProjectTemplate): Promise<void> => {
    setSelectedId(template.id)
    const name = projectName.trim() || `我的${template.name}`
    setProjectName(name)
    const result = await window.youtrace.workflow.previewTemplate({
      templateId: template.id,
      projectName: name
    })
    if (result.ok) setPreview(result.data)
  }

  const apply = async (): Promise<void> => {
    if (!selectedId || !projectName.trim()) return
    const result = await window.youtrace.workflow.applyTemplate({
      templateId: selectedId,
      projectName
    })
    if (result.ok) {
      setAppliedName(result.data.project.name)
      await queryClient.invalidateQueries({ queryKey: ['projects'] })
    }
  }

  return (
    <div className="templates-page">
      <header className="templates-toolbar">
        <div><span className="page-kicker">复用结构，不复制历史</span><h1>模板</h1><p>先预览将创建的里程碑和任务，再写入工作区。</p></div>
        <div className="toolbar-actions"><label className="archive-toggle"><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} />显示已归档</label><button className="button button-secondary" type="button" onClick={() => { setEditingTemplate(null); setSaveOpen(true) }}><Save size={15} />从项目保存</button></div>
      </header>
      <div className="template-layout">
        <section className="template-gallery">
          {templates.map((template, index) => {
            const Icon = icons[index % icons.length]!
            return <article key={template.id} className={`template-gallery-item ${template.id === selectedId ? 'active' : ''} ${template.archived ? 'archived' : ''}`}><button className="template-select" type="button" onClick={() => template.archived ? (setSelectedId(template.id), setPreview(null)) : void selectTemplate(template)}><span className="template-icon"><Icon size={20} /></span><span><small>{template.builtIn ? '内置模板' : template.archived ? '已归档模板' : '自定义模板'}</small><strong>{template.name}</strong><p>{template.description}</p><em>{template.milestoneCount} 个里程碑 · {template.taskCount} 个任务</em></span><ArrowRight size={15} /></button>{!template.builtIn && <footer><button type="button" onClick={() => { setEditingTemplate(template); setSaveOpen(true) }}><Pencil size={12} />编辑</button><button type="button" onClick={async () => { await window.youtrace.workflow.archiveTemplate(template.id, !template.archived); if (selectedId === template.id) { setSelectedId(null); setPreview(null) } await queryClient.invalidateQueries({ queryKey: ['templates'] }) }}>{template.archived ? <><RotateCcw size={12} />恢复</> : <><Archive size={12} />归档</>}</button>{template.archived && <button type="button" className="danger" onClick={() => setDeleteTemplate(template)}><Trash2 size={12} />删除</button>}</footer>}</article>
          })}
        </section>
        <aside className="template-preview panel">
          {!preview ? <div className="preview-empty"><Layers3 size={27} /><strong>选择一个模板查看结构</strong><p>预览不会写入任何数据。</p></div> : <>
            <header><div><span className="section-label">创建前预览</span><h2>{preview.template.name}</h2></div><span>{preview.template.milestoneCount} / {preview.template.taskCount}</span></header>
            <label><span>新项目名称</span><input value={projectName} onChange={(event) => setProjectName(event.target.value)} /></label>
            <div className="preview-structure">
              {preview.milestones.map((milestone, index) => <article key={`${milestone.title}-${index}`}><header><span>{String(index + 1).padStart(2, '0')}</span><strong>{milestone.title}</strong><small>{milestone.tasks.length} 项</small></header><div>{milestone.tasks.map((task) => <span key={`${task.title}-${index}`}>{task.title}<small>{task.estimatedMinutes ?? '—'} 分钟</small></span>)}</div></article>)}
            </div>
            {appliedName && <div className="template-success"><Plus size={13} />已创建项目“{appliedName}”</div>}
            <footer><span>仅创建结构，不包含投入、成果或历史记录。</span><button className="button button-primary" type="button" disabled={!projectName.trim()} onClick={() => void apply()}>应用模板</button></footer>
          </>}
        </aside>
      </div>
      <SaveTemplateDialog key={editingTemplate?.id ?? 'new-template'} open={saveOpen} template={editingTemplate} onOpenChange={(open) => { setSaveOpen(open); if (!open) setEditingTemplate(null) }} projects={projectsQuery.data ?? []} onSaved={() => queryClient.invalidateQueries({ queryKey: ['templates'] })} />
      <DeleteTemplateDialog template={deleteTemplate} onOpenChange={(open) => { if (!open) setDeleteTemplate(null) }} onDeleted={async () => { setDeleteTemplate(null); setSelectedId(null); setPreview(null); await Promise.all([queryClient.invalidateQueries({ queryKey: ['templates'] }), queryClient.invalidateQueries({ queryKey: ['trash'] })]) }} />
    </div>
  )
}

function SaveTemplateDialog(props: { open: boolean; template: ProjectTemplate | null; onOpenChange: (open: boolean) => void; projects: Project[]; onSaved: () => Promise<unknown> }): React.JSX.Element {
  const [projectId, setProjectId] = useState(props.template?.sourceProjectId ?? '')
  const [name, setName] = useState(props.template?.name ?? '')
  const [description, setDescription] = useState(props.template?.description ?? '')
  const [error, setError] = useState('')
  useEffect(() => { if (!projectId && props.projects[0]) setProjectId(props.projects[0].id) }, [projectId, props.projects])
  const submit = async (): Promise<void> => {
    const result = props.template
      ? await window.youtrace.workflow.updateProjectTemplate({ id: props.template.id, projectId, name, description })
      : await window.youtrace.workflow.saveProjectTemplate({ projectId, name, description })
    if (!result.ok) return setError(result.error.message)
    await props.onSaved()
    setName('')
    setDescription('')
    props.onOpenChange(false)
  }
  return <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="dialog-content"><div className="dialog-heading"><div><span className="section-label">保存可复用结构</span><Dialog.Title>{props.template ? '编辑自定义模板' : '从项目创建模板'}</Dialog.Title><Dialog.Description>{props.template ? '保存时会从所选项目重新读取里程碑和任务结构。' : '只复制里程碑与任务定义，不复制投入、证据和完成历史。'}</Dialog.Description></div><Dialog.Close className="dialog-close" aria-label="关闭"><X size={18} /></Dialog.Close></div><div className="dialog-form"><label><span>来源项目</span><select value={projectId} onChange={(event) => setProjectId(event.target.value)}>{props.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><label><span>模板名称</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} /></label><label><span>说明</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} /></label>{error && <div className="inline-error">{error}</div>}</div><div className="dialog-actions"><Dialog.Close className="button button-secondary">取消</Dialog.Close><button className="button button-primary" disabled={!projectId || !name.trim()} onClick={() => void submit()}>{props.template ? '保存并刷新结构' : '保存模板'}</button></div></Dialog.Content></Dialog.Portal></Dialog.Root>
}

function DeleteTemplateDialog(props: { template: ProjectTemplate | null; onOpenChange: (open: boolean) => void; onDeleted: () => Promise<void> }): React.JSX.Element {
  const [error, setError] = useState('')
  const submit = async (): Promise<void> => {
    if (!props.template) return
    const result = await window.youtrace.workflow.trashTemplate(props.template.id)
    if (!result.ok) return setError(result.error.message)
    await props.onDeleted()
  }
  return <Dialog.Root open={props.template !== null} onOpenChange={props.onOpenChange}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="dialog-content destructive-dialog"><div className="dialog-heading"><div><span className="section-label">可从数据中心恢复</span><Dialog.Title>删除“{props.template?.name}”</Dialog.Title><Dialog.Description>自定义模板会移入回收站，不会删除来源项目或已由模板创建的项目。</Dialog.Description></div><Dialog.Close className="dialog-close" aria-label="关闭"><X size={18} /></Dialog.Close></div>{error && <div className="inline-error">{error}</div>}<div className="dialog-actions"><Dialog.Close className="button button-secondary">取消</Dialog.Close><button className="button button-danger" onClick={() => void submit()}><Trash2 size={14} />移入回收站</button></div></Dialog.Content></Dialog.Portal></Dialog.Root>
}
