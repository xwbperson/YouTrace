import type Database from 'better-sqlite3'
import type {
  Countdown,
  CreateCountdownInput,
  CreatePlanInput,
  CreateTimeBlockInput,
  PlanItem,
  TimeBlock
} from '../../../shared/contracts'

interface PlanRow {
  id: string
  period_type: PlanPeriodRow['periodType']
  start_date: string
  end_date: string
  title: string
  focus_result: string
  capacity_minutes: number | null
  planned_minutes: number
  created_at: string
  updated_at: string
}

interface PlanPeriodRow {
  periodType: 'year' | 'quarter' | 'month' | 'week' | 'day'
}

interface PlanItemRow {
  id: string
  entity_type: PlanItem['entityType']
  entity_id: string
  title_snapshot: string
  committed: number
  sort_order: number
}

interface TimeBlockRow {
  id: string
  task_id: string | null
  task_title: string | null
  title: string
  note: string
  starts_at: string
  ends_at: string
  timezone: string
  created_at: string
  updated_at: string
}

export interface CountdownRow {
  id: string
  title: string
  target_at: string
  timezone: string
  workday_rule_json: string
  buffer_days: number
  importance: Countdown['importance']
  entity_type: string | null
  entity_id: string | null
  remaining_minutes: number | null
  recent_window_days: number
  tag_ids: string | null
  created_at: string
  updated_at: string
}

export class TemporalRepository {
  constructor(private readonly database: () => Database.Database) {}

  listPlans(startDate: string, endDate: string): PlanRow[] {
    return this.database()
      .prepare(
        `SELECT p.id, p.period_type, p.start_date, p.end_date, p.title, p.focus_result,
                p.capacity_minutes,
                COALESCE(SUM(CASE WHEN pi.entity_type = 'task' THEN t.estimated_minutes ELSE 0 END), 0)
                  AS planned_minutes,
                p.created_at, p.updated_at
           FROM plan_periods p
           LEFT JOIN plan_items pi ON pi.plan_id = p.id AND pi.committed = 1
           LEFT JOIN tasks t ON pi.entity_type = 'task' AND t.id = pi.entity_id
          WHERE p.deleted_at IS NULL AND p.archived_at IS NULL
            AND p.start_date <= ? AND p.end_date >= ?
          GROUP BY p.id
          ORDER BY p.start_date, p.period_type`
      )
      .all(endDate, startDate) as PlanRow[]
  }

  getPlan(id: string): PlanRow | null {
    return this.listPlans('0000-01-01', '9999-12-31').find((row) => row.id === id) ?? null
  }

  listPlanItems(planId: string): PlanItemRow[] {
    return this.database()
      .prepare(
        `SELECT id, entity_type, entity_id, title_snapshot, committed, sort_order
           FROM plan_items WHERE plan_id = ? ORDER BY sort_order, created_at`
      )
      .all(planId) as PlanItemRow[]
  }

  insertPlan(id: string, input: CreatePlanInput, now: string): void {
    const database = this.database()
    const transaction = database.transaction(() => {
      database
        .prepare(
          `INSERT INTO plan_periods(
             id, period_type, start_date, end_date, title, focus_result,
             capacity_minutes, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          input.periodType,
          input.startDate,
          input.endDate,
          input.title,
          input.focusResult,
          input.capacityMinutes,
          now,
          now
        )
      const insertItem = database.prepare(
        `INSERT INTO plan_items(
           id, plan_id, entity_type, entity_id, title_snapshot, committed, sort_order, created_at
         ) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
      )
      input.items.forEach((item, index) => {
        insertItem.run(crypto.randomUUID(), id, item.entityType, item.entityId, item.titleSnapshot, index, now)
      })
      this.insertAudit(database, 'plan', id, 'created', input, now)
    })
    transaction()
  }

  listTimeBlocks(start: string, end: string): TimeBlockRow[] {
    return this.database()
      .prepare(
        `SELECT b.id, b.task_id, t.title AS task_title, b.title, b.note,
                b.starts_at, b.ends_at, b.timezone, b.created_at, b.updated_at
           FROM time_blocks b
           LEFT JOIN tasks t ON t.id = b.task_id
          WHERE b.deleted_at IS NULL AND b.starts_at < ? AND b.ends_at > ?
          ORDER BY b.starts_at`
      )
      .all(end, start) as TimeBlockRow[]
  }

  getTimeBlock(id: string): TimeBlockRow | null {
    return (
      (this.database()
        .prepare(
          `SELECT b.id, b.task_id, t.title AS task_title, b.title, b.note,
                  b.starts_at, b.ends_at, b.timezone, b.created_at, b.updated_at
             FROM time_blocks b LEFT JOIN tasks t ON t.id = b.task_id
            WHERE b.id = ? AND b.deleted_at IS NULL`
        )
        .get(id) as TimeBlockRow | undefined) ?? null
    )
  }

