import type Database from 'better-sqlite3'
import type {
  Area,
  CreateAreaInput,
  CreateChecklistItemInput,
  CreateGoalInput,
  CreateMilestoneInput,
  CreateProjectInput,
  CreateTagInput,
  CreateTaskInput,
  Goal,
  Milestone,
  Project,
  ProjectHistoryEntry,
  ProjectHistoryReport,
  ParsedSearchInput,
  SavedView,
  SaveViewInput,
  SearchResult,
  Tag,
  TagStats,
  Task,
  TaskChecklistItem,
  TaskDependency,
  TaskListInput,
  TaskRecurrence
} from '../../../shared/contracts'

interface AreaRow {
  id: string
  name: string
  color: string | null
  icon: string | null
  description: string
  created_at: string
  updated_at: string
  archived_at: string | null
}

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
  checklist_progress_enabled: number
  checklist_count: number
  checklist_checked: number
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

interface GoalRow {
  id: string
  project_id: string | null
  title: string
  success_criteria: string
  target_date: string | null
  measure_type: Goal['measureType']
  status: Goal['status']
  created_at: string
  updated_at: string
}

interface MilestoneRow {
  id: string
  project_id: string | null
  goal_id: string | null
  title: string
  description: string
  planned_date: string | null
  completed_date: string | null
  estimated_minutes: number | null
  manual_weight: number | null
  mastery: number | null
  verification_criteria: string
  status: Milestone['status']
  include_in_progress: number
  created_at: string
  updated_at: string
}

interface ProjectHistoryEffortRow {
  id: string
  entity_type: string
  entity_id: string | null
  source: 'timer' | 'manual'
  effective_minutes: number
  result: string
  next_step: string
  entity_title_snapshot: string | null
  started_at: string
}

interface ProjectHistoryChangeRow {
  id: string
  entity_type: string
  entity_id: string | null
  action: string
  title: string | null
  reason: string | null
  occurred_at: string
  total_count: number
}

const PROJECT_HISTORY_ENTRY_LIMIT = 200

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
  taskParentTaskId: string | null
  checklistProgressEnabled: boolean
  checklistCount: number
  checklistChecked: number
}

export class PlanningRepository {
  constructor(private readonly database: () => Database.Database) {}

  listAreas(includeArchived: boolean): Area[] {
    const rows = this.database()
      .prepare(
        `SELECT id, name, color, icon, description, created_at, updated_at, archived_at
           FROM areas
          WHERE deleted_at IS NULL ${includeArchived ? '' : 'AND archived_at IS NULL'}
          ORDER BY archived_at IS NOT NULL, name COLLATE NOCASE`
      )
      .all() as AreaRow[]
    return rows.map(mapArea)
  }

  getArea(id: string): Area | null {
    const row = this.database()
      .prepare(
        `SELECT id, name, color, icon, description, created_at, updated_at, archived_at
           FROM areas WHERE id = ? AND deleted_at IS NULL`
      )
      .get(id) as AreaRow | undefined
    return row ? mapArea(row) : null
  }

