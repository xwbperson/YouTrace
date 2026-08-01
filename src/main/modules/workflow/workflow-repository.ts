import type Database from 'better-sqlite3'
import type { Review, ReviewSnapshot } from '../../../shared/contracts'

interface ReviewRow {
  id: string
  review_type: Review['reviewType']
  start_date: string
  end_date: string
  title: string
  important_outcomes: string
  incomplete_items: string
  blockers: string
  next_first_step: string
  next_commitments: string
  status: Review['status']
  snapshot_json: string
  adjustment_count: number
  created_at: string
  updated_at: string
  completed_at: string | null
}

export interface TemplateDefinition {
  milestones: Array<{
    title: string
    description?: string
    estimatedMinutes?: number | null
    tasks: Array<{
      title: string
      estimatedMinutes: number | null
      difficulty?: number | null
      priority?: 'low' | 'medium' | 'high' | 'critical'
    }>
  }>
}

export interface CustomTemplateRow {
  id: string
  name: string
  description: string
  source_project_id: string | null
  definition_json: string
  created_at: string
  updated_at: string
  archived_at: string | null
}

export class WorkflowRepository {
  constructor(private readonly database: () => Database.Database) {}

  listReviews(): ReviewRow[] {
    return this.database()
      .prepare(
        `SELECT r.id, r.review_type, r.start_date, r.end_date, r.title,
                r.important_outcomes, r.incomplete_items, r.blockers,
                r.next_first_step, r.next_commitments, r.status,
                rs.snapshot_json,
                (SELECT COUNT(*) FROM plan_adjustments pa WHERE pa.review_id = r.id)
                  AS adjustment_count,
                r.created_at, r.updated_at, r.completed_at
           FROM reviews r
           JOIN review_snapshots rs ON rs.review_id = r.id
          WHERE r.deleted_at IS NULL
          ORDER BY r.start_date DESC, r.created_at DESC`
      )
      .all() as ReviewRow[]
  }

  getReview(id: string): ReviewRow | null {
    return this.listReviews().find((review) => review.id === id) ?? null
  }

