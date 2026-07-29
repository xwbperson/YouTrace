import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ExecutionRepository } from '../../src/main/modules/execution/execution-repository'
import { PlanningRepository } from '../../src/main/modules/planning/planning-repository'
import { PlanningService } from '../../src/main/modules/planning/planning-service'
import { WorkspaceManager } from '../../src/main/workspace/workspace-manager'

const DATASET_VERSION = 'youtrace-scale-v1'
const TASK_COUNT = 10_000
const MEMO_COUNT = 10_000
const EFFORT_COUNT = 100_000
const ATTACHMENT_COUNT = 5_000
const TAG_COUNT = 100

let manager: WorkspaceManager
let planning: PlanningService
let executionRepository: ExecutionRepository

beforeAll(async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'youtrace-scale-'))
  manager = new WorkspaceManager(join(fixtureRoot, 'app-data'))
  await manager.create(join(fixtureRoot, 'workspace'), '固定规模性能工作区')
  const database = manager.getDatabase()
  const projectId = uuid(1, 1)
  const now = '2026-07-30T00:00:00.000Z'

  database.transaction(() => {
    database
      .prepare(
        `INSERT INTO projects(
           id, area_id, name, description, status, start_date, target_date,
           success_criteria, progress_mode, created_at, updated_at
         ) VALUES (?, NULL, '规模项目', '固定随机种子性能数据', 'active',
                   '2026-07-01', '2026-12-31', '', 'equal', ?, ?)`
      )
      .run(projectId, now, now)

    const insertTag = database.prepare(
      `INSERT INTO tags(
         id, name, color, icon, description, sort_order, favorite, created_at, updated_at
       ) VALUES (?, ?, '#216E65', NULL, '', ?, 0, ?, ?)`
    )
    for (let index = 0; index < TAG_COUNT; index += 1) {
      insertTag.run(uuid(2, index), `规模标签 ${index}`, index, now, now)
    }

    const insertTask = database.prepare(
      `INSERT INTO tasks(
         id, parent_task_id, project_id, goal_id, milestone_id, title, description,
         status, difficulty, priority, estimated_minutes, progress_weight,
         start_date, due_at, verification_criteria, include_in_progress,
         completed_at, created_at, updated_at
       ) VALUES (?, NULL, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, NULL,
                 '2026-07-30', ?, '', 1, NULL, ?, ?)`
    )
    const insertSearch = database.prepare(
      'INSERT INTO searchable_content(entity_type, entity_id, title, body) VALUES (?, ?, ?, ?)'
    )
    const insertAssignment = database.prepare(
      `INSERT INTO tag_assignments(tag_id, entity_type, entity_id, created_at)
       VALUES (?, ?, ?, ?)`
    )
    for (let index = 0; index < TASK_COUNT; index += 1) {
      const taskId = uuid(3, index)
      const title = index % 200 === 0 ? `认证失败协议分析 ${index}` : `规模任务 ${index}`
      const description = `中英文 mixed task ${index}，用于组合筛选与全文搜索。`
      insertTask.run(
        taskId,
        projectId,
        title,
        description,
        index % 7 === 0 ? 'blocked' : 'ready',
        (index % 5) + 1,
        index % 11 === 0 ? 'high' : 'medium',
        (index % 120) + 10,
        `2026-08-${String((index % 28) + 1).padStart(2, '0')}T12:00:00.000Z`,
        now,
        now
      )
      insertSearch.run('task', taskId, title, description)
      insertAssignment.run(uuid(2, index % TAG_COUNT), 'task', taskId, now)
      insertAssignment.run(uuid(2, (index + 1) % TAG_COUNT), 'task', taskId, now)
    }

    const insertMemo = database.prepare(
      `INSERT INTO memos(
         id, kind, title, body, inbox, created_at, updated_at
       ) VALUES (?, 'memo', ?, ?, 1, ?, ?)`
    )
    for (let index = 0; index < MEMO_COUNT; index += 1) {
      const memoId = uuid(4, index)
      const title = index % 250 === 0 ? `协议状态机备忘 ${index}` : `规模备忘 ${index}`
      const body = `连续中文文本与 punctuation !? ${index}`
      insertMemo.run(memoId, title, body, now, now)
      insertSearch.run('memo', memoId, title, body)
    }

    const insertEffort = database.prepare(
      `INSERT INTO effort_entries(
         id, entity_type, entity_id, source, started_at, ended_at,
         effective_minutes, entity_title_snapshot, project_id_snapshot,
         created_at, updated_at
       ) VALUES (?, 'task', ?, 'manual', ?, ?, ?, ?, ?, ?, ?)`
    )
    for (let index = 0; index < EFFORT_COUNT; index += 1) {
      const day = (index % 28) + 1
      const startedAt = `2026-07-${String(day).padStart(2, '0')}T08:00:00.000Z`
      const endedAt = `2026-07-${String(day).padStart(2, '0')}T08:30:00.000Z`
      insertEffort.run(
        uuid(5, index),
        uuid(3, index % TASK_COUNT),
        startedAt,
        endedAt,
        (index % 60) + 1,
        `规模任务 ${index % TASK_COUNT}`,
        projectId,
        now,
        now
      )
    }

    const insertAttachment = database.prepare(
      `INSERT INTO attachments(
         id, relative_path, original_name, content_hash, size_bytes, mime_type, created_at
       ) VALUES (?, ?, ?, ?, ?, 'application/octet-stream', ?)`
    )
    for (let index = 0; index < ATTACHMENT_COUNT; index += 1) {
      insertAttachment.run(
        uuid(6, index),
        `attachments/scale-${index}.bin`,
        `scale-${index}.bin`,
        index.toString(16).padStart(64, '0'),
        index + 1,
        now
      )
    }
  })()

  const repository = new PlanningRepository(() => manager.getDatabase())
  planning = new PlanningService(repository)
  executionRepository = new ExecutionRepository(() => manager.getDatabase())
}, 120_000)

