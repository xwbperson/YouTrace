import type Database from 'better-sqlite3'
import type {
  NotificationSettings,
  UpcomingReminder
} from '../../../shared/contracts'

export interface ReminderCandidate {
  sourceType: string
  sourceId: string
  title: string
  triggerAt: string
  timezone: string
}

interface EventRow {
  id: string
  source_type: string
  source_id: string
  title: string
  scheduled_at: string
  status: UpcomingReminder['status']
}

export class ReminderRepository {
  constructor(private readonly database: () => Database.Database) {}

  getSettings(): NotificationSettings | null {
    const row = this.database()
      .prepare("SELECT value_json FROM workspace_settings WHERE key = 'notifications'")
      .get() as { value_json: string } | undefined
    if (!row) return null
    try {
      return JSON.parse(row.value_json) as NotificationSettings
    } catch {
      return null
    }
  }

  saveSettings(settings: NotificationSettings, now: string): void {
    this.database()
      .prepare(
        `INSERT INTO workspace_settings(key, value_json, updated_at)
         VALUES ('notifications', ?, ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`
      )
      .run(JSON.stringify(settings), now)
  }

  listTaskCandidates(): Array<{ id: string; title: string; due_at: string }> {
    return this.database()
      .prepare(
        `SELECT id, title, due_at FROM tasks
          WHERE due_at IS NOT NULL AND status NOT IN ('completed', 'cancelled')
            AND deleted_at IS NULL`
      )
      .all() as Array<{ id: string; title: string; due_at: string }>
  }

  listTimeBlockCandidates(): Array<{ id: string; title: string; starts_at: string; timezone: string }> {
    return this.database()
      .prepare(
        `SELECT id, title, starts_at, timezone FROM time_blocks
          WHERE deleted_at IS NULL`
      )
      .all() as Array<{ id: string; title: string; starts_at: string; timezone: string }>
  }

  listCountdownCandidates(): Array<{ id: string; title: string; target_at: string; timezone: string }> {
    return this.database()
      .prepare(
        `SELECT id, title, target_at, timezone FROM countdowns
          WHERE archived_at IS NULL AND deleted_at IS NULL`
      )
      .all() as Array<{ id: string; title: string; target_at: string; timezone: string }>
  }

  listReviewCandidates(): Array<{ id: string; title: string; scheduled_date: string }> {
    return this.database()
      .prepare(
        `SELECT rq.id,
                COALESCE(k.title, SUBSTR(m.question, 1, 80), '待复习内容') AS title,
                rq.scheduled_date
           FROM review_queue rq
           LEFT JOIN knowledge_items k ON rq.entity_type = 'knowledge' AND k.id = rq.entity_id
           LEFT JOIN mistakes m ON rq.entity_type = 'mistake' AND m.id = rq.entity_id
          WHERE rq.status = 'pending'`
      )
      .all() as Array<{ id: string; title: string; scheduled_date: string }>
  }

  listStaleProjects(cutoff: string): Array<{ id: string; name: string }> {
    return this.database()
      .prepare(
        `SELECT id, name FROM projects
          WHERE status = 'active' AND updated_at <= ?
            AND archived_at IS NULL AND deleted_at IS NULL`
      )
      .all(cutoff) as Array<{ id: string; name: string }>
  }

  listOverloadedPlans(): Array<{ id: string; title: string; start_date: string; capacity_minutes: number; planned_minutes: number }> {
    return this.database()
      .prepare(
        `SELECT p.id, p.title, p.start_date, p.capacity_minutes,
                COALESCE(SUM(CASE WHEN pi.entity_type = 'task' THEN t.estimated_minutes ELSE 0 END), 0)
                  AS planned_minutes
           FROM plan_periods p
           LEFT JOIN plan_items pi ON pi.plan_id = p.id AND pi.committed = 1
           LEFT JOIN tasks t ON pi.entity_type = 'task' AND t.id = pi.entity_id
          WHERE p.capacity_minutes IS NOT NULL AND p.deleted_at IS NULL AND p.archived_at IS NULL
          GROUP BY p.id
         HAVING planned_minutes > p.capacity_minutes`
      )
      .all() as Array<{
      id: string
      title: string
      start_date: string
      capacity_minutes: number
      planned_minutes: number
    }>
  }

