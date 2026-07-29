import type Database from 'better-sqlite3'
import type {
  CreateProjectInput,
  CreateTagInput,
  CreateTaskInput,
  Project,
  SearchInput,
  SearchResult,
  Tag,
  Task,
  TaskListInput
} from '../../../shared/contracts'

interface ProjectRow {
  id: string
  area_id: string | null
  name: string
  description: string
  status: Project['status']
  start_date: string | null
  target_date: string | null
  success_criteria: string
  progress_mode: Project['progressMode']
  created_at: string
  updated_at: string
}

interface TaskRow {
  id: string
  parent_task_id: string | null
  project_id: string | null
  goal_id: string | null
  milestone_id: string | null
  title: string
  description: string
  status: Task['status']
  difficulty: number | null
  priority: Task['priority']
  estimated_minutes: number | null
  actual_minutes: number
  progress_weight: number | null
  start_date: string | null
  due_at: string | null
  verification_criteria: string
  include_in_progress: number
  completed_at: string | null
  tag_ids: string | null
  created_at: string
  updated_at: string
}

interface TagRow {
  id: string
  name: string
  color: string | null
  icon: string | null
  description: string
  favorite: number
  created_at: string
  updated_at: string
}

export interface MilestoneProgressFact {
  milestoneId: string
  projectId: string
  status: string
  estimatedMinutes: number | null
  manualWeight: number | null
  mastery: number | null
  includeInProgress: boolean
  taskId: string | null
  taskStatus: string | null
  taskEstimatedMinutes: number | null
  taskProgressWeight: number | null
  taskIncludeInProgress: boolean | null
}

export class PlanningRepository {
  constructor(private readonly database: () => Database.Database) {}

  listProjects(): ProjectRow[] {
    return this.database()
      .prepare(
        `SELECT id, area_id, name, description, status, start_date, target_date,
                success_criteria, progress_mode, created_at, updated_at
           FROM projects
          WHERE deleted_at IS NULL AND archived_at IS NULL
          ORDER BY CASE status
                     WHEN 'active' THEN 0
                     WHEN 'planned' THEN 1
                     WHEN 'paused' THEN 2
                     ELSE 3
                   END,
                   COALESCE(target_date, '9999-12-31'),
                   updated_at DESC`
      )
      .all() as ProjectRow[]
  }

  getProject(id: string): ProjectRow | null {
    return (
      (this.database()
        .prepare(
          `SELECT id, area_id, name, description, status, start_date, target_date,
                  success_criteria, progress_mode, created_at, updated_at
             FROM projects
            WHERE id = ? AND deleted_at IS NULL`
        )
        .get(id) as ProjectRow | undefined) ?? null
    )
  }