afterAll(async () => {
  await manager.close()
})

describe('reference-scale release queries', () => {
  it('meets the list, filter, search and monthly-summary P95 targets across 20 runs', () => {
    const list = measure20(() =>
      planning.listTasks({
        projectId: null,
        statuses: [],
        tagIds: [],
        includeDeleted: false,
        limit: 40,
        offset: 0
      })
    )
    const filter = measure20(() =>
      planning.search({
        query: '',
        entityTypes: ['task'],
        statuses: ['ready'],
        tagIds: [uuid(2, 1)],
        projectId: uuid(1, 1),
        dueFrom: '2026-08-01',
        dueTo: '2026-08-28',
        difficulties: [2],
        priorities: ['medium'],
        overdueOnly: false,
        untaggedOnly: false,
        hasEvidence: null,
        limit: 40
      })
    )
    const search = measure20(() =>
      planning.search({
        query: '认证失败',
        entityTypes: [],
        statuses: [],
        tagIds: [],
        projectId: null,
        dueFrom: null,
        dueTo: null,
        difficulties: [],
        priorities: [],
        overdueOnly: false,
        untaggedOnly: false,
        hasEvidence: null,
        limit: 40
      })
    )
    const summary = measure20(() =>
      executionRepository.summarizeEfforts(
        '2026-07-01T00:00:00.000Z',
        '2026-08-01T00:00:00.000Z'
      )
    )

    const report = {
      datasetVersion: DATASET_VERSION,
      counts: {
        tasks: TASK_COUNT,
        memos: MEMO_COUNT,
        efforts: EFFORT_COUNT,
        attachments: ATTACHMENT_COUNT,
        tags: TAG_COUNT
      },
      list,
      filter,
      search,
      summary
    }
    process.stdout.write(`\nYOUTRACE_PERFORMANCE ${JSON.stringify(report)}\n`)
    expect(list.p95).toBeLessThan(500)
    expect(filter.p95).toBeLessThan(1_000)
    expect(search.p95).toBeLessThan(1_000)
    expect(summary.p95).toBeLessThan(2_000)
  }, 120_000)
})

function measure20(operation: () => unknown): { median: number; p95: number } {
  const durations: number[] = []
  for (let index = 0; index < 20; index += 1) {
    const startedAt = performance.now()
    operation()
    durations.push(performance.now() - startedAt)
  }
  durations.sort((left, right) => left - right)
  return {
    median: round(durations[9]!),
    p95: round(durations[18]!)
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

function uuid(namespace: number, index: number): string {
  const head = namespace.toString(16).padStart(8, '0')
  const tail = index.toString(16).padStart(12, '0')
  return `${head}-0000-4000-8000-${tail}`
}
