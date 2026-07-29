import * as Dialog from '@radix-ui/react-dialog'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowRight,
  BookOpen,
  Code2,
  Dumbbell,
  GraduationCap,
  Layers3,
  Plus,
  Save,
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
  const [appliedName, setAppliedName] = useState('')
  const templatesQuery = useQuery({
    queryKey: ['templates'],
    queryFn: async () => unwrap(await window.youtrace.workflow.listTemplates())
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
        <button className="button button-secondary" type="button" onClick={() => setSaveOpen(true)}><Save size={15} />从项目保存</button>
      </header>
      <div className="template-layout">
        <section className="template-gallery">
          {templates.map((template, index) => {
            const Icon = icons[index % icons.length]!
            return <button type="button" key={template.id} className={template.id === selectedId ? 'active' : ''} onClick={() => void selectTemplate(template)}><span className="template-icon"><Icon size={20} /></span><span><small>{template.builtIn ? '内置模板' : '自定义模板'}</small><strong>{template.name}</strong><p>{template.description}</p><em>{template.milestoneCount} 个里程碑 · {template.taskCount} 个任务</em></span><ArrowRight size={15} /></button>
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
      <SaveTemplateDialog open={saveOpen} onOpenChange={setSaveOpen} projects={projectsQuery.data ?? []} onSaved={() => queryClient.invalidateQueries({ queryKey: ['templates'] })} />
    </div>
  )
}

function SaveTemplateDialog(props: { open: boolean; onOpenChange: (open: boolean) => void; projects: Project[]; onSaved: () => Promise<unknown> }): React.JSX.Element {
  const [projectId, setProjectId] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState('')
  useEffect(() => { if (!projectId && props.projects[0]) setProjectId(props.projects[0].id) }, [projectId, props.projects])
  const submit = async (): Promise<void> => {
    const result = await window.youtrace.workflow.saveProjectTemplate({ projectId, name, description })
    if (!result.ok) return setError(result.error.message)
    await props.onSaved()
    setName('')
    setDescription('')
    props.onOpenChange(false)
  }
  return <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="dialog-content"><div className="dialog-heading"><div><span className="section-label">保存可复用结构</span><Dialog.Title>从项目创建模板</Dialog.Title><Dialog.Description>只复制里程碑与任务定义，不复制投入、证据和完成历史。</Dialog.Description></div><Dialog.Close className="dialog-close" aria-label="关闭"><X size={18} /></Dialog.Close></div><div className="dialog-form"><label><span>来源项目</span><select value={projectId} onChange={(event) => setProjectId(event.target.value)}>{props.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><label><span>模板名称</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} /></label><label><span>说明</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} /></label>{error && <div className="inline-error">{error}</div>}</div><div className="dialog-actions"><Dialog.Close className="button button-secondary">取消</Dialog.Close><button className="button button-primary" disabled={!projectId || !name.trim()} onClick={() => void submit()}>保存模板</button></div></Dialog.Content></Dialog.Portal></Dialog.Root>
}