  insertProject(id: string, input: CreateProjectInput, now: string): void {
    const database = this.database()
    database
      .prepare(
        `INSERT INTO projects (
           id, area_id, name, description, status, start_date, target_date,
           success_criteria, progress_mode, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.areaId,
        input.name,
        input.description,
        input.status,
        input.startDate,
        input.targetDate,
        input.successCriteria,
        input.progressMode,
        now,
        now
      )
    this.upsertSearch(database, 'project', id, input.name, input.description)
    this.insertAudit(database, 'project', id, 'created', null, input, now)
  }

  updateProject(id: string, input: CreateProjectInput, before: ProjectRow, now: string): void {
    const database = this.database()
    database
      .prepare(
        `UPDATE projects
            SET area_id = ?, name = ?, description = ?, status = ?, start_date = ?,
                target_date = ?, success_criteria = ?, progress_mode = ?, updated_at = ?
          WHERE id = ? AND deleted_at IS NULL`
      )
      .run(
        input.areaId,
        input.name,
        input.description,
        input.status,
        input.startDate,
        input.targetDate,
        input.successCriteria,
        input.progressMode,
        now,
        id
      )
    this.upsertSearch(database, 'project', id, input.name, input.description)
    this.insertAudit(database, 'project', id, 'updated', before, input, now)
  }

  trashProject(id: string, now: string): boolean {
    const database = this.database()
    const transaction = database.transaction(() => {
      const result = database
        .prepare('UPDATE projects SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL')
        .run(now, now, id)
      if (result.changes === 0) return false
      database
        .prepare(
          `INSERT INTO trash_entries(id, entity_type, entity_id, deleted_at)
           VALUES (?, 'project', ?, ?)`
        )
        .run(crypto.randomUUID(), id, now)
      database
        .prepare("DELETE FROM searchable_content WHERE entity_type = 'project' AND entity_id = ?")
        .run(id)
      this.insertAudit(database, 'project', id, 'trashed', null, null, now)
      return true
    })
    return transaction()
  }

  getMilestoneProgressFacts(projectId: string): MilestoneProgressFact[] {
    const rows = this.database()
      .prepare(
        `SELECT m.id AS milestone_id,
                m.project_id,
                m.status,
                m.estimated_minutes,
                m.manual_weight,
                m.mastery,
                m.include_in_progress,
                t.id AS task_id,
                t.status AS task_status,
                t.estimated_minutes AS task_estimated_minutes,
                t.progress_weight AS task_progress_weight,
                t.include_in_progress AS task_include_in_progress
           FROM milestones m
           LEFT JOIN tasks t
             ON t.milestone_id = m.id
            AND t.deleted_at IS NULL
          WHERE m.project_id = ?
            AND m.deleted_at IS NULL`
      )
      .all(projectId) as Array<{
      milestone_id: string
      project_id: string
      status: string
      estimated_minutes: number | null
      manual_weight: number | null
      mastery: number | null
      include_in_progress: number
      task_id: string | null
      task_status: string | null
      task_estimated_minutes: number | null
      task_progress_weight: number | null
      task_include_in_progress: number | null
    }>

    return rows.map((row) => ({
      milestoneId: row.milestone_id,
      projectId: row.project_id,
      status: row.status,
      estimatedMinutes: row.estimated_minutes,
      manualWeight: row.manual_weight,
      mastery: row.mastery,
      includeInProgress: row.include_in_progress === 1,
      taskId: row.task_id,
      taskStatus: row.task_status,
      taskEstimatedMinutes: row.task_estimated_minutes,
      taskProgressWeight: row.task_progress_weight,
      taskIncludeInProgress:
        row.task_include_in_progress === null ? null : row.task_include_in_progress === 1
    }))
  }

  listTasks(input: TaskListInput): Task[] {
    const conditions = [input.includeDeleted ? '1 = 1' : 't.deleted_at IS NULL']
    const parameters: unknown[] = []

    if (input.projectId) {
      conditions.push('t.project_id = ?')
      parameters.push(input.projectId)
    }
    if (input.statuses.length > 0) {
      conditions.push(`t.status IN (${input.statuses.map(() => '?').join(', ')})`)
      parameters.push(...input.statuses)
    }
    if (input.tagIds.length > 0) {
      conditions.push(
        `t.id IN (
           SELECT entity_id
             FROM tag_assignments
            WHERE entity_type = 'task'
              AND tag_id IN (${input.tagIds.map(() => '?').join(', ')})
            GROUP BY entity_id
           HAVING COUNT(DISTINCT tag_id) = ?
         )`
      )
      parameters.push(...input.tagIds, input.tagIds.length)
    }

    parameters.push(input.limit, input.offset)
    const rows = this.database()
      .prepare(
        `SELECT t.id, t.parent_task_id, t.project_id, t.goal_id, t.milestone_id,
                t.title, t.description, t.status, t.difficulty, t.priority,
                t.estimated_minutes,
                COALESCE((
                  SELECT SUM(e.effective_minutes)
                    FROM effort_entries e
                   WHERE e.entity_type = 'task'
                     AND e.entity_id = t.id
                     AND e.voided_at IS NULL
                     AND e.deleted_at IS NULL
                ), 0) AS actual_minutes,
                t.progress_weight, t.start_date, t.due_at, t.verification_criteria,
                t.include_in_progress, t.completed_at, t.created_at, t.updated_at,
                GROUP_CONCAT(DISTINCT ta.tag_id) AS tag_ids
           FROM tasks t
           LEFT JOIN tag_assignments ta
             ON ta.entity_type = 'task' AND ta.entity_id = t.id
          WHERE ${conditions.join(' AND ')}
          GROUP BY t.id
          ORDER BY CASE t.status
                     WHEN 'in_progress' THEN 0
                     WHEN 'blocked' THEN 1
                     WHEN 'scheduled' THEN 2
                     WHEN 'ready' THEN 3
                     ELSE 4
                   END,
                   COALESCE(t.due_at, '9999-12-31T23:59:59.999Z'),
                   CASE t.priority
                     WHEN 'critical' THEN 0
                     WHEN 'high' THEN 1
                     WHEN 'medium' THEN 2
                     ELSE 3
                   END,
                   t.updated_at DESC
          LIMIT ? OFFSET ?`
      )
      .all(...parameters) as TaskRow[]

    return rows.map(mapTask)
  }

  getTask(id: string): Task | null {
    const rows = this.listTaskRows('t.id = ?', [id])
    return rows[0] ? mapTask(rows[0]) : null
  }

  insertTask(id: string, input: CreateTaskInput, now: string): void {
    const database = this.database()
    const transaction = database.transaction(() => {
      database
        .prepare(
          `INSERT INTO tasks (
             id, parent_task_id, project_id, goal_id, milestone_id, title, description,
             status, difficulty, priority, estimated_minutes, progress_weight, start_date,
             due_at, verification_criteria, include_in_progress, completed_at, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          input.parentTaskId,
          input.projectId,
          input.goalId,
          input.milestoneId,
          input.title,
          input.description,
          input.status,
          input.difficulty,
          input.priority,
          input.estimatedMinutes,
          input.progressWeight,
          input.startDate,
          input.dueAt,
          input.verificationCriteria,
          input.includeInProgress ? 1 : 0,
          input.status === 'completed' ? now : null,
          now,
          now
        )
      this.replaceTags(database, 'task', id, input.tagIds, now)
      this.upsertSearch(database, 'task', id, input.title, input.description)
      this.insertAudit(database, 'task', id, 'created', null, input, now)
    })
    transaction()
  }

  updateTask(id: string, input: CreateTaskInput, before: Task, now: string): void {
    const database = this.database()
    const completedAt =
      input.status === 'completed'
        ? before.completedAt ?? now
        : before.status === 'completed'
          ? null
          : before.completedAt

    const transaction = database.transaction(() => {
      database
        .prepare(
          `UPDATE tasks
              SET parent_task_id = ?, project_id = ?, goal_id = ?, milestone_id = ?,
                  title = ?, description = ?, status = ?, difficulty = ?, priority = ?,
                  estimated_minutes = ?, progress_weight = ?, start_date = ?, due_at = ?,
                  verification_criteria = ?, include_in_progress = ?, completed_at = ?,
                  updated_at = ?
            WHERE id = ? AND deleted_at IS NULL`
        )
        .run(
          input.parentTaskId,
          input.projectId,
          input.goalId,
          input.milestoneId,
          input.title,
          input.description,
          input.status,
          input.difficulty,
          input.priority,
          input.estimatedMinutes,
          input.progressWeight,
          input.startDate,
          input.dueAt,
          input.verificationCriteria,
          input.includeInProgress ? 1 : 0,
          completedAt,
          now,
          id
        )
      this.replaceTags(database, 'task', id, input.tagIds, now)
      this.upsertSearch(database, 'task', id, input.title, input.description)
      this.insertAudit(database, 'task', id, 'updated', before, input, now)
    })
    transaction()
  }

  trashTask(id: string, now: string): boolean {
    const database = this.database()
    const transaction = database.transaction(() => {
      const result = database
        .prepare('UPDATE tasks SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL')
        .run(now, now, id)
      if (result.changes === 0) return false
      database
        .prepare(
          `INSERT INTO trash_entries(id, entity_type, entity_id, deleted_at)
           VALUES (?, 'task', ?, ?)`
        )
        .run(crypto.randomUUID(), id, now)
      database
        .prepare("DELETE FROM searchable_content WHERE entity_type = 'task' AND entity_id = ?")
        .run(id)
      this.insertAudit(database, 'task', id, 'trashed', null, null, now)
      return true
    })
    return transaction()
  }

  listTags(): Tag[] {
    const rows = this.database()
      .prepare(
        `SELECT id, name, color, icon, description, favorite, created_at, updated_at
           FROM tags
          WHERE archived_at IS NULL AND deleted_at IS NULL
          ORDER BY favorite DESC, sort_order ASC, name COLLATE NOCASE`
      )
      .all() as TagRow[]
    return rows.map(mapTag)
  }

  getTag(id: string): Tag | null {
    const row = this.database()
      .prepare(
        `SELECT id, name, color, icon, description, favorite, created_at, updated_at
           FROM tags WHERE id = ? AND archived_at IS NULL AND deleted_at IS NULL`
      )
      .get(id) as TagRow | undefined
    return row ? mapTag(row) : null
  }

  insertTag(id: string, input: CreateTagInput, now: string): void {
    const database = this.database()
    database
      .prepare(
        `INSERT INTO tags(id, name, color, icon, description, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, input.name, input.color, input.icon, input.description, now, now)
    this.insertAudit(database, 'tag', id, 'created', null, input, now)
  }

  assignTag(tagId: string, entityType: string, entityId: string, now: string): void {
    this.database()
      .prepare(
        `INSERT OR IGNORE INTO tag_assignments(tag_id, entity_type, entity_id, created_at)
         VALUES (?, ?, ?, ?)`
      )
      .run(tagId, entityType, entityId, now)
  }

  search(input: SearchInput): SearchResult[] {
    const entityCondition =
      input.entityTypes.length > 0
        ? `AND entity_type IN (${input.entityTypes.map(() => '?').join(', ')})`
        : ''
    const entityParameters = input.entityTypes

    if ([...input.query].length < 3) {
      const escaped = input.query.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')
      return this.database()
        .prepare(
          `SELECT entity_type, entity_id, title, SUBSTR(body, 1, 180) AS snippet
             FROM searchable_content
            WHERE (title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\')
              ${entityCondition}
            LIMIT ?`
        )
        .all(`%${escaped}%`, `%${escaped}%`, ...entityParameters, input.limit)
        .map(mapSearchResult) as SearchResult[]
    }

    const phrase = `"${input.query.replaceAll('"', '""')}"`
    return this.database()
      .prepare(
        `SELECT entity_type, entity_id, title,
                snippet(searchable_content, 3, '', '', '…', 24) AS snippet
           FROM searchable_content
          WHERE searchable_content MATCH ?
            ${entityCondition}
          ORDER BY rank
          LIMIT ?`
      )
      .all(phrase, ...entityParameters, input.limit)
      .map(mapSearchResult) as SearchResult[]
  }

  private listTaskRows(condition: string, parameters: unknown[]): TaskRow[] {
    return this.database()
      .prepare(
        `SELECT t.id, t.parent_task_id, t.project_id, t.goal_id, t.milestone_id,
                t.title, t.description, t.status, t.difficulty, t.priority,
                t.estimated_minutes,
                COALESCE((
                  SELECT SUM(e.effective_minutes)
                    FROM effort_entries e
                   WHERE e.entity_type = 'task'
                     AND e.entity_id = t.id
                     AND e.voided_at IS NULL
                     AND e.deleted_at IS NULL
                ), 0) AS actual_minutes,
                t.progress_weight, t.start_date, t.due_at, t.verification_criteria,
                t.include_in_progress, t.completed_at, t.created_at, t.updated_at,
                GROUP_CONCAT(DISTINCT ta.tag_id) AS tag_ids
           FROM tasks t
           LEFT JOIN tag_assignments ta
             ON ta.entity_type = 'task' AND ta.entity_id = t.id
          WHERE ${condition}
          GROUP BY t.id`
      )
      .all(...parameters) as TaskRow[]
  }

  private replaceTags(
    database: Database.Database,
    entityType: string,
    entityId: string,
    tagIds: readonly string[],
    now: string
  ): void {
    database
      .prepare('DELETE FROM tag_assignments WHERE entity_type = ? AND entity_id = ?')
      .run(entityType, entityId)
    const insert = database.prepare(
      `INSERT INTO tag_assignments(tag_id, entity_type, entity_id, created_at)
       VALUES (?, ?, ?, ?)`
    )
    for (const tagId of [...new Set(tagIds)]) {
      insert.run(tagId, entityType, entityId, now)
    }
  }

  private upsertSearch(
    database: Database.Database,
    entityType: string,
    entityId: string,
    title: string,
    body: string
  ): void {
    database
      .prepare('DELETE FROM searchable_content WHERE entity_type = ? AND entity_id = ?')
      .run(entityType, entityId)
    database
      .prepare(
        'INSERT INTO searchable_content(entity_type, entity_id, title, body) VALUES (?, ?, ?, ?)'
      )
      .run(entityType, entityId, title, body)
  }

  private insertAudit(
    database: Database.Database,
    entityType: string,
    entityId: string,
    action: string,
    before: unknown,
    after: unknown,
    now: string
  ): void {
    database
      .prepare(
        `INSERT INTO audit_events(
           id, entity_type, entity_id, action, before_json, after_json, occurred_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        crypto.randomUUID(),
        entityType,
        entityId,
        action,
        before === null ? null : JSON.stringify(before),
        after === null ? null : JSON.stringify(after),
        now
      )
  }
}

function mapTask(row: TaskRow): Task {
  return {
    id: row.id,
    parentTaskId: row.parent_task_id,
    projectId: row.project_id,
    goalId: row.goal_id,
    milestoneId: row.milestone_id,
    title: row.title,
    description: row.description,
    status: row.status,
    difficulty: row.difficulty,
    priority: row.priority,
    estimatedMinutes: row.estimated_minutes,
    actualMinutes: row.actual_minutes,
    progressWeight: row.progress_weight,
    startDate: row.start_date,
    dueAt: row.due_at,
    verificationCriteria: row.verification_criteria,
    includeInProgress: row.include_in_progress === 1,
    completedAt: row.completed_at,
    tagIds: row.tag_ids ? row.tag_ids.split(',') : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function mapTag(row: TagRow): Tag {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    icon: row.icon,
    description: row.description,
    favorite: row.favorite === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function mapSearchResult(row: unknown): SearchResult {
  const result = row as {
    entity_type: string
    entity_id: string
    title: string
    snippet: string
  }
  return {
    entityType: result.entity_type,
    entityId: result.entity_id,
    title: result.title,
    snippet: result.snippet
  }
}
