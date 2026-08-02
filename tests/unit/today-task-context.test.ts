import { describe, expect, it } from 'vitest'
import { formatTaskContext } from '../../src/renderer/src/pages/today-task-context'

describe('today task context', () => {
  it('keeps repeated titles distinguishable by project and milestone', () => {
    expect(
      formatTaskContext({
        projectName: '网络空间安全数学原理',
        milestoneTitle: '第 2 章 有限域算术'
      })
    ).toBe('网络空间安全数学原理 · 第 2 章 有限域算术')
  })

  it('keeps useful fallbacks for partially linked and unlinked tasks', () => {
    expect(formatTaskContext({ projectName: '毕业论文', milestoneTitle: null })).toBe('毕业论文')
    expect(formatTaskContext({ projectName: null, milestoneTitle: '实验复现' })).toBe(
      '里程碑：实验复现'
    )
    expect(formatTaskContext({ projectName: null, milestoneTitle: null })).toBe('未关联项目')
  })
})