  insertArea(id: string, input: CreateAreaInput, now: string): void {
    this.database()
      .prepare(
        `INSERT INTO areas(id, name, color, icon, description, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, input.name, input.color, input.icon, input.description, now, now)
    this.insertAudit(this.database(), 'area', id, 'created', null, input, now)
  }

  updateArea(
    id: string,
    input: CreateAreaInput,
    archived: boolean,
    before: Area,
    now: string
  ): void {
    this.database()
      .prepare(
        `UPDATE areas
            SET name = ?, color = ?, icon = ?, description = ?,
                archived_at = ?, updated_at = ?
          WHERE id = ? AND deleted_at IS NULL`
      )
      .run(
        input.name,
        input.color,
        input.icon,
        input.description,
        archived ? now : null,
        now,
        id
      )
    const action = archived && !before.archived
      ? 'archived'
      : !archived && before.archived
        ? 'restored'
        : 'updated'
    this.insertAudit(this.database(), 'area', id, action, before, input, now)
  }

  trashArea(id: string, now: string): boolean {
    return this.trashEntity('areas', 'area', id, now, false)
  }

  listProjects(includeArchived = false): ProjectRow[] {
    return this.database()
      .prepare(
        `SELECT id, area_id, name, description, status, start_date, target_date,
                success_criteria, progress_mode, created_at, updated_at
           FROM projects
          WHERE deleted_at IS NULL ${includeArchived ? '' : 'AND archived_at IS NULL'}
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

  listProjectHistory(projectId: string): ProjectHistoryReport {
    const database = this.database()
    const effortSummary = database
      .prepare(
        `SELECT COUNT(*) AS count, COALESCE(SUM(effective_minutes), 0) AS minutes
           FROM effort_entries
          WHERE project_id_snapshot = ?
            AND voided_at IS NULL
            AND deleted_at IS NULL`
      )
      .get(projectId) as { count: number; minutes: number }
    const effortRows = database
      .prepare(
        `SELECT id, entity_type, entity_id, source, effective_minutes, result, next_step,
                entity_title_snapshot, started_at
           FROM effort_entries
          WHERE project_id_snapshot = ?
            AND voided_at IS NULL
            AND deleted_at IS NULL
          ORDER BY started_at DESC
          LIMIT ?`
      )
      .all(projectId, PROJECT_HISTORY_ENTRY_LIMIT) as ProjectHistoryEffortRow[]
    const changeRows = database
      .prepare(
        `SELECT a.id, a.entity_type, a.entity_id, a.action, a.reason, a.occurred_at,
                COUNT(*) OVER() AS total_count,
                CASE a.entity_type
                  WHEN 'project' THEN p.name
                  WHEN 'goal' THEN g.title
                  WHEN 'milestone' THEN m.title
                  WHEN 'task' THEN COALESCE(
                    t.title,
                    (SELECT e.entity_title_snapshot
                       FROM effort_entries e
                      WHERE e.entity_type = 'task'
                        AND e.entity_id = a.entity_id
                        AND e.project_id_snapshot = ?
                      ORDER BY e.started_at DESC
                      LIMIT 1)
                  )
                  WHEN 'effort' THEN effort.entity_title_snapshot
                  ELSE NULL
                END AS title
           FROM audit_events a
           LEFT JOIN projects p ON a.entity_type = 'project' AND p.id = a.entity_id
           LEFT JOIN goals g ON a.entity_type = 'goal' AND g.id = a.entity_id
           LEFT JOIN milestones m ON a.entity_type = 'milestone' AND m.id = a.entity_id
           LEFT JOIN tasks t ON a.entity_type = 'task' AND t.id = a.entity_id
           LEFT JOIN effort_entries effort
             ON a.entity_type = 'effort' AND effort.id = a.entity_id
          WHERE (a.entity_type = 'project' AND a.entity_id = ?)
             OR (a.entity_type = 'goal' AND g.project_id = ?)
             OR (a.entity_type = 'milestone' AND m.project_id = ?)
             OR (
               a.entity_type = 'task'
               AND (
                 t.project_id = ?
                 OR EXISTS (
                   SELECT 1
                     FROM effort_entries task_effort
                    WHERE task_effort.entity_type = 'task'
                      AND task_effort.entity_id = a.entity_id
                      AND task_effort.project_id_snapshot = ?
                 )
               )
             )
             OR (
               a.entity_type = 'effort'
               AND effort.project_id_snapshot = ?
               AND a.action = 'corrected'
             )
          ORDER BY a.occurred_at DESC
          LIMIT ?`
      )
      .all(
        projectId,
        projectId,
        projectId,
        projectId,
        projectId,
        projectId,
        projectId,
        PROJECT_HISTORY_ENTRY_LIMIT
      ) as ProjectHistoryChangeRow[]

    const effortEntries: ProjectHistoryEntry[] = effortRows.map((row) => ({
      id: row.id,
      kind: 'effort',
      entityType: row.entity_type,
      entityId: row.entity_id,
      title: row.entity_title_snapshot ?? '未命名投入',
      action: row.source,
      summary: row.result || row.next_step || '未填写结果',
      minutes: row.effective_minutes,
      source: row.source,
      occurredAt: row.started_at
    }))
    const changeEntries: ProjectHistoryEntry[] = changeRows.map((row) => ({
      id: row.id,
      kind: 'change',
      entityType: row.entity_type,
      entityId: row.entity_id,
      title: row.title ?? entityTypeLabel(row.entity_type),
      action: row.action,
      summary: changeSummary(row.action, row.reason),
      minutes: null,
      source: null,
      occurredAt: row.occurred_at
    }))

    const entries = [...effortEntries, ...changeEntries]
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
      .slice(0, PROJECT_HISTORY_ENTRY_LIMIT)
    const changeCount = changeRows[0]?.total_count ?? 0
    return {
      projectId,
      effortCount: effortSummary.count,
      totalMinutes: effortSummary.minutes,
      changeCount,
      hasMore: effortSummary.count + changeCount > entries.length,
      entries
    }
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
                target_date = ?, success_criteria = ?, progress_mode = ?,
                archived_at = ?, updated_at = ?
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
        input.status === 'archived' ? now : null,
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

  listGoals(projectId: string | null): GoalRow[] {
    const condition = projectId === null ? 'project_id IS NULL' : 'project_id = ?'
    return this.database()
      .prepare(
        `SELECT id, project_id, title, success_criteria, target_date, measure_type,
                status, created_at, updated_at
           FROM goals
          WHERE ${condition} AND deleted_at IS NULL AND archived_at IS NULL
          ORDER BY COALESCE(target_date, '9999-12-31'), created_at`
      )
      .all(...(projectId === null ? [] : [projectId])) as GoalRow[]
  }

  getGoal(id: string): GoalRow | null {
    return (
      (this.database()
        .prepare(
          `SELECT id, project_id, title, success_criteria, target_date, measure_type,
                  status, created_at, updated_at
             FROM goals WHERE id = ? AND deleted_at IS NULL`
        )
        .get(id) as GoalRow | undefined) ?? null
    )
  }

  insertGoal(id: string, input: CreateGoalInput, now: string): void {
    const database = this.database()
    database
      .prepare(
        `INSERT INTO goals(
           id, project_id, title, success_criteria, target_date, measure_type,
           status, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.projectId,
        input.title,
        input.successCriteria,
        input.targetDate,
        input.measureType,
        input.status,
        now,
        now
      )
    this.upsertSearch(database, 'goal', id, input.title, input.successCriteria)
    this.insertAudit(database, 'goal', id, 'created', null, input, now)
  }

  updateGoal(id: string, input: CreateGoalInput, before: GoalRow, now: string): void {
    const database = this.database()
    database
      .prepare(
        `UPDATE goals
            SET project_id = ?, title = ?, success_criteria = ?, target_date = ?,
                measure_type = ?, status = ?, updated_at = ?
          WHERE id = ? AND deleted_at IS NULL`
      )
      .run(
        input.projectId,
        input.title,
        input.successCriteria,
        input.targetDate,
        input.measureType,
        input.status,
        now,
        id
      )
    this.upsertSearch(database, 'goal', id, input.title, input.successCriteria)
    this.insertAudit(database, 'goal', id, 'updated', before, input, now)
  }

  trashGoal(id: string, now: string): boolean {
    return this.trashEntity('goals', 'goal', id, now)
  }

  listMilestones(projectId: string): MilestoneRow[] {
    return this.database()
      .prepare(
        `SELECT id, project_id, goal_id, title, description, planned_date,
                completed_date, estimated_minutes, manual_weight, mastery,
                verification_criteria, status, include_in_progress, created_at, updated_at
           FROM milestones
          WHERE project_id = ? AND deleted_at IS NULL AND archived_at IS NULL
          ORDER BY COALESCE(planned_date, '9999-12-31'), created_at`
      )
      .all(projectId) as MilestoneRow[]
  }

  getMilestone(id: string): MilestoneRow | null {
    return (
      (this.database()
        .prepare(
          `SELECT id, project_id, goal_id, title, description, planned_date,
                  completed_date, estimated_minutes, manual_weight, mastery,
                  verification_criteria, status, include_in_progress, created_at, updated_at
             FROM milestones WHERE id = ? AND deleted_at IS NULL`
        )
        .get(id) as MilestoneRow | undefined) ?? null
    )
  }

  insertMilestone(id: string, input: CreateMilestoneInput, now: string): void {
    const database = this.database()
    database
      .prepare(
        `INSERT INTO milestones(
           id, project_id, goal_id, title, description, planned_date, completed_date,
           estimated_minutes, manual_weight, mastery, verification_criteria, status,
           include_in_progress, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.projectId,
        input.goalId,
        input.title,
        input.description,
        input.plannedDate,
        ['completed', 'verified', 'accepted'].includes(input.status) ? now.slice(0, 10) : null,
        input.estimatedMinutes,
        input.manualWeight,
        input.mastery,
        input.verificationCriteria,
        input.status,
        input.includeInProgress ? 1 : 0,
        now,
        now
      )
    this.upsertSearch(database, 'milestone', id, input.title, input.description)
    this.insertAudit(database, 'milestone', id, 'created', null, input, now)
  }

  updateMilestone(
    id: string,
    input: CreateMilestoneInput,
    before: MilestoneRow,
    now: string
  ): void {
    const completedDate = ['completed', 'verified', 'accepted'].includes(input.status)
      ? before.completed_date ?? now.slice(0, 10)
      : null
    const database = this.database()
    database
      .prepare(
        `UPDATE milestones
            SET project_id = ?, goal_id = ?, title = ?, description = ?, planned_date = ?,
                completed_date = ?, estimated_minutes = ?, manual_weight = ?, mastery = ?,
                verification_criteria = ?, status = ?, include_in_progress = ?, updated_at = ?
          WHERE id = ? AND deleted_at IS NULL`
      )
      .run(
        input.projectId,
        input.goalId,
        input.title,
        input.description,
        input.plannedDate,
        completedDate,
        input.estimatedMinutes,
        input.manualWeight,
        input.mastery,
        input.verificationCriteria,
        input.status,
        input.includeInProgress ? 1 : 0,
        now,
        id
      )
    this.upsertSearch(database, 'milestone', id, input.title, input.description)
    this.insertAudit(database, 'milestone', id, 'updated', before, input, now)
  }

  trashMilestone(id: string, now: string): boolean {
    return this.trashEntity('milestones', 'milestone', id, now)
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
                t.parent_task_id AS task_parent_task_id,
                t.status AS task_status,
                t.estimated_minutes AS task_estimated_minutes,
                t.progress_weight AS task_progress_weight,
                t.include_in_progress AS task_include_in_progress,
                EXISTS(SELECT 1 FROM task_progress_settings ps
                        WHERE ps.task_id = t.id AND ps.checklist_enabled = 1)
                  AS checklist_progress_enabled,
                (SELECT COUNT(*) FROM task_checklist_items ci WHERE ci.task_id = t.id)
                  AS checklist_count,
                (SELECT COUNT(*) FROM task_checklist_items ci
                  WHERE ci.task_id = t.id AND ci.checked = 1) AS checklist_checked
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
      task_parent_task_id: string | null
      task_status: string | null
      task_estimated_minutes: number | null
      task_progress_weight: number | null
      task_include_in_progress: number | null
      checklist_progress_enabled: number
      checklist_count: number
      checklist_checked: number
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
      taskParentTaskId: row.task_parent_task_id,
      taskStatus: row.task_status,
      taskEstimatedMinutes: row.task_estimated_minutes,
      taskProgressWeight: row.task_progress_weight,
      taskIncludeInProgress:
        row.task_include_in_progress === null ? null : row.task_include_in_progress === 1,
      checklistProgressEnabled: row.checklist_progress_enabled === 1,
      checklistCount: row.checklist_count,
      checklistChecked: row.checklist_checked
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
                t.include_in_progress,
                EXISTS(SELECT 1 FROM task_progress_settings ps
                        WHERE ps.task_id = t.id AND ps.checklist_enabled = 1)
                  AS checklist_progress_enabled,
                (SELECT COUNT(*) FROM task_checklist_items ci WHERE ci.task_id = t.id)
                  AS checklist_count,
                (SELECT COUNT(*) FROM task_checklist_items ci
                  WHERE ci.task_id = t.id AND ci.checked = 1) AS checklist_checked,
                t.completed_at, t.created_at, t.updated_at,
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

  listDependencyEdges(): Array<{ taskId: string; prerequisiteTaskId: string }> {
    return (
      this.database()
        .prepare('SELECT task_id, prerequisite_task_id FROM task_dependencies')
        .all() as Array<{ task_id: string; prerequisite_task_id: string }>
    ).map((row) => ({
      taskId: row.task_id,
      prerequisiteTaskId: row.prerequisite_task_id
    }))
  }

  addTaskDependency(
    taskId: string,
    prerequisiteTaskId: string,
    overrideReason: string | null,
    now: string
  ): void {
    this.database()
      .prepare(
        `INSERT OR IGNORE INTO task_dependencies(
           task_id, prerequisite_task_id, override_reason, created_at
         ) VALUES (?, ?, ?, ?)`
      )
      .run(taskId, prerequisiteTaskId, overrideReason, now)
  }

  listTaskDependencies(taskId: string): TaskDependency[] {
    const rows = this.database()
      .prepare(
        `SELECT d.task_id, d.prerequisite_task_id, d.override_reason, d.created_at,
                t.title AS prerequisite_title, t.status AS prerequisite_status,
                t.project_id AS prerequisite_project_id,
                CASE
                  WHEN t.deleted_at IS NOT NULL THEN 0
                  WHEN p.id IS NOT NULL AND p.deleted_at IS NOT NULL THEN 0
                  ELSE 1
                END AS prerequisite_available
           FROM task_dependencies d
           JOIN tasks t ON t.id = d.prerequisite_task_id
           LEFT JOIN projects p ON p.id = t.project_id
          WHERE d.task_id = ?
          ORDER BY d.created_at`
      )
      .all(taskId) as Array<{
      task_id: string
      prerequisite_task_id: string
      override_reason: string | null
      created_at: string
      prerequisite_title: string
      prerequisite_status: Task['status']
      prerequisite_project_id: string | null
      prerequisite_available: number
    }>
    return rows.map((row) => ({
      taskId: row.task_id,
      prerequisiteTaskId: row.prerequisite_task_id,
      prerequisiteTitle: row.prerequisite_title,
      prerequisiteStatus: row.prerequisite_status,
      prerequisiteProjectId: row.prerequisite_project_id,
      prerequisiteAvailable: row.prerequisite_available === 1,
      blockedReason:
        row.prerequisite_available === 0
          ? '前置任务或其项目在回收站中'
          : row.prerequisite_status !== 'completed'
            ? '前置任务尚未完成'
            : null,
      overrideReason: row.override_reason,
      createdAt: row.created_at
    }))
  }

  recordDependencyOverride(taskId: string, reason: string, now: string): void {
    this.insertAudit(
      this.database(),
      'task',
      taskId,
      'dependency_overridden',
      null,
      { reason },
      now
    )
  }

  listChecklist(taskId: string): TaskChecklistItem[] {
    return (
      this.database()
        .prepare(
          `SELECT id, task_id, text, sort_order, checked, created_at, updated_at
             FROM task_checklist_items WHERE task_id = ? ORDER BY sort_order, created_at`
        )
        .all(taskId) as Array<{
        id: string
        task_id: string
        text: string
        sort_order: number
        checked: number
        created_at: string
        updated_at: string
      }>
    ).map(mapChecklist)
  }

  insertChecklistItem(
    id: string,
    input: CreateChecklistItemInput,
    now: string
  ): TaskChecklistItem {
    const nextOrder = (
      this.database()
        .prepare(
          'SELECT COALESCE(MAX(sort_order), -1) + 1 AS value FROM task_checklist_items WHERE task_id = ?'
        )
        .get(input.taskId) as { value: number }
    ).value
    this.database()
      .prepare(
        `INSERT INTO task_checklist_items(
           id, task_id, text, sort_order, checked, created_at, updated_at
         ) VALUES (?, ?, ?, ?, 0, ?, ?)`
      )
      .run(id, input.taskId, input.text, nextOrder, now, now)
    return this.listChecklist(input.taskId).find((item) => item.id === id)!
  }

  getChecklistItem(id: string): TaskChecklistItem | null {
    const row = this.database()
      .prepare(
        `SELECT id, task_id, text, sort_order, checked, created_at, updated_at
           FROM task_checklist_items WHERE id = ?`
      )
      .get(id) as
      | {
          id: string
          task_id: string
          text: string
          sort_order: number
          checked: number
          created_at: string
          updated_at: string
        }
      | undefined
    return row ? mapChecklist(row) : null
  }

  updateChecklistItem(
    id: string,
    text: string,
    checked: boolean,
    now: string
  ): TaskChecklistItem | null {
    const result = this.database()
      .prepare(
        'UPDATE task_checklist_items SET text = ?, checked = ?, updated_at = ? WHERE id = ?'
      )
      .run(text, checked ? 1 : 0, now, id)
    return result.changes > 0 ? this.getChecklistItem(id) : null
  }

  deleteChecklistItem(id: string): boolean {
    return this.database().prepare('DELETE FROM task_checklist_items WHERE id = ?').run(id).changes > 0
  }

  setChecklistProgress(taskId: string, enabled: boolean, now: string): void {
    this.database()
      .prepare(
        `INSERT INTO task_progress_settings(task_id, checklist_enabled, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(task_id) DO UPDATE SET
           checklist_enabled = excluded.checklist_enabled,
           updated_at = excluded.updated_at`
      )
      .run(taskId, enabled ? 1 : 0, now)
    this.insertAudit(
      this.database(),
      'task',
      taskId,
      'checklist_progress_changed',
      null,
      { enabled },
      now
    )
  }

  getTaskRecurrence(taskId: string): TaskRecurrence | null {
    const row = this.database()
      .prepare(
        `SELECT task_id, series_id, frequency, interval_value, weekdays_json,
                next_occurrence, active, created_at, updated_at
           FROM task_recurrence_rules WHERE task_id = ?`
      )
      .get(taskId) as
      | {
          task_id: string
          series_id: string
          frequency: TaskRecurrence['frequency']
          interval_value: number
          weekdays_json: string
          next_occurrence: string
          active: number
          created_at: string
          updated_at: string
        }
      | undefined
    return row ? mapRecurrence(row) : null
  }

  setTaskRecurrence(
    taskId: string,
    recurrence: Omit<TaskRecurrence, 'taskId' | 'createdAt' | 'updatedAt'>,
    now: string
  ): TaskRecurrence {
    this.database()
      .prepare(
        `INSERT INTO task_recurrence_rules(
           task_id, series_id, frequency, interval_value, weekdays_json,
           next_occurrence, active, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(task_id) DO UPDATE SET
           series_id = excluded.series_id,
           frequency = excluded.frequency,
           interval_value = excluded.interval_value,
           weekdays_json = excluded.weekdays_json,
           next_occurrence = excluded.next_occurrence,
           active = excluded.active,
           updated_at = excluded.updated_at`
      )
      .run(
        taskId,
        recurrence.seriesId,
        recurrence.frequency,
        recurrence.intervalValue,
        JSON.stringify(recurrence.weekdays),
        recurrence.nextOccurrence,
        recurrence.active ? 1 : 0,
        now,
        now
      )
    return this.getTaskRecurrence(taskId)!
  }

  disableTaskRecurrence(taskId: string, now: string): void {
    this.database()
      .prepare('UPDATE task_recurrence_rules SET active = 0, updated_at = ? WHERE task_id = ?')
      .run(now, taskId)
  }

  removeTaskRecurrence(taskId: string): void {
    this.database().prepare('DELETE FROM task_recurrence_rules WHERE task_id = ?').run(taskId)
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

  getTagStats(tagId: string): TagStats {
    const database = this.database()
    const entityRows = database
      .prepare(
        `SELECT entity_type, COUNT(*) AS count
           FROM tag_assignments WHERE tag_id = ? GROUP BY entity_type`
      )
      .all(tagId) as Array<{ entity_type: string; count: number }>
    const effort = database
      .prepare(
        `SELECT COALESCE(SUM(effective_minutes), 0) AS minutes
           FROM effort_entries e
           JOIN tag_assignments ta ON ta.entity_type = 'effort' AND ta.entity_id = e.id
          WHERE ta.tag_id = ? AND e.voided_at IS NULL AND e.deleted_at IS NULL`
      )
      .get(tagId) as { minutes: number }
    const completed = database
      .prepare(
        `SELECT COUNT(*) AS count
           FROM tasks t JOIN tag_assignments ta
             ON ta.entity_type = 'task' AND ta.entity_id = t.id
          WHERE ta.tag_id = ? AND t.status = 'completed' AND t.deleted_at IS NULL`
      )
      .get(tagId) as { count: number }
    const difficultyRows = database
      .prepare(
        `SELECT CAST(t.difficulty AS TEXT) AS difficulty, COUNT(*) AS count
           FROM tasks t JOIN tag_assignments ta
             ON ta.entity_type = 'task' AND ta.entity_id = t.id
          WHERE ta.tag_id = ? AND t.deleted_at IS NULL AND t.difficulty IS NOT NULL
          GROUP BY t.difficulty`
      )
      .all(tagId) as Array<{ difficulty: string; count: number }>
    const risk = database
      .prepare(
        `SELECT COUNT(*) AS count
           FROM countdowns c JOIN tag_assignments ta
             ON ta.entity_type = 'countdown' AND ta.entity_id = c.id
          WHERE ta.tag_id = ? AND c.deleted_at IS NULL
            AND datetime(c.target_at) <= datetime('now', '+14 days')`
      )
      .get(tagId) as { count: number }
    return {
      tagId,
      entityCounts: Object.fromEntries(entityRows.map((row) => [row.entity_type, row.count])),
      totalEffortMinutes: effort.minutes,
      completedTasks: completed.count,
      difficultyDistribution: Object.fromEntries(
        difficultyRows.map((row) => [row.difficulty, row.count])
      ),
      atRiskCountdowns: risk.count
    }
  }

  mergeTags(sourceTagId: string, targetTagId: string, now: string): void {
    const database = this.database()
    const transaction = database.transaction(() => {
      database
        .prepare(
          `INSERT OR IGNORE INTO tag_assignments(tag_id, entity_type, entity_id, created_at)
           SELECT ?, entity_type, entity_id, ? FROM tag_assignments WHERE tag_id = ?`
        )
        .run(targetTagId, now, sourceTagId)
      database.prepare('DELETE FROM tag_assignments WHERE tag_id = ?').run(sourceTagId)
      database
        .prepare('UPDATE tags SET archived_at = ?, updated_at = ? WHERE id = ?')
        .run(now, now, sourceTagId)
      this.insertAudit(
        database,
        'tag',
        targetTagId,
        'merged',
        { sourceTagId },
        { targetTagId },
        now
      )
    })
    transaction()
  }

  listSavedViews(): SavedView[] {
    return (
      this.database()
        .prepare(
          `SELECT id, name, filters_json, is_preset, created_at, updated_at
             FROM saved_views WHERE deleted_at IS NULL
            ORDER BY is_preset DESC, name COLLATE NOCASE`
        )
        .all() as Array<{
        id: string
        name: string
        filters_json: string
        is_preset: number
        created_at: string
        updated_at: string
      }>
    ).map((row) => ({
      id: row.id,
      name: row.name,
      filters: JSON.parse(row.filters_json) as SavedView['filters'],
      isPreset: row.is_preset === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }))
  }

  insertSavedView(id: string, input: SaveViewInput, isPreset: boolean, now: string): SavedView {
    this.database()
      .prepare(
        `INSERT INTO saved_views(
           id, name, filters_json, is_preset, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(id, input.name, JSON.stringify(input.filters), isPreset ? 1 : 0, now, now)
    return this.listSavedViews().find((view) => view.id === id)!
  }

  deleteSavedView(id: string, now: string): boolean {
    return this.database()
      .prepare(
        'UPDATE saved_views SET deleted_at = ?, updated_at = ? WHERE id = ? AND is_preset = 0 AND deleted_at IS NULL'
      )
      .run(now, now, id).changes > 0
  }

  search(input: ParsedSearchInput): SearchResult[] {
    const hasTaskFilters =
      input.statuses.length > 0 ||
      input.tagIds.length > 0 ||
      input.projectId !== null ||
      input.dueFrom !== null ||
      input.dueTo !== null ||
      input.difficulties.length > 0 ||
      input.priorities.length > 0 ||
      input.overdueOnly ||
      input.untaggedOnly ||
      input.hasEvidence !== null
    if (hasTaskFilters || input.query.length === 0) return this.searchTasks(input)

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

  private searchTasks(input: ParsedSearchInput): SearchResult[] {
    if (input.entityTypes.length > 0 && !input.entityTypes.includes('task')) return []
    const conditions = ['t.deleted_at IS NULL']
    const parameters: unknown[] = []
    if (input.query) {
      if ([...input.query].length < 3) {
        const escaped = input.query.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')
        conditions.push("(t.title LIKE ? ESCAPE '\\' OR t.description LIKE ? ESCAPE '\\')")
        parameters.push(`%${escaped}%`, `%${escaped}%`)
      } else {
        conditions.push(
          `t.id IN (
             SELECT entity_id FROM searchable_content
              WHERE searchable_content MATCH ? AND entity_type = 'task'
           )`
        )
        parameters.push(`"${input.query.replaceAll('"', '""')}"`)
      }
    }
    if (input.statuses.length) {
      conditions.push(`t.status IN (${input.statuses.map(() => '?').join(', ')})`)
      parameters.push(...input.statuses)
    }
    if (input.tagIds.length) {
      conditions.push(
        `t.id IN (
           SELECT entity_id FROM tag_assignments
            WHERE entity_type = 'task'
              AND tag_id IN (${input.tagIds.map(() => '?').join(', ')})
            GROUP BY entity_id HAVING COUNT(DISTINCT tag_id) = ?
         )`
      )
      parameters.push(...input.tagIds, input.tagIds.length)
    }
    if (input.projectId) {
      conditions.push('t.project_id = ?')
      parameters.push(input.projectId)
    }
    if (input.dueFrom) {
      conditions.push('date(t.due_at) >= date(?)')
      parameters.push(input.dueFrom)
    }
    if (input.dueTo) {
      conditions.push('date(t.due_at) <= date(?)')
      parameters.push(input.dueTo)
    }
    if (input.difficulties.length) {
      conditions.push(`t.difficulty IN (${input.difficulties.map(() => '?').join(', ')})`)
      parameters.push(...input.difficulties)
    }
    if (input.priorities.length) {
      conditions.push(`t.priority IN (${input.priorities.map(() => '?').join(', ')})`)
      parameters.push(...input.priorities)
    }
    if (input.overdueOnly) {
      conditions.push("datetime(t.due_at) < datetime('now')")
      conditions.push("t.status NOT IN ('completed', 'cancelled')")
    }
    if (input.untaggedOnly) {
      conditions.push(
        `NOT EXISTS(
           SELECT 1 FROM tag_assignments untagged
            WHERE untagged.entity_type = 'task' AND untagged.entity_id = t.id
         )`
      )
    }
    if (input.hasEvidence !== null) {
      conditions.push(
        `${input.hasEvidence ? '' : 'NOT '}EXISTS(
           SELECT 1 FROM entity_evidence ee
            WHERE ee.entity_type = 'task' AND ee.entity_id = t.id
         )`
      )
    }
    parameters.push(input.limit)
    return (
      this.database()
        .prepare(
          `SELECT 'task' AS entity_type, t.id AS entity_id, t.title,
                  SUBSTR(t.description, 1, 180) AS snippet
             FROM tasks t
            WHERE ${conditions.join(' AND ')}
            ORDER BY COALESCE(t.due_at, '9999-12-31'), t.updated_at DESC
            LIMIT ?`
        )
        .all(...parameters) as Array<{
        entity_type: string
        entity_id: string
        title: string
        snippet: string
      }>
    ).map(mapSearchResult)
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
                t.include_in_progress,
                EXISTS(SELECT 1 FROM task_progress_settings ps
                        WHERE ps.task_id = t.id AND ps.checklist_enabled = 1)
                  AS checklist_progress_enabled,
                (SELECT COUNT(*) FROM task_checklist_items ci WHERE ci.task_id = t.id)
                  AS checklist_count,
                (SELECT COUNT(*) FROM task_checklist_items ci
                  WHERE ci.task_id = t.id AND ci.checked = 1) AS checklist_checked,
                t.completed_at, t.created_at, t.updated_at,
                GROUP_CONCAT(DISTINCT ta.tag_id) AS tag_ids
           FROM tasks t
           LEFT JOIN tag_assignments ta
             ON ta.entity_type = 'task' AND ta.entity_id = t.id
          WHERE ${condition}
          GROUP BY t.id`
      )
      .all(...parameters) as TaskRow[]
  }

  private trashEntity(
    table: 'areas' | 'goals' | 'milestones',
    entityType: 'area' | 'goal' | 'milestone',
    id: string,
    now: string,
    searchable = true
  ): boolean {
    const database = this.database()
    const transaction = database.transaction(() => {
      const result = database
        .prepare(`UPDATE ${table} SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`)
        .run(now, now, id)
      if (result.changes === 0) return false
      database
        .prepare(
          `INSERT INTO trash_entries(id, entity_type, entity_id, deleted_at)
           VALUES (?, ?, ?, ?)`
        )
        .run(crypto.randomUUID(), entityType, id, now)
      if (searchable) {
        database
          .prepare('DELETE FROM searchable_content WHERE entity_type = ? AND entity_id = ?')
          .run(entityType, id)
      }
      this.insertAudit(database, entityType, id, 'trashed', null, null, now)
      return true
    })
    return transaction()
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
    checklistProgressEnabled: row.checklist_progress_enabled === 1,
    progress:
      row.checklist_progress_enabled === 1 && row.checklist_count > 0
        ? row.checklist_checked / row.checklist_count
        : row.status === 'completed'
          ? 1
          : 0,
    completedAt: row.completed_at,
    tagIds: row.tag_ids ? row.tag_ids.split(',') : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function mapArea(row: AreaRow): Area {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    icon: row.icon,
    description: row.description,
    archived: row.archived_at !== null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function mapChecklist(row: {
  id: string
  task_id: string
  text: string
  sort_order: number
  checked: number
  created_at: string
  updated_at: string
}): TaskChecklistItem {
  return {
    id: row.id,
    taskId: row.task_id,
    text: row.text,
    sortOrder: row.sort_order,
    checked: row.checked === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function mapRecurrence(row: {
  task_id: string
  series_id: string
  frequency: TaskRecurrence['frequency']
  interval_value: number
  weekdays_json: string
  next_occurrence: string
  active: number
  created_at: string
  updated_at: string
}): TaskRecurrence {
  return {
    taskId: row.task_id,
    seriesId: row.series_id,
    frequency: row.frequency,
    intervalValue: row.interval_value,
    weekdays: JSON.parse(row.weekdays_json) as number[],
    nextOccurrence: row.next_occurrence,
    active: row.active === 1,
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

function entityTypeLabel(entityType: string): string {
  return (
    {
      project: '项目',
      goal: '目标',
      milestone: '里程碑',
      task: '任务',
      effort: '投入记录'
    }[entityType] ?? '项目活动'
  )
}

function changeSummary(action: string, reason: string | null): string {
  if (reason) return reason
  return (
    {
      created: '已创建',
      updated: '已更新',
      trashed: '已移入回收站',
      restored: '已从回收站恢复',
      corrected: '已更正投入时间',
      dependency_overridden: '已记录强制开始原因'
    }[action] ?? action.replaceAll('_', ' ')
  )
}
