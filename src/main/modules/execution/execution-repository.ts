import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type {
  CorrectEffortInput,
  CreateEvidenceInput,
  CreateManualEffortInput,
  CreateMemoInput,
  EffortEntry,
  EffortRevision,
  EffortSummary,
  EffortListInput,
  Evidence,
  Memo,
  StartEffortInput,
  StopEffortInput
} from '../../../shared/contracts'

interface EffortRow {
  id: string
  entity_type: EffortEntry['entityType']
  entity_id: string | null
  entity_title_snapshot: string | null
  source: EffortEntry['source']
  started_at: string
  ended_at: string | null
  effective_minutes: number
  suspended_at: string | null
  paused_minutes: number
  energy: number | null
  perceived_difficulty: number | null
  result: string
  interruptions: string
  obstacles: string
  next_step: string
  tag_ids: string | null
  created_at: string
  updated_at: string
}

interface EvidenceRow {
  id: string
  kind: Evidence['kind']
  title: string
  note: string
  source: string | null
  verification_status: Evidence['verificationStatus']
  entity_type: string | null
  entity_id: string | null
  attachment_count: number
  tag_ids: string | null
  created_at: string
  updated_at: string
}

interface MemoRow {
  id: string
  kind: Memo['kind']
  title: string
  body: string
  inbox: number
  processed_at: string | null
  project_id: string | null
  converted_type: string | null
  converted_id: string | null
  evidence_count: number
  archived_at: string | null
  tag_ids: string | null
  created_at: string
  updated_at: string
}

export class ExecutionRepository {
  constructor(private readonly database: () => Database.Database) {}

  getActiveEffort(): EffortEntry | null {
    const rows = this.queryEfforts('e.ended_at IS NULL AND e.voided_at IS NULL AND e.deleted_at IS NULL', [])
    return rows[0] ? mapEffort(rows[0]) : null
  }

  getEffort(id: string): EffortEntry | null {
    const rows = this.queryEfforts('e.id = ? AND e.deleted_at IS NULL', [id])
    return rows[0] ? mapEffort(rows[0]) : null
  }

  insertStartedEffort(
    id: string,
    input: StartEffortInput,
    entityTitle: string,
    projectIdSnapshot: string | null,
    now: string
  ): void {
    const database = this.database()
    const transaction = database.transaction(() => {
      database
        .prepare(
          `INSERT INTO effort_entries(
             id, entity_type, entity_id, source, started_at, ended_at, effective_minutes,
             result, interruptions, obstacles, next_step, entity_title_snapshot,
             project_id_snapshot, created_at, updated_at
           ) VALUES (?, ?, ?, 'timer', ?, NULL, 0, '', '', '', '', ?, ?, ?, ?)`
        )
        .run(id, input.entityType, input.entityId, now, entityTitle, projectIdSnapshot, now, now)
      this.replaceTags(database, 'effort', id, input.tagIds, now)
      this.insertAudit(database, 'effort', id, 'started', null, input, now)
    })
    transaction()
  }

  stopEffort(
    id: string,
    input: StopEffortInput,
    endedAt: string,
    effectiveMinutes: number
  ): boolean {
    const database = this.database()
    const transaction = database.transaction(() => {
      const result = database
        .prepare(
          `UPDATE effort_entries
              SET ended_at = ?, effective_minutes = ?, result = ?, interruptions = ?,
                  obstacles = ?, next_step = ?, energy = ?, perceived_difficulty = ?,
                  updated_at = ?
            WHERE id = ? AND ended_at IS NULL AND voided_at IS NULL AND deleted_at IS NULL`
        )
        .run(
          endedAt,
          effectiveMinutes,
          input.result,
          input.interruptions,
          input.obstacles,
          input.nextStep,
          input.energy,
          input.perceivedDifficulty,
          endedAt,
          id
        )
      if (result.changes === 0) return false
      this.insertAudit(database, 'effort', id, 'stopped', null, input, endedAt)
      return true
    })
    return transaction()
  }

  suspendEffort(id: string, now: string): boolean {
    const database = this.database()
    const active = database
      .prepare(
        `SELECT id FROM effort_entries
          WHERE id = ? AND ended_at IS NULL AND voided_at IS NULL AND deleted_at IS NULL`
      )
      .get(id)
    if (!active) return false
    const result = database
      .prepare(
        `INSERT OR IGNORE INTO effort_suspensions(
           id, effort_id, suspended_at, resumed_at, created_at
         ) VALUES (?, ?, ?, NULL, ?)`
      )
      .run(randomUUID(), id, now, now)
    if (result.changes > 0) {
      this.insertAudit(database, 'effort', id, 'suspended', null, { suspendedAt: now }, now)
    }
    return result.changes > 0
  }

