import { describe, expect, it } from 'vitest'
import { groupTasksByMilestone } from '../../src/renderer/src/pages/planning-task-groups'

describe('planning task milestone groups', () => {
  it('keeps repeated task names under their milestone order and isolates unlinked tasks', () => {
    const milestones = [
      { id: 'chapter-1', title: '第 1 章 概论' },
      { id: 'chapter-2', title: '第 2 章 有限域算术' },
      { id: 'chapter-3', title: '第 3 章 椭圆曲线算术' }
    ]
    const tasks = [
      { id: 'review-2', title: '复习', milestoneId: 'chapter-2' },
      { id: 'preview-1', title: '预习', milestoneId: 'chapter-1' },
      { id: 'preview-2', title: '预习', milestoneId: 'chapter-2' },
      { id: 'inbox', title: '整理课程资料', milestoneId: null },
      { id: 'legacy', title: '核对旧任务', milestoneId: 'removed-chapter' }
    ]

    const groups = groupTasksByMilestone(tasks, milestones)

    expect(groups.map((group) => group.label)).toEqual([
      '第 1 章 概论',
      '第 2 章 有限域算术',
      '第 3 章 椭圆曲线算术',
      '里程碑不可用',
      '未关联里程碑'
    ])
    expect(groups[0]?.tasks.map((task) => task.id)).toEqual(['preview-1'])
    expect(groups[1]?.tasks.map((task) => task.id)).toEqual(['review-2', 'preview-2'])
    expect(groups[2]?.tasks).toEqual([])
    expect(groups[3]?.tasks.map((task) => task.id)).toEqual(['legacy'])
    expect(groups[4]?.tasks.map((task) => task.id)).toEqual(['inbox'])
  })
})