  insertReview(
    id: string,
    input: { reviewType: string; startDate: string; endDate: string; title: string },
    snapshot: ReviewSnapshot,
    now: string
  ): void {
    const database = this.database()
    const transaction = database.transaction(() => {
      database
        .prepare(
          `INSERT INTO reviews(
             id, review_type, start_date, end_date, title, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(id, input.reviewType, input.startDate, input.endDate, input.title, now, now)
      database
        .prepare(
          `INSERT INTO review_snapshots(id, review_id, snapshot_json, captured_at)
           VALUES (?, ?, ?, ?)`
        )
        .run(crypto.randomUUID(), id, JSON.stringify(snapshot), now)
      this.insertAudit(database, 'review', id, 'created', input, now)
    })
    transaction()
  }

  updateReview(
    id: string,
    value: {
      importantOutcomes: string
      incompleteItems: string
      blockers: string
      nextFirstStep: string
      nextCommitments: string
      status: Review['status']
    },
    now: string
  ): void {
    const before = this.getReview(id)
    this.database()
      .prepare(
        `UPDATE reviews SET
           important_outcomes = ?, incomplete_items = ?, blockers = ?,
           next_first_step = ?, next_commitments = ?, status = ?,
           completed_at = CASE WHEN ? = 'completed' THEN COALESCE(completed_at, ?) ELSE NULL END,
           updated_at = ?
         WHERE id = ?`
      )
      .run(
        value.importantOutcomes,
        value.incompleteItems,
        value.blockers,
        value.nextFirstStep,
        value.nextCommitments,
        value.status,
        value.status,
        now,
        now,
        id
      )
    this.insertAudit(this.database(), 'review', id, 'updated', { before, value }, now)
  }

  trashReview(id: string, now: string): boolean {
    const database = this.database()
    return database.transaction(() => {
      const result = database
        .prepare('UPDATE reviews SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL')
        .run(now, now, id)
      if (result.changes === 0) return false
      database
        .prepare(
          `INSERT INTO trash_entries(id, entity_type, entity_id, deleted_at)
           VALUES (?, 'review', ?, ?)`
        )
        .run(crypto.randomUUID(), id, now)
      this.insertAudit(database, 'review', id, 'trashed', { deletedAt: now }, now)
      return true
    })()
  }

  captureSnapshot(startDate: string, endDate: string, generatedAt: string): ReviewSnapshot {
    const database = this.database()
    const plans = database
      .prepare(
        `SELECT p.id, p.title, p.focus_result
           FROM plan_periods p
          WHERE p.deleted_at IS NULL AND p.start_date <= ? AND p.end_date >= ?
          ORDER BY p.start_date`
      )
      .all(endDate, startDate) as Array<{ id: string; title: string; focus_result: string }>
    const planItems = database.prepare(
      `SELECT entity_type, entity_id, title_snapshot FROM plan_items
        WHERE plan_id = ? ORDER BY sort_order, created_at`
    )
    const taskRows = database
      .prepare(
        `SELECT t.id, t.title, t.status, t.project_id, t.due_at, t.estimated_minutes,
                COALESCE((
                  SELECT SUM(e.effective_minutes) FROM effort_entries e
                   WHERE e.entity_type = 'task' AND e.entity_id = t.id
                     AND e.voided_at IS NULL AND e.deleted_at IS NULL
                ), 0) AS actual_minutes
           FROM tasks t
          WHERE t.deleted_at IS NULL AND (
            SUBSTR(t.due_at, 1, 10) BETWEEN ? AND ?
            OR t.start_date BETWEEN ? AND ?
            OR t.id IN (
              SELECT pi.entity_id FROM plan_items pi
              JOIN plan_periods p ON p.id = pi.plan_id
              WHERE pi.entity_type = 'task' AND p.start_date <= ? AND p.end_date >= ?
            )
          )
          ORDER BY COALESCE(t.due_at, '9999')`
      )
      .all(startDate, endDate, startDate, endDate, endDate, startDate) as Array<{
      id: string
      title: string
      status: import('../../../shared/contracts').Task['status']
      project_id: string | null
      due_at: string | null
      estimated_minutes: number | null
      actual_minutes: number
    }>
    const efforts = database
      .prepare(
        `SELECT id, entity_id, effective_minutes, result
           FROM effort_entries
          WHERE SUBSTR(started_at, 1, 10) BETWEEN ? AND ?
            AND voided_at IS NULL AND deleted_at IS NULL
          ORDER BY started_at`
      )
      .all(startDate, endDate) as Array<{
      id: string
      entity_id: string | null
      effective_minutes: number
      result: string
    }>
    const evidence = database
      .prepare(
        `SELECT id, title, verification_status
           FROM evidence
          WHERE SUBSTR(created_at, 1, 10) BETWEEN ? AND ? AND deleted_at IS NULL
          ORDER BY created_at`
      )
      .all(startDate, endDate) as Array<{
      id: string
      title: string
      verification_status: string
    }>

    return {
      generatedAt,
      period: { startDate, endDate },
      plans: plans.map((plan) => ({
        id: plan.id,
        title: plan.title,
        focusResult: plan.focus_result,
        items: (planItems.all(plan.id) as Array<{
          entity_type: string
          entity_id: string
          title_snapshot: string
        }>).map((item) => ({
          entityType: item.entity_type,
          entityId: item.entity_id,
          titleSnapshot: item.title_snapshot
        }))
      })),
      tasks: taskRows.map((task) => ({
        id: task.id,
        title: task.title,
        status: task.status,
        projectId: task.project_id,
        dueAt: task.due_at,
        estimatedMinutes: task.estimated_minutes,
        actualMinutes: task.actual_minutes
      })),
      efforts: efforts.map((effort) => ({
        id: effort.id,
        entityId: effort.entity_id,
        effectiveMinutes: effort.effective_minutes,
        result: effort.result
      })),
      evidence: evidence.map((item) => ({
        id: item.id,
        title: item.title,
        verificationStatus: item.verification_status
      }))
    }
  }

  insertAdjustment(
    reviewId: string,
    taskId: string,
    action: string,
    reason: string,
    before: unknown,
    after: unknown,
    now: string
  ): void {
    this.database()
      .prepare(
        `INSERT INTO plan_adjustments(
           id, review_id, task_id, action, reason, before_json, after_json, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        crypto.randomUUID(),
        reviewId,
        taskId,
        action,
        reason,
        JSON.stringify(before),
        JSON.stringify(after),
        now
      )
  }

  listCustomTemplates(includeArchived = false): CustomTemplateRow[] {
    return this.database()
      .prepare(
        `SELECT id, name, description, source_project_id, definition_json, created_at, updated_at, archived_at
           FROM project_templates
          WHERE deleted_at IS NULL ${includeArchived ? '' : 'AND archived_at IS NULL'}
          ORDER BY created_at DESC`
      )
      .all() as CustomTemplateRow[]
  }

  getCustomTemplate(id: string, includeArchived = false): CustomTemplateRow | null {
    return this.listCustomTemplates(includeArchived).find((template) => template.id === id) ?? null
  }

  insertCustomTemplate(
    id: string,
    name: string,
    description: string,
    projectId: string,
    definition: TemplateDefinition,
    now: string
  ): void {
    this.database()
      .prepare(
        `INSERT INTO project_templates(
           id, name, description, source_project_id, definition_json, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, name, description, projectId, JSON.stringify(definition), now, now)
    this.insertAudit(this.database(), 'template', id, 'created', { name, projectId }, now)
  }

  updateCustomTemplate(
    id: string,
    name: string,
    description: string,
    projectId: string,
    definition: TemplateDefinition,
    now: string
  ): boolean {
    const before = this.getCustomTemplate(id, true)
    const result = this.database()
      .prepare(
        `UPDATE project_templates
            SET name = ?, description = ?, source_project_id = ?, definition_json = ?, updated_at = ?
          WHERE id = ? AND deleted_at IS NULL`
      )
      .run(name, description, projectId, JSON.stringify(definition), now, id)
    if (result.changes > 0) this.insertAudit(this.database(), 'template', id, 'updated', { before, name, projectId }, now)
    return result.changes > 0
  }

  archiveTemplate(id: string, archived: boolean, now: string): boolean {
    const result = this.database()
      .prepare('UPDATE project_templates SET archived_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL')
      .run(archived ? now : null, now, id)
    if (result.changes > 0) this.insertAudit(this.database(), 'template', id, archived ? 'archived' : 'restored_from_archive', null, now)
    return result.changes > 0
  }

  trashTemplate(id: string, now: string): boolean {
    const database = this.database()
    return database.transaction(() => {
      const result = database
        .prepare('UPDATE project_templates SET deleted_at = ?, updated_at = ? WHERE id = ? AND archived_at IS NOT NULL AND deleted_at IS NULL')
        .run(now, now, id)
      if (result.changes === 0) return false
      database
        .prepare("INSERT INTO trash_entries(id, entity_type, entity_id, deleted_at) VALUES (?, 'template', ?, ?)")
        .run(crypto.randomUUID(), id, now)
      this.insertAudit(database, 'template', id, 'trashed', null, now)
      return true
    })()
  }

  private insertAudit(
    database: Database.Database,
    entityType: string,
    entityId: string,
    action: string,
    after: unknown,
    now: string
  ): void {
    database
      .prepare(
        `INSERT INTO audit_events(
           id, entity_type, entity_id, action, after_json, occurred_at
         ) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(crypto.randomUUID(), entityType, entityId, action, JSON.stringify(after), now)
  }
}

export function mapReview(row: ReviewRow): Review {
  return {
    id: row.id,
    reviewType: row.review_type,
    startDate: row.start_date,
    endDate: row.end_date,
    title: row.title,
    importantOutcomes: row.important_outcomes,
    incompleteItems: row.incomplete_items,
    blockers: row.blockers,
    nextFirstStep: row.next_first_step,
    nextCommitments: row.next_commitments,
    status: row.status,
    snapshot: JSON.parse(row.snapshot_json) as ReviewSnapshot,
    adjustmentCount: row.adjustment_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at
  }
}