  resumeEffort(id: string, now: string): boolean {
    const database = this.database()
    const result = database
      .prepare(
        `UPDATE effort_suspensions SET resumed_at = ?
          WHERE effort_id = ? AND resumed_at IS NULL`
      )
      .run(now, id)
    if (result.changes > 0) {
      this.insertAudit(database, 'effort', id, 'resumed', null, { resumedAt: now }, now)
    }
    return result.changes > 0
  }

  closeOpenSuspensionAt(id: string, at: string): boolean {
    const database = this.database()
    const result = database
      .prepare(
        `UPDATE effort_suspensions
            SET suspended_at = ?, resumed_at = ?
          WHERE effort_id = ? AND resumed_at IS NULL`
      )
      .run(at, at, id)
    if (result.changes > 0) {
      this.insertAudit(
        database,
        'effort',
        id,
        'interruption_end_confirmed',
        null,
        { endedAt: at },
        at
      )
    }
    return result.changes > 0
  }

  pausedMilliseconds(id: string, through: string): number {
    const rows = this.database()
      .prepare(
        `SELECT suspended_at, resumed_at
           FROM effort_suspensions
          WHERE effort_id = ?`
      )
      .all(id) as Array<{ suspended_at: string; resumed_at: string | null }>
    return rows.reduce(
      (total, row) =>
        total +
        Math.max(0, Date.parse(row.resumed_at ?? through) - Date.parse(row.suspended_at)),
      0
    )
  }