  upsertCandidate(candidate: ReminderCandidate, now: string): void {
    const database = this.database()
    const ruleId = crypto.randomUUID()
    database
      .prepare(
        `INSERT INTO reminder_rules(
           id, source_type, source_id, trigger_at, timezone, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(source_type, source_id, trigger_at) DO UPDATE SET
           timezone = excluded.timezone, enabled = 1, updated_at = excluded.updated_at`
      )
      .run(
        ruleId,
        candidate.sourceType,
        candidate.sourceId,
        candidate.triggerAt,
        candidate.timezone,
        now,
        now
      )
    const rule = database
      .prepare(
        `SELECT id FROM reminder_rules
          WHERE source_type = ? AND source_id = ? AND trigger_at = ?`
      )
      .get(candidate.sourceType, candidate.sourceId, candidate.triggerAt) as { id: string }
    const dedupeKey = `${candidate.sourceType}:${candidate.sourceId}:${candidate.triggerAt}`
    database
      .prepare(
        `INSERT OR IGNORE INTO reminder_events(
           id, rule_id, scheduled_at, status, dedupe_key, error, created_at, updated_at
         ) VALUES (?, ?, ?, 'pending', ?, NULL, ?, ?)`
      )
      .run(
        crypto.randomUUID(),
        rule.id,
        candidate.triggerAt,
        dedupeKey,
        now,
        now
      )
    const event = database
      .prepare('SELECT id FROM reminder_events WHERE dedupe_key = ?')
      .get(dedupeKey) as { id: string }
    database
      .prepare(
        `INSERT INTO reminder_event_payloads(event_id, title) VALUES (?, ?)
         ON CONFLICT(event_id) DO UPDATE SET title = excluded.title`
      )
      .run(event.id, candidate.title)
  }

  listDue(now: string): EventRow[] {
    return this.database()
      .prepare(
        `SELECT e.id, r.source_type, r.source_id,
                COALESCE(p.title, r.source_type) AS title,
                e.scheduled_at, e.status
           FROM reminder_events e
           JOIN reminder_rules r ON r.id = e.rule_id
           LEFT JOIN reminder_event_payloads p ON p.event_id = e.id
          WHERE e.status = 'pending' AND r.enabled = 1 AND e.scheduled_at <= ?
          ORDER BY e.scheduled_at
          LIMIT 200`
      )
      .all(now) as EventRow[]
  }

  listUpcoming(): UpcomingReminder[] {
    const rows = this.database()
      .prepare(
        `SELECT e.id, r.source_type, r.source_id,
                COALESCE(p.title, r.source_type) AS title,
                e.scheduled_at, e.status
           FROM reminder_events e
           JOIN reminder_rules r ON r.id = e.rule_id
           LEFT JOIN reminder_event_payloads p ON p.event_id = e.id
          WHERE e.status = 'pending'
          ORDER BY e.scheduled_at
          LIMIT 100`
      )
      .all() as EventRow[]
    return rows.map(mapEvent)
  }

  markFired(ids: string[], now: string): void {
    if (ids.length === 0) return
    this.database()
      .prepare(
        `UPDATE reminder_events SET status = 'fired', fired_at = ?, updated_at = ?
          WHERE id IN (${ids.map(() => '?').join(', ')})`
      )
      .run(now, now, ...ids)
  }
}

function mapEvent(row: EventRow): UpcomingReminder {
  return {
    id: row.id,
    sourceType: row.source_type,
    sourceId: row.source_id,
    title: row.title,
    scheduledAt: row.scheduled_at,
    status: row.status
  }
}