  insertTimeBlock(id: string, input: CreateTimeBlockInput, now: string): void {
    const database = this.database()
    database
      .prepare(
        `INSERT INTO time_blocks(
           id, task_id, title, note, starts_at, ends_at, timezone, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, input.taskId, input.title, input.note, input.startsAt, input.endsAt, input.timezone, now, now)
    this.insertAudit(database, 'time_block', id, 'created', input, now)
  }

  moveTimeBlock(id: string, startsAt: string, endsAt: string, now: string): boolean {
    const before = this.getTimeBlock(id)
    const result = this.database()
      .prepare(
        `UPDATE time_blocks SET starts_at = ?, ends_at = ?, updated_at = ?
          WHERE id = ? AND deleted_at IS NULL`
      )
      .run(startsAt, endsAt, now, id)
    if (result.changes > 0) {
      this.insertAudit(this.database(), 'time_block', id, 'moved', { before, startsAt, endsAt }, now)
    }
    return result.changes > 0
  }

  trashTimeBlock(id: string, now: string): boolean {
    const result = this.database()
      .prepare('UPDATE time_blocks SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL')
      .run(now, now, id)
    if (result.changes > 0) this.insertAudit(this.database(), 'time_block', id, 'trashed', null, now)
    return result.changes > 0
  }

  listCountdowns(): CountdownRow[] {
    return this.database()
      .prepare(
        `SELECT c.id, c.title, c.target_at, c.timezone, c.workday_rule_json,
                c.buffer_days, c.importance, c.entity_type, c.entity_id,
                cw.remaining_minutes, COALESCE(cw.recent_window_days, 28) AS recent_window_days,
                GROUP_CONCAT(DISTINCT ta.tag_id) AS tag_ids,
                c.created_at, c.updated_at
           FROM countdowns c
           LEFT JOIN countdown_workload cw ON cw.countdown_id = c.id
           LEFT JOIN tag_assignments ta
             ON ta.entity_type = 'countdown' AND ta.entity_id = c.id
          WHERE c.deleted_at IS NULL AND c.archived_at IS NULL
          GROUP BY c.id
          ORDER BY c.target_at`
      )
      .all() as CountdownRow[]
  }

  getCountdown(id: string): CountdownRow | null {
    return this.listCountdowns().find((row) => row.id === id) ?? null
  }

  insertCountdown(id: string, input: CreateCountdownInput, now: string): void {
    const database = this.database()
    const transaction = database.transaction(() => {
      database
        .prepare(
          `INSERT INTO countdowns(
             id, title, target_at, timezone, workday_rule_json, buffer_days,
             importance, entity_type, entity_id, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          input.title,
          input.targetAt,
          input.timezone,
          JSON.stringify({ workingDays: input.workingDays }),
          input.bufferDays,
          input.importance,
          input.entityType,
          input.entityId,
          now,
          now
        )
      database
        .prepare(
          `INSERT INTO countdown_workload(
             countdown_id, remaining_minutes, recent_window_days, created_at, updated_at
           ) VALUES (?, ?, 28, ?, ?)`
        )
        .run(id, input.remainingMinutes, now, now)
      const insertTag = database.prepare(
        `INSERT INTO tag_assignments(tag_id, entity_type, entity_id, created_at)
         VALUES (?, 'countdown', ?, ?)`
      )
      for (const tagId of [...new Set(input.tagIds)]) insertTag.run(tagId, id, now)
      this.insertAudit(database, 'countdown', id, 'created', input, now)
    })
    transaction()
  }

  getRecentDailyMinutes(entityType: string | null, entityId: string | null, since: string): number | null {
    if (!entityType || !entityId) return null
    const result = this.database()
      .prepare(
        `SELECT SUM(effective_minutes) AS total,
                COUNT(DISTINCT SUBSTR(started_at, 1, 10)) AS active_days
           FROM effort_entries
          WHERE entity_type = ? AND entity_id = ?
            AND started_at >= ? AND ended_at IS NOT NULL
            AND voided_at IS NULL AND deleted_at IS NULL`
      )
      .get(entityType, entityId, since) as { total: number | null; active_days: number }
    return result.total && result.active_days > 0 ? result.total / result.active_days : null
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
      .run(crypto.randomUUID(), entityType, entityId, action, after === null ? null : JSON.stringify(after), now)
  }
}

export function mapPlan(row: PlanRow, items: PlanItemRow[]): import('../../../shared/contracts').PlanPeriod {
  return {
    id: row.id,
    periodType: row.period_type,
    startDate: row.start_date,
    endDate: row.end_date,
    title: row.title,
    focusResult: row.focus_result,
    capacityMinutes: row.capacity_minutes,
    plannedMinutes: row.planned_minutes,
    overloaded: row.capacity_minutes !== null && row.planned_minutes > row.capacity_minutes,
    items: items.map((item) => ({
      id: item.id,
      entityType: item.entity_type,
      entityId: item.entity_id,
      titleSnapshot: item.title_snapshot,
      committed: item.committed === 1,
      sortOrder: item.sort_order
    })),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export function mapTimeBlock(row: TimeBlockRow, conflicts: string[]): TimeBlock {
  return {
    id: row.id,
    taskId: row.task_id,
    taskTitle: row.task_title,
    title: row.title,
    note: row.note,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    timezone: row.timezone,
    durationMinutes: Math.round((Date.parse(row.ends_at) - Date.parse(row.starts_at)) / 60_000),
    conflicts,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}