  insertManualEffort(
    id: string,
    input: CreateManualEffortInput,
    entityTitle: string,
    projectIdSnapshot: string | null,
    now: string
  ): void {
    const database = this.database()
    const transaction = database.transaction(() => {
      database
        .prepare(
          `INSERT INTO effort_entries(
             id, entity_type, entity_id, source, started_at, ended_at, effective_minutes,
             energy, perceived_difficulty, result, interruptions, obstacles, next_step,
             entity_title_snapshot, project_id_snapshot, created_at, updated_at
           ) VALUES (?, ?, ?, 'manual', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          input.entityType,
          input.entityId,
          input.startedAt,
          input.endedAt,
          input.effectiveMinutes,
          input.energy,
          input.perceivedDifficulty,
          input.result,
          input.interruptions,
          input.obstacles,
          input.nextStep,
          entityTitle,
          projectIdSnapshot,
          now,
          now
        )
      this.replaceTags(database, 'effort', id, input.tagIds, now)
      this.insertAudit(database, 'effort', id, 'manual_created', null, input, now)
    })
    transaction()
  }

  listEfforts(input: EffortListInput): EffortEntry[] {
    const conditions = ['e.voided_at IS NULL', 'e.deleted_at IS NULL']
    const parameters: unknown[] = []
    if (input.entityType) {
      conditions.push('e.entity_type = ?')
      parameters.push(input.entityType)
    }
    if (input.entityId) {
      conditions.push('e.entity_id = ?')
      parameters.push(input.entityId)
    }
    if (input.from) {
      conditions.push('e.started_at >= ?')
      parameters.push(input.from)
    }
    if (input.to) {
      conditions.push('e.started_at < ?')
      parameters.push(input.to)
    }
    parameters.push(input.limit, input.offset)
    return this.queryEfforts(conditions.join(' AND '), parameters, 'LIMIT ? OFFSET ?').map(mapEffort)
  }

  summarizeEfforts(from: string | null, to: string | null): EffortSummary {
    const conditions = ['voided_at IS NULL', 'deleted_at IS NULL', 'ended_at IS NOT NULL']
    const parameters: unknown[] = []
    if (from) {
      conditions.push('started_at >= ?')
      parameters.push(from)
    }
    if (to) {
      conditions.push('started_at < ?')
      parameters.push(to)
    }
    const row = this.database()
      .prepare(
        `SELECT COUNT(*) AS entry_count,
                COALESCE(SUM(effective_minutes), 0) AS total_minutes,
                MIN(started_at) AS first_started_at,
                MAX(started_at) AS last_started_at
           FROM effort_entries
          WHERE ${conditions.join(' AND ')}`
      )
      .get(...parameters) as {
      entry_count: number
      total_minutes: number
      first_started_at: string | null
      last_started_at: string | null
    }
    return {
      entryCount: row.entry_count,
      totalMinutes: row.total_minutes,
      firstStartedAt: row.first_started_at,
      lastStartedAt: row.last_started_at
    }
  }

  correctEffort(
    current: EffortEntry,
    input: CorrectEffortInput,
    now: string
  ): boolean {
    const database = this.database()
    const before = {
      startedAt: current.startedAt,
      endedAt: current.endedAt,
      effectiveMinutes: current.effectiveMinutes
    }
    const after = {
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      effectiveMinutes: input.effectiveMinutes
    }
    const transaction = database.transaction(() => {
      const result = database
        .prepare(
          `UPDATE effort_entries
              SET started_at = ?, ended_at = ?, effective_minutes = ?, updated_at = ?
            WHERE id = ? AND ended_at IS NOT NULL AND voided_at IS NULL AND deleted_at IS NULL`
        )
        .run(input.startedAt, input.endedAt, input.effectiveMinutes, now, input.id)
      if (result.changes === 0) return false
      database
        .prepare(
          `INSERT INTO audit_events(
             id, entity_type, entity_id, action, before_json, after_json, reason, occurred_at
           ) VALUES (?, 'effort', ?, 'corrected', ?, ?, ?, ?)`
        )
        .run(
          crypto.randomUUID(),
          input.id,
          JSON.stringify(before),
          JSON.stringify(after),
          input.reason,
          now
        )
      return true
    })
    return transaction()
  }

  listEffortHistory(id: string): EffortRevision[] {
    const rows = this.database()
      .prepare(
        `SELECT id, entity_id, before_json, after_json, reason, occurred_at
           FROM audit_events
          WHERE entity_type = 'effort' AND entity_id = ? AND action = 'corrected'
          ORDER BY occurred_at DESC`
      )
      .all(id) as Array<{
      id: string
      entity_id: string
      before_json: string
      after_json: string
      reason: string
      occurred_at: string
    }>
    return rows.map((row) => ({
      id: row.id,
      effortId: row.entity_id,
      before: JSON.parse(row.before_json) as EffortRevision['before'],
      after: JSON.parse(row.after_json) as EffortRevision['after'],
      reason: row.reason,
      occurredAt: row.occurred_at
    }))
  }

  insertEvidence(id: string, input: CreateEvidenceInput, now: string): void {
    const database = this.database()
    const transaction = database.transaction(() => {
      database
        .prepare(
          `INSERT INTO evidence(
             id, kind, title, note, source, verification_status, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          input.kind,
          input.title,
          input.note,
          input.source,
          input.verificationStatus,
          now,
          now
        )
      if (input.entityType && input.entityId) {
        database
          .prepare(
            `INSERT INTO entity_evidence(evidence_id, entity_type, entity_id, created_at)
             VALUES (?, ?, ?, ?)`
          )
          .run(id, input.entityType, input.entityId, now)
      }
      this.replaceTags(database, 'evidence', id, input.tagIds, now)
      this.upsertSearch(database, 'evidence', id, input.title, input.note)
      this.insertAudit(database, 'evidence', id, 'created', null, input, now)
    })
    transaction()
  }

  getEvidence(id: string): Evidence | null {
    const rows = this.queryEvidence('e.id = ? AND e.deleted_at IS NULL', [id])
    return rows[0] ? mapEvidence(rows[0]) : null
  }

  listEvidence(entityType: string | null, entityId: string | null): Evidence[] {
    const conditions = ['e.deleted_at IS NULL']
    const parameters: unknown[] = []
    if (entityType) {
      conditions.push('ee.entity_type = ?')
      parameters.push(entityType)
    }
    if (entityId) {
      conditions.push('ee.entity_id = ?')
      parameters.push(entityId)
    }
    return this.queryEvidence(conditions.join(' AND '), parameters).map(mapEvidence)
  }

  updateEvidenceStatus(
    id: string,
    status: Evidence['verificationStatus'],
    reason: string,
    now: string
  ): boolean {
    const database = this.database()
    const before = this.getEvidence(id)
    const result = database
      .prepare(
        'UPDATE evidence SET verification_status = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL'
      )
      .run(status, now, id)
    if (result.changes > 0) {
      this.insertAudit(database, 'evidence', id, 'status_changed', before, { status, reason }, now)
    }
    return result.changes > 0
  }

  updateEvidence(
    id: string,
    input: {
      title: string
      note: string
      source: string | null
      verificationStatus: Evidence['verificationStatus']
      entityType: string | null
      entityId: string | null
      tagIds: string[]
    },
    now: string
  ): boolean {
    const database = this.database()
    const before = this.getEvidence(id)
    if (!before) return false
    return database.transaction(() => {
      const result = database
        .prepare(
          `UPDATE evidence
              SET title = ?, note = ?, source = ?, verification_status = ?, updated_at = ?
            WHERE id = ? AND deleted_at IS NULL`
        )
        .run(
          input.title,
          input.note,
          input.source,
          input.verificationStatus,
          now,
          id
        )
      if (result.changes === 0) return false
      database.prepare('DELETE FROM entity_evidence WHERE evidence_id = ?').run(id)
      if (input.entityType && input.entityId) {
        database
          .prepare(
            `INSERT INTO entity_evidence(evidence_id, entity_type, entity_id, created_at)
             VALUES (?, ?, ?, ?)`
          )
          .run(id, input.entityType, input.entityId, now)
      }
      this.replaceTags(database, 'evidence', id, input.tagIds, now)
      this.upsertSearch(database, 'evidence', id, input.title, input.note)
      this.insertAudit(database, 'evidence', id, 'updated', before, input, now)
      return true
    })()
  }

  trashEvidence(id: string, now: string): boolean {
    const database = this.database()
    return database.transaction(() => {
      const before = this.getEvidence(id)
      if (!before) return false
      const result = database
        .prepare(
          'UPDATE evidence SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL'
        )
        .run(now, now, id)
      if (result.changes === 0) return false
      database
        .prepare(
          `INSERT INTO trash_entries(id, entity_type, entity_id, deleted_at)
           VALUES (?, 'evidence', ?, ?)`
        )
        .run(crypto.randomUUID(), id, now)
      database
        .prepare("DELETE FROM searchable_content WHERE entity_type = 'evidence' AND entity_id = ?")
        .run(id)
      this.insertAudit(database, 'evidence', id, 'trashed', before, null, now)
      return true
    })()
  }

  insertMemo(id: string, input: CreateMemoInput, now: string): void {
    const database = this.database()
    const transaction = database.transaction(() => {
      database
        .prepare(
          `INSERT INTO memos(id, kind, title, body, inbox, created_at, updated_at)
           VALUES (?, ?, ?, ?, 1, ?, ?)`
        )
        .run(id, input.kind, input.title, input.body, now, now)
      this.replaceTags(database, 'memo', id, input.tagIds, now)
      if (input.projectId) {
        database
          .prepare(
            `INSERT INTO entity_relations(
               source_type, source_id, target_type, target_id, relation_type, created_at
             ) VALUES ('memo', ?, 'project', ?, 'RELATED_TO', ?)`
          )
          .run(id, input.projectId, now)
      }
      this.upsertSearch(database, 'memo', id, input.title || input.body.slice(0, 80), input.body)
      this.insertAudit(database, 'memo', id, 'created', null, input, now)
    })
    transaction()
  }

  updateMemo(
    id: string,
    input: {
      kind: Memo['kind']
      title: string
      body: string
      projectId: string | null
      tagIds: string[]
    },
    now: string
  ): void {
    const database = this.database()
    const transaction = database.transaction(() => {
      const before = this.getMemo(id)
      database
        .prepare(
          `UPDATE memos SET kind = ?, title = ?, body = ?, updated_at = ?
            WHERE id = ? AND deleted_at IS NULL`
        )
        .run(input.kind, input.title, input.body, now, id)
      database
        .prepare(
          `DELETE FROM entity_relations
            WHERE source_type = 'memo' AND source_id = ?
              AND target_type = 'project' AND relation_type = 'RELATED_TO'`
        )
        .run(id)
      if (input.projectId) {
        database
          .prepare(
            `INSERT INTO entity_relations(
               source_type, source_id, target_type, target_id, relation_type, created_at
             ) VALUES ('memo', ?, 'project', ?, 'RELATED_TO', ?)`
          )
          .run(id, input.projectId, now)
      }
      this.replaceTags(database, 'memo', id, input.tagIds, now)
      this.upsertSearch(database, 'memo', id, input.title || input.body.slice(0, 80), input.body)
      this.insertAudit(database, 'memo', id, 'updated', before, input, now)
    })
    transaction()
  }

  getMemo(id: string): Memo | null {
    const rows = this.queryMemos('m.id = ? AND m.deleted_at IS NULL', [id])
    return rows[0] ? mapMemo(rows[0]) : null
  }

  listMemos(inboxOnly: boolean, includeArchived: boolean): Memo[] {
    const condition = inboxOnly
      ? 'm.deleted_at IS NULL AND m.archived_at IS NULL AND m.inbox = 1'
      : `m.deleted_at IS NULL ${includeArchived ? '' : 'AND m.archived_at IS NULL'}`
    return this.queryMemos(condition, []).map(mapMemo)
  }

  markMemoConverted(
    memoId: string,
    targetType: 'task' | 'knowledge' | 'mistake',
    targetId: string,
    now: string
  ): void {
    const database = this.database()
    const transaction = database.transaction(() => {
      database
        .prepare('UPDATE memos SET inbox = 0, processed_at = ?, updated_at = ? WHERE id = ?')
        .run(now, now, memoId)
      database
        .prepare(
          `INSERT INTO entity_relations(
             source_type, source_id, target_type, target_id, relation_type, created_at
           ) VALUES ('memo', ?, ?, ?, 'CONVERTED_TO', ?)`
        )
        .run(memoId, targetType, targetId, now)
      this.insertAudit(
        database,
        'memo',
        memoId,
        `converted_to_${targetType}`,
        null,
        { targetId },
        now
      )
    })
    transaction()
  }

  archiveMemo(id: string, archived: boolean, now: string): boolean {
    const before = this.getMemo(id)
    const result = this.database()
      .prepare(
        'UPDATE memos SET archived_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL'
      )
      .run(archived ? now : null, now, id)
    if (result.changes > 0) {
      this.insertAudit(
        this.database(),
        'memo',
        id,
        archived ? 'archived' : 'restored_from_archive',
        before,
        null,
        now
      )
    }
    return result.changes > 0
  }

  deleteArchivedMemo(id: string, now: string): boolean {
    const database = this.database()
    return database.transaction(() => {
      const memo = database
        .prepare('SELECT id FROM memos WHERE id = ? AND archived_at IS NOT NULL')
        .get(id)
      if (!memo) return false
      database
        .prepare("DELETE FROM tag_assignments WHERE entity_type = 'memo' AND entity_id = ?")
        .run(id)
      database
        .prepare("DELETE FROM entity_evidence WHERE entity_type = 'memo' AND entity_id = ?")
        .run(id)
      database
        .prepare(
          `DELETE FROM entity_relations
            WHERE (source_type = 'memo' AND source_id = ?)
               OR (target_type = 'memo' AND target_id = ?)`
        )
        .run(id, id)
      database
        .prepare("DELETE FROM searchable_content WHERE entity_type = 'memo' AND entity_id = ?")
        .run(id)
      database.prepare('DELETE FROM memos WHERE id = ?').run(id)
      this.insertAudit(database, 'memo', id, 'purged', null, { permanent: true }, now)
      return true
    })()
  }

  private queryEfforts(condition: string, parameters: unknown[], suffix = ''): EffortRow[] {
    return this.database()
      .prepare(
        `SELECT e.id, e.entity_type, e.entity_id, e.entity_title_snapshot, e.source,
                e.started_at, e.ended_at, e.effective_minutes, e.energy,
                e.perceived_difficulty, e.result, e.interruptions, e.obstacles,
                e.next_step, e.created_at, e.updated_at,
                (
                  SELECT suspended_at FROM effort_suspensions
                   WHERE effort_id = e.id AND resumed_at IS NULL
                   LIMIT 1
                ) AS suspended_at,
                COALESCE((
                  SELECT SUM(
                    (julianday(COALESCE(resumed_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))) -
                     julianday(suspended_at)) * 1440
                  )
                    FROM effort_suspensions WHERE effort_id = e.id
                ), 0) AS paused_minutes,
                GROUP_CONCAT(DISTINCT ta.tag_id) AS tag_ids
           FROM effort_entries e
           LEFT JOIN tag_assignments ta
             ON ta.entity_type = 'effort' AND ta.entity_id = e.id
          WHERE ${condition}
          GROUP BY e.id
          ORDER BY e.started_at DESC
          ${suffix}`
      )
      .all(...parameters) as EffortRow[]
  }

  private queryEvidence(condition: string, parameters: unknown[]): EvidenceRow[] {
    return this.database()
      .prepare(
        `SELECT e.id, e.kind, e.title, e.note, e.source, e.verification_status,
                ee.entity_type, ee.entity_id, e.created_at, e.updated_at,
                (
                  SELECT COUNT(*) FROM entity_attachments ea
                   WHERE ea.entity_type = 'evidence' AND ea.entity_id = e.id
                ) AS attachment_count,
                GROUP_CONCAT(DISTINCT ta.tag_id) AS tag_ids
           FROM evidence e
           LEFT JOIN entity_evidence ee ON ee.evidence_id = e.id
           LEFT JOIN tag_assignments ta
             ON ta.entity_type = 'evidence' AND ta.entity_id = e.id
          WHERE ${condition}
          GROUP BY e.id
          ORDER BY e.created_at DESC`
      )
      .all(...parameters) as EvidenceRow[]
  }

  private queryMemos(condition: string, parameters: unknown[]): MemoRow[] {
    return this.database()
      .prepare(
        `SELECT m.id, m.kind, m.title, m.body, m.inbox, m.processed_at, m.archived_at,
                m.created_at, m.updated_at,
                (
                  SELECT target_id FROM entity_relations
                   WHERE source_type = 'memo' AND source_id = m.id
                     AND target_type = 'project' AND relation_type = 'RELATED_TO'
                   LIMIT 1
                ) AS project_id,
                (
                  SELECT target_type FROM entity_relations
                   WHERE source_type = 'memo' AND source_id = m.id
                     AND relation_type = 'CONVERTED_TO'
                   ORDER BY created_at DESC LIMIT 1
                ) AS converted_type,
                (
                  SELECT target_id FROM entity_relations
                   WHERE source_type = 'memo' AND source_id = m.id
                     AND relation_type = 'CONVERTED_TO'
                   ORDER BY created_at DESC LIMIT 1
                ) AS converted_id,
                (
                  SELECT COUNT(*) FROM entity_evidence
                   WHERE entity_type = 'memo' AND entity_id = m.id
                ) AS evidence_count,
                GROUP_CONCAT(DISTINCT ta.tag_id) AS tag_ids
           FROM memos m
           LEFT JOIN tag_assignments ta
             ON ta.entity_type = 'memo' AND ta.entity_id = m.id
          WHERE ${condition}
          GROUP BY m.id
          ORDER BY m.created_at DESC`
      )
      .all(...parameters) as MemoRow[]
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
    const statement = database.prepare(
      `INSERT INTO tag_assignments(tag_id, entity_type, entity_id, created_at)
       VALUES (?, ?, ?, ?)`
    )
    for (const tagId of [...new Set(tagIds)]) {
      statement.run(tagId, entityType, entityId, now)
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

function mapEffort(row: EffortRow): EffortEntry {
  return {
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    entityTitle: row.entity_title_snapshot,
    source: row.source,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    effectiveMinutes: row.effective_minutes,
    suspendedAt: row.suspended_at,
    pausedMinutes: Math.max(0, Math.round(row.paused_minutes)),
    energy: row.energy,
    perceivedDifficulty: row.perceived_difficulty,
    result: row.result,
    interruptions: row.interruptions,
    obstacles: row.obstacles,
    nextStep: row.next_step,
    tagIds: row.tag_ids ? row.tag_ids.split(',') : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function mapEvidence(row: EvidenceRow): Evidence {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    note: row.note,
    source: row.source,
    verificationStatus: row.verification_status,
    entityType: row.entity_type,
    entityId: row.entity_id,
    attachmentCount: row.attachment_count,
    tagIds: row.tag_ids ? row.tag_ids.split(',') : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function mapMemo(row: MemoRow): Memo {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    inbox: row.inbox === 1,
    processedAt: row.processed_at,
    projectId: row.project_id,
    convertedTo:
      row.converted_type && row.converted_id
        ? { entityType: row.converted_type, entityId: row.converted_id }
        : null,
    evidenceCount: row.evidence_count,
    archived: row.archived_at !== null,
    tagIds: row.tag_ids ? row.tag_ids.split(',') : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}
