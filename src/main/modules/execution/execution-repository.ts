import type Database from 'better-sqlite3'
import type {
  CorrectEffortInput,
  CreateEvidenceInput,
  CreateManualEffortInput,
  CreateMemoInput,
  EffortEntry,
  EffortRevision,
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
      this.upsertSearch(database, 'memo', id, input.title || input.body.slice(0, 80), input.body)
      this.insertAudit(database, 'memo', id, 'created', null, input, now)
    })
    transaction()
  }

  getMemo(id: string): Memo | null {
    const rows = this.queryMemos('m.id = ? AND m.deleted_at IS NULL', [id])
    return rows[0] ? mapMemo(rows[0]) : null
  }

  listMemos(inboxOnly: boolean): Memo[] {
    const condition = inboxOnly
      ? 'm.deleted_at IS NULL AND m.archived_at IS NULL AND m.inbox = 1'
      : 'm.deleted_at IS NULL AND m.archived_at IS NULL'
    return this.queryMemos(condition, []).map(mapMemo)
  }

  markMemoConverted(memoId: string, taskId: string, now: string): void {
    const database = this.database()
    const transaction = database.transaction(() => {
      database
        .prepare('UPDATE memos SET inbox = 0, processed_at = ?, updated_at = ? WHERE id = ?')
        .run(now, now, memoId)
      database
        .prepare(
          `INSERT INTO entity_relations(
             source_type, source_id, target_type, target_id, relation_type, created_at
           ) VALUES ('memo', ?, 'task', ?, 'CONVERTED_TO', ?)`
        )
        .run(memoId, taskId, now)
      this.insertAudit(database, 'memo', memoId, 'converted_to_task', null, { taskId }, now)
    })
    transaction()
  }

  private queryEfforts(condition: string, parameters: unknown[], suffix = ''): EffortRow[] {
    return this.database()
      .prepare(
        `SELECT e.id, e.entity_type, e.entity_id, e.entity_title_snapshot, e.source,
                e.started_at, e.ended_at, e.effective_minutes, e.energy,
                e.perceived_difficulty, e.result, e.interruptions, e.obstacles,
                e.next_step, e.created_at, e.updated_at,
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
        `SELECT m.id, m.kind, m.title, m.body, m.inbox, m.processed_at,
                m.created_at, m.updated_at,
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
    tagIds: row.tag_ids ? row.tag_ids.split(',') : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}
