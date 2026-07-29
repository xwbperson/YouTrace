import { FolderOpen, HardDrive, LockKeyhole, MoveRight, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import type { AppBootstrapState, WorkspaceSummary } from '../../../shared/contracts'

interface OnboardingProps {
  initialState: Exclude<AppBootstrapState, { status: 'ready' }>
  onReady: (workspace: WorkspaceSummary) => void
}

type Mode = 'create' | 'open'

export function Onboarding({ initialState, onReady }: OnboardingProps): React.JSX.Element {
  const [mode, setMode] = useState<Mode>('create')
  const [name, setName] = useState('我的有迹')
  const [selectedPath, setSelectedPath] = useState(
    initialState.status === 'workspace-unavailable' ? initialState.lastPath : ''
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(
    initialState.status === 'workspace-unavailable' ? initialState.reason : ''
  )

  const chooseDirectory = async (): Promise<void> => {
    setError('')
    const result = await window.youtrace.dialog.selectDirectory()
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    if (result.data) setSelectedPath(result.data)
  }

  const continueToWorkspace = async (): Promise<void> => {
    if (!selectedPath) {
      setError('请先选择一个文件夹。')
      return
    }
    setBusy(true)
    setError('')

    const result =
      mode === 'create'
        ? await window.youtrace.workspace.create({ rootPath: selectedPath, name })
        : await window.youtrace.workspace.open({ rootPath: selectedPath, readOnly: false })

    setBusy(false)
    if (result.ok) {
      onReady(result.data)
      return
    }
    setError(result.error.recovery ? `${result.error.message} ${result.error.recovery}` : result.error.message)
  }

  return (
    <main className="onboarding">
      <section className="onboarding-story" aria-labelledby="welcome-title">
        <div className="onboarding-brand">
          <div className="brand-mark" aria-hidden="true">
            <span />
          </div>
          <span>有迹 · YouTrace</span>
        </div>

        <div className="story-copy">
          <span className="eyebrow">你的努力，不只是一枚勾选</span>
          <h1 id="welcome-title">
            让每一次投入，
            <br />
            都留下可以回看的轨迹。
          </h1>
          <p>
            从下一步行动到真实投入，从阶段成果到复盘调整。数据只保存在你选择的本地工作区。
          </p>
        </div>

        <div className="trace-preview" aria-label="有迹执行闭环">
          {['计划', '行动', '投入', '成果', '复盘'].map((label, index) => (
            <div className="trace-preview-item" key={label}>
              <span className={index === 0 ? 'active' : ''}>{index + 1}</span>
              <div>
                <strong>{label}</strong>
                <small>
                  {['确定下一步', '开始真实执行', '记录时间与困难', '保存验证证据', '调整未来计划'][index]}
                </small>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="workspace-setup" aria-labelledby="workspace-title">
        <div className="setup-header">
          <span className="setup-step">首次设置</span>
          <h2 id="workspace-title">选择工作区</h2>
          <p>一个文件夹就是一个完整工作区，复制它即可备份或迁移。</p>
        </div>

        <div className="segmented-control" aria-label="工作区操作">
          <button className={mode === 'create' ? 'active' : ''} onClick={() => setMode('create')}>
            创建新工作区
          </button>
          <button className={mode === 'open' ? 'active' : ''} onClick={() => setMode('open')}>
            打开已有工作区
          </button>
        </div>

        <div className="setup-form">
          {mode === 'create' && (
            <label>
              <span>工作区名称</span>
              <input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
            </label>
          )}

          <div className="field-label">工作区文件夹</div>
          <button type="button" className="folder-picker" onClick={() => void chooseDirectory()}>
            <span className="folder-picker-icon">
              <FolderOpen size={21} />
            </span>
            <span className="folder-picker-copy">
              <strong>{selectedPath || '选择一个空文件夹'}</strong>
              <small>
                {mode === 'create'
                  ? '不会写入未选择的位置；所选文件夹必须为空'
                  : '请选择包含 .youtrace-workspace.json 的文件夹'}
              </small>
            </span>
            <MoveRight size={18} />
          </button>

          {error && (
            <div className="inline-error" role="alert">
              <LockKeyhole size={17} />
              <span>{error}</span>
            </div>
          )}

          <button
            type="button"
            className="button button-primary setup-submit"
            disabled={busy || (mode === 'create' && !name.trim())}
            onClick={() => void continueToWorkspace()}
          >
            {busy ? '正在检查…' : mode === 'create' ? '创建并进入有迹' : '打开这个工作区'}
            {!busy && <MoveRight size={18} />}
          </button>
        </div>

        <div className="workspace-promises">
          <div>
            <HardDrive size={17} />
            <span>完全离线可用</span>
          </div>
          <div>
            <ShieldCheck size={17} />
            <span>业务数据归你控制</span>
          </div>
        </div>
      </section>
    </main>
  )
}
