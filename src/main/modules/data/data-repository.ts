import type Database from 'better-sqlite3'
import type {
  BackupInfo,
  Evidence,
  EvidenceAttachment,
  ImportEvidenceFileInput,
  TrashItem
} from '../../../shared/contracts'

interface BackupRow {
  id: string
  relative_path: string
  kind: BackupInfo['kind']
  label: string
  created_at: string
  verified_at: string | null
  manifest_hash: string
  size_bytes: number
  source_schema_version: number
}

interface TrashRow {
  id: string
  entity_type: TrashItem['entityType']
  entity_id: string
  title: string
  deleted_at: string
  parent_available: number
  attachment_count: number
  shared_attachment_count: number
}

export class DataRepository {
  constructor(private readonly database: () => Database.Database) {}

  listBackups(): BackupInfo[] {
    return (
      this.database()
        .prepare(
          `SELECT id, relative_path, kind, label, created_at, verified_at,
                  manifest_hash, size_bytes, source_schema_version
             FROM backup_records ORDER BY created_at DESC`
        )
        .all() as BackupRow[]
    ).map(mapBackup)
  }

  getBackup(id: string): BackupInfo | null {
    return this.listBackups().find((backup) => backup.id === id) ?? null
  }

  insertBackup(
    id: string,
    relativePath: string,
    kind: BackupInfo['kind'],
    label: string,
    createdAt: string,
    manifestHash: string,
    sizeBytes: number,
    schemaVersion: number
  ): BackupInfo {
    this.database()
      .prepare(
        `INSERT INTO backup_records(
           id, relative_path, kind, label, created_at, verified_at,
           manifest_hash, size_bytes, source_schema_version
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        relativePath,
        kind,
        label,
        createdAt,
        createdAt,
        manifestHash,
        sizeBytes,
        schemaVersion
      )
    return this.getBackup(id)!
  }

  deleteBackupRecord(id: string): void {
    this.database().prepare('DELETE FROM backup_records WHERE id = ?').run(id)
  }

  listReferencedFiles(): Array<{ id: string; relativePath: string }> {
    return (
      this.database()
        .prepare('SELECT id, relative_path FROM attachments WHERE pending_cleanup_at IS NULL')
        .all() as Array<{ id: string; relative_path: string }>
    ).map((row) => ({ id: row.id, relativePath: row.relative_path }))
  }

  getRecordCounts(): Record<string, number> {
    const tables = [
      'projects',
      'goals',
      'milestones',
      'tasks',
      'effort_entries',
      'evidence',
      'memos',
      'attachments',
      'tags'
    ]
    return Object.fromEntries(
      tables.map((table) => {
        const row = this.database().prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
          count: number
        }
        return [table, row.count]
      })
    )
  }

  getEvidenceOpenTarget(id: string): {
    kind: Evidence['kind']
    source: string | null
    relativePath: string | null
  } | null {
    const row = this.database()
      .prepare(
        `SELECT e.kind, e.source, a.relative_path
           FROM evidence e
           LEFT JOIN entity_attachments ea
             ON ea.entity_type = 'evidence' AND ea.entity_id = e.id
           LEFT JOIN attachments a ON a.id = ea.attachment_id
          WHERE e.id = ? AND e.deleted_at IS NULL
          LIMIT 1`
      )
      .get(id) as
      | { kind: Evidence['kind']; source: string | null; relative_path: string | null }
      | undefined
    return row
      ? { kind: row.kind, source: row.source, relativePath: row.relative_path }
      : null
  }

  getEvidenceAttachmentPath(attachmentId: string): string | null {
    const row = this.database()
      .prepare(
        `SELECT a.relative_path
           FROM attachments a
          WHERE a.id = ?
            AND a.pending_cleanup_at IS NULL
            AND EXISTS(
              SELECT 1
                FROM entity_attachments ea
                JOIN evidence e
                  ON ea.entity_type = 'evidence' AND ea.entity_id = e.id
               WHERE ea.attachment_id = a.id AND e.deleted_at IS NULL
            )`
      )
      .get(attachmentId) as { relative_path: string } | undefined
    return row?.relative_path ?? null
  }

  rebuildSearchIndex(): number {
    const database = this.database()
    return database.transaction(() => {
      database.prepare('DELETE FROM searchable_content').run()
      const inserts = [
        `INSERT INTO searchable_content(entity_type, entity_id, title, body)
         SELECT 'project', id, name, description FROM projects
          WHERE deleted_at IS NULL AND archived_at IS NULL`,
        `INSERT INTO searchable_content(entity_type, entity_id, title, body)
         SELECT 'goal', id, title, success_criteria FROM goals
          WHERE deleted_at IS NULL AND archived_at IS NULL`,
        `INSERT INTO searchable_content(entity_type, entity_id, title, body)
         SELECT 'milestone', id, title, description FROM milestones
          WHERE deleted_at IS NULL AND archived_at IS NULL`,
        `INSERT INTO searchable_content(entity_type, entity_id, title, body)
         SELECT 'task', id, title, description FROM tasks
          WHERE deleted_at IS NULL AND archived_at IS NULL`,
        `INSERT INTO searchable_content(entity_type, entity_id, title, body)
         SELECT 'memo', id, COALESCE(NULLIF(title, ''), SUBSTR(body, 1, 80)), body FROM memos
          WHERE deleted_at IS NULL AND archived_at IS NULL`,
        `INSERT INTO searchable_content(entity_type, entity_id, title, body)
         SELECT 'evidence', id, title, note FROM evidence WHERE deleted_at IS NULL`,
        `INSERT INTO searchable_content(entity_type, entity_id, title, body)
         SELECT 'knowledge', id, title, content FROM knowledge_items
          WHERE deleted_at IS NULL AND archived_at IS NULL`,
        `INSERT INTO searchable_content(entity_type, entity_id, title, body)
         SELECT 'mistake', id, SUBSTR(question, 1, 160), analysis FROM mistakes
          WHERE deleted_at IS NULL AND archived_at IS NULL`
      ]
      for (const statement of inserts) database.prepare(statement).run()
      const row = database
        .prepare('SELECT COUNT(*) AS count FROM searchable_content')
        .get() as { count: number }
      return row.count
    })()
  }

  listTrash(): TrashItem[] {
    const rows = this.database()
      .prepare(
        `SELECT tr.id, tr.entity_type, tr.entity_id, tr.deleted_at,
                CASE tr.entity_type
                  WHEN 'area' THEN COALESCE(a.name, '已删除领域')
                  WHEN 'project' THEN COALESCE(p.name, '已删除项目')
                  WHEN 'goal' THEN COALESCE(g.title, '已删除目标')
                  WHEN 'milestone' THEN COALESCE(m.title, '已删除里程碑')
                  WHEN 'task' THEN COALESCE(t.title, '已删除任务')
                  WHEN 'habit' THEN COALESCE(h.name, '已删除习惯')
                  WHEN 'metric' THEN COALESCE(mt.name, '已删除指标')
                  WHEN 'course' THEN COALESCE(c.course_name, '已删除课程')
                  WHEN 'knowledge' THEN COALESCE(k.title, '已删除知识点')
                  WHEN 'mistake' THEN COALESCE(SUBSTR(mk.question, 1, 160), '已删除错题')
                  WHEN 'learning_test' THEN COALESCE(lt.title, '已删除测试')
                  WHEN 'review' THEN COALESCE(r.title, '已删除复盘')
                  WHEN 'evidence' THEN COALESCE(e.title, '已删除成果')
                END AS title,
                CASE
                  WHEN tr.entity_type = 'area' THEN 1
                  WHEN tr.entity_type = 'project' THEN 1
                  WHEN tr.entity_type = 'review' THEN 1
                  WHEN tr.entity_type = 'evidence' THEN 1
                  WHEN tr.entity_type = 'goal' AND g.id IS NULL THEN 0
                  WHEN tr.entity_type = 'goal' AND g.project_id IS NULL THEN 1
                  WHEN tr.entity_type = 'goal' AND EXISTS(
                    SELECT 1 FROM projects parent
                     WHERE parent.id = g.project_id AND parent.deleted_at IS NULL
                  ) THEN 1
                  WHEN tr.entity_type = 'goal' THEN 0
                  WHEN tr.entity_type = 'milestone' AND m.id IS NULL THEN 0
                  WHEN tr.entity_type = 'milestone' AND EXISTS(
                    SELECT 1 FROM projects parent
                     WHERE parent.id = m.project_id AND parent.deleted_at IS NULL
                  ) THEN 1
                  WHEN tr.entity_type = 'milestone' THEN 0
                  WHEN tr.entity_type = 'habit' AND h.id IS NULL THEN 0
                  WHEN tr.entity_type = 'habit' AND h.project_id IS NULL THEN 1
                  WHEN tr.entity_type = 'habit' AND EXISTS(SELECT 1 FROM projects parent WHERE parent.id = h.project_id AND parent.deleted_at IS NULL) THEN 1
                  WHEN tr.entity_type = 'habit' THEN 0
                  WHEN tr.entity_type = 'metric' AND mt.id IS NULL THEN 0
                  WHEN tr.entity_type = 'metric' AND mt.project_id IS NULL THEN 1
                  WHEN tr.entity_type = 'metric' AND EXISTS(SELECT 1 FROM projects parent WHERE parent.id = mt.project_id AND parent.deleted_at IS NULL) THEN 1
                  WHEN tr.entity_type = 'metric' THEN 0
                  WHEN tr.entity_type = 'course' AND c.id IS NOT NULL AND EXISTS(SELECT 1 FROM projects parent WHERE parent.id = c.project_id AND parent.deleted_at IS NULL) THEN 1
                  WHEN tr.entity_type = 'course' THEN 0
                  WHEN tr.entity_type = 'knowledge' AND k.id IS NOT NULL AND EXISTS(SELECT 1 FROM projects parent WHERE parent.id = k.project_id AND parent.deleted_at IS NULL) THEN 1
                  WHEN tr.entity_type = 'knowledge' THEN 0
                  WHEN tr.entity_type = 'mistake' AND mk.id IS NOT NULL AND EXISTS(SELECT 1 FROM projects parent WHERE parent.id = mk.project_id AND parent.deleted_at IS NULL) THEN 1
                  WHEN tr.entity_type = 'mistake' THEN 0
                  WHEN tr.entity_type = 'learning_test' AND lt.id IS NOT NULL AND EXISTS(SELECT 1 FROM projects parent WHERE parent.id = lt.project_id AND parent.deleted_at IS NULL) THEN 1
                  WHEN tr.entity_type = 'learning_test' THEN 0
                  WHEN t.id IS NULL THEN 0
                  WHEN EXISTS(
                    SELECT 1 FROM audit_events ae
                     WHERE ae.entity_type = 'task'
                       AND ae.entity_id = tr.entity_id
                       AND ae.action = 'parent_purged'
                  ) THEN 0
                  WHEN t.project_id IS NULL THEN 1
                  WHEN EXISTS(SELECT 1 FROM projects parent WHERE parent.id = t.project_id AND parent.deleted_at IS NULL) THEN 1
                  ELSE 0
                END AS parent_available,
                (SELECT COUNT(*) FROM entity_attachments ea
                  WHERE ea.entity_type = tr.entity_type AND ea.entity_id = tr.entity_id)
                  AS attachment_count,
                (SELECT COUNT(*) FROM entity_attachments ea
                  WHERE ea.entity_type = tr.entity_type AND ea.entity_id = tr.entity_id
                    AND (SELECT COUNT(*) FROM entity_attachments shared
                          WHERE shared.attachment_id = ea.attachment_id) > 1)
                  AS shared_attachment_count
           FROM trash_entries tr
           LEFT JOIN areas a ON tr.entity_type = 'area' AND a.id = tr.entity_id
           LEFT JOIN projects p ON tr.entity_type = 'project' AND p.id = tr.entity_id
           LEFT JOIN goals g ON tr.entity_type = 'goal' AND g.id = tr.entity_id
           LEFT JOIN milestones m ON tr.entity_type = 'milestone' AND m.id = tr.entity_id
           LEFT JOIN tasks t ON tr.entity_type = 'task' AND t.id = tr.entity_id
           LEFT JOIN habit_rules h ON tr.entity_type = 'habit' AND h.id = tr.entity_id
           LEFT JOIN metrics mt ON tr.entity_type = 'metric' AND mt.id = tr.entity_id
           LEFT JOIN course_profiles c ON tr.entity_type = 'course' AND c.id = tr.entity_id
           LEFT JOIN knowledge_items k ON tr.entity_type = 'knowledge' AND k.id = tr.entity_id
           LEFT JOIN mistakes mk ON tr.entity_type = 'mistake' AND mk.id = tr.entity_id
           LEFT JOIN learning_tests lt ON tr.entity_type = 'learning_test' AND lt.id = tr.entity_id
           LEFT JOIN reviews r ON tr.entity_type = 'review' AND r.id = tr.entity_id
           LEFT JOIN evidence e ON tr.entity_type = 'evidence' AND e.id = tr.entity_id
          WHERE tr.purged_at IS NULL
          ORDER BY tr.deleted_at DESC`
      )
      .all() as TrashRow[]
    return rows.map(mapTrash)
  }

  restoreTrash(id: string, now: string): TrashItem | null {
    const item = this.listTrash().find((candidate) => candidate.id === id)
    if (!item) return null
    const database = this.database()
    const transaction = database.transaction(() => {
      if (item.entityType === 'area') {
        database
          .prepare('UPDATE areas SET deleted_at = NULL, updated_at = ? WHERE id = ?')
          .run(now, item.entityId)
      } else if (item.entityType === 'project') {
        database
          .prepare('UPDATE projects SET deleted_at = NULL, updated_at = ? WHERE id = ?')
          .run(now, item.entityId)
        const project = database
          .prepare('SELECT name, description FROM projects WHERE id = ?')
          .get(item.entityId) as { name: string; description: string }
        this.upsertSearch(database, 'project', item.entityId, project.name, project.description)
      } else if (item.entityType === 'goal') {
        database
          .prepare('UPDATE goals SET deleted_at = NULL, updated_at = ? WHERE id = ?')
          .run(now, item.entityId)
        const goal = database
          .prepare('SELECT title, success_criteria FROM goals WHERE id = ?')
          .get(item.entityId) as { title: string; success_criteria: string }
        this.upsertSearch(database, 'goal', item.entityId, goal.title, goal.success_criteria)
      } else if (item.entityType === 'milestone') {
        database
          .prepare('UPDATE milestones SET deleted_at = NULL, updated_at = ? WHERE id = ?')
          .run(now, item.entityId)
        const milestone = database
          .prepare('SELECT title, description FROM milestones WHERE id = ?')
          .get(item.entityId) as { title: string; description: string }
        this.upsertSearch(database, 'milestone', item.entityId, milestone.title, milestone.description)
      } else if (item.entityType === 'task') {
        if (!item.parentAvailable) {
          database
            .prepare(
              `UPDATE tasks SET project_id = NULL, goal_id = NULL, milestone_id = NULL,
                 parent_task_id = NULL, deleted_at = NULL, updated_at = ? WHERE id = ?`
            )
            .run(now, item.entityId)
        } else {
          database
            .prepare('UPDATE tasks SET deleted_at = NULL, updated_at = ? WHERE id = ?')
            .run(now, item.entityId)
        }
        const task = database
          .prepare('SELECT title, description FROM tasks WHERE id = ?')
          .get(item.entityId) as { title: string; description: string }
        this.upsertSearch(database, 'task', item.entityId, task.title, task.description)
      } else if (item.entityType === 'habit') {
        database.prepare('UPDATE habit_rules SET deleted_at = NULL, updated_at = ? WHERE id = ?').run(now, item.entityId)
      } else if (item.entityType === 'metric') {
        database.prepare('UPDATE metrics SET deleted_at = NULL, updated_at = ? WHERE id = ?').run(now, item.entityId)
      } else if (item.entityType === 'course') {
        database.prepare('UPDATE course_profiles SET deleted_at = NULL, updated_at = ? WHERE id = ?').run(now, item.entityId)
      } else if (item.entityType === 'knowledge') {
        database.prepare('UPDATE knowledge_items SET deleted_at = NULL, updated_at = ? WHERE id = ?').run(now, item.entityId)
        const knowledge = database.prepare('SELECT title, content FROM knowledge_items WHERE id = ?').get(item.entityId) as { title: string; content: string }
        this.upsertSearch(database, 'knowledge', item.entityId, knowledge.title, knowledge.content)
      } else if (item.entityType === 'mistake') {
        database.prepare('UPDATE mistakes SET deleted_at = NULL, updated_at = ? WHERE id = ?').run(now, item.entityId)
        const mistake = database.prepare('SELECT question, analysis FROM mistakes WHERE id = ?').get(item.entityId) as { question: string; analysis: string }
        this.upsertSearch(database, 'mistake', item.entityId, mistake.question.slice(0, 160), mistake.analysis)
      } else if (item.entityType === 'learning_test') {
        database.prepare('UPDATE learning_tests SET deleted_at = NULL, updated_at = ? WHERE id = ?').run(now, item.entityId)
      } else if (item.entityType === 'evidence') {
        database
          .prepare('UPDATE evidence SET deleted_at = NULL, updated_at = ? WHERE id = ?')
          .run(now, item.entityId)
        const evidence = database
          .prepare('SELECT title, note FROM evidence WHERE id = ?')
          .get(item.entityId) as { title: string; note: string }
        this.upsertSearch(database, 'evidence', item.entityId, evidence.title, evidence.note)
      } else {
        database
          .prepare('UPDATE reviews SET deleted_at = NULL, updated_at = ? WHERE id = ?')
          .run(now, item.entityId)
      }
      database.prepare('DELETE FROM trash_entries WHERE id = ?').run(id)
      this.insertAudit(database, item.entityType, item.entityId, 'restored', { trashId: id }, now)
    })
    transaction()
    return { ...item, parentAvailable: true }
  }

  purgeTrash(id: string, now: string): { item: TrashItem; orphanPaths: string[] } | null {
    const item = this.listTrash().find((candidate) => candidate.id === id)
    if (!item) return null
    const database = this.database()
    const orphanPaths: string[] = []
    const transaction = database.transaction(() => {
      if (item.entityType === 'area') {
        database.prepare('UPDATE projects SET area_id = NULL WHERE area_id = ?').run(item.entityId)
        orphanPaths.push(...this.detachAttachments(database, 'area', [item.entityId]))
        this.deleteRelations(database, 'area', [item.entityId])
        database.prepare('DELETE FROM areas WHERE id = ?').run(item.entityId)
      } else if (item.entityType === 'task') {
        const attachments = database
          .prepare(
            `SELECT a.id, a.relative_path,
                    (SELECT COUNT(*) FROM entity_attachments shared
                      WHERE shared.attachment_id = a.id) AS reference_count
               FROM attachments a
               JOIN entity_attachments ea ON ea.attachment_id = a.id
              WHERE ea.entity_type = 'task' AND ea.entity_id = ?`
          )
          .all(item.entityId) as Array<{
          id: string
          relative_path: string
          reference_count: number
        }>
        database
          .prepare("DELETE FROM entity_attachments WHERE entity_type = 'task' AND entity_id = ?")
          .run(item.entityId)
        for (const attachment of attachments) {
          if (attachment.reference_count === 1) {
            orphanPaths.push(attachment.relative_path)
            database.prepare('DELETE FROM attachments WHERE id = ?').run(attachment.id)
          }
        }
        database.prepare('UPDATE tasks SET parent_task_id = NULL WHERE parent_task_id = ?').run(item.entityId)
        database.prepare('UPDATE time_blocks SET task_id = NULL WHERE task_id = ?').run(item.entityId)
        database.prepare('DELETE FROM task_dependencies WHERE task_id = ? OR prerequisite_task_id = ?').run(item.entityId, item.entityId)
        this.deleteRelations(database, 'task', [item.entityId])
        database.prepare('DELETE FROM tasks WHERE id = ?').run(item.entityId)
      } else if (item.entityType === 'project') {
        orphanPaths.push(...this.purgeProject(database, item.entityId, now))
      } else if (item.entityType === 'goal') {
        database.prepare('UPDATE milestones SET goal_id = NULL WHERE goal_id = ?').run(item.entityId)
        database.prepare('UPDATE tasks SET goal_id = NULL WHERE goal_id = ?').run(item.entityId)
        orphanPaths.push(...this.detachAttachments(database, 'goal', [item.entityId]))
        this.deleteRelations(database, 'goal', [item.entityId])
        database.prepare('DELETE FROM goals WHERE id = ?').run(item.entityId)
      } else if (item.entityType === 'milestone') {
        database.prepare('UPDATE tasks SET milestone_id = NULL WHERE milestone_id = ?').run(item.entityId)
        database.prepare('UPDATE knowledge_items SET milestone_id = NULL WHERE milestone_id = ?').run(item.entityId)
        database.prepare('UPDATE learning_tests SET milestone_id = NULL WHERE milestone_id = ?').run(item.entityId)
        orphanPaths.push(...this.detachAttachments(database, 'milestone', [item.entityId]))
        this.deleteRelations(database, 'milestone', [item.entityId])
        database.prepare('DELETE FROM milestones WHERE id = ?').run(item.entityId)
      } else if (item.entityType === 'habit') {
        this.deleteReminders(database, 'habit', [item.entityId])
        database.prepare('DELETE FROM habit_instances WHERE habit_rule_id = ?').run(item.entityId)
        orphanPaths.push(...this.detachAttachments(database, 'habit', [item.entityId]))
        this.deleteRelations(database, 'habit', [item.entityId])
        database.prepare('DELETE FROM habit_rules WHERE id = ?').run(item.entityId)
      } else if (item.entityType === 'metric') {
        database.prepare('DELETE FROM metric_entries WHERE metric_id = ?').run(item.entityId)
        orphanPaths.push(...this.detachAttachments(database, 'metric', [item.entityId]))
        this.deleteRelations(database, 'metric', [item.entityId])
        database.prepare('DELETE FROM metrics WHERE id = ?').run(item.entityId)
      } else if (item.entityType === 'course') {
        database.prepare('DELETE FROM textbooks WHERE course_profile_id = ?').run(item.entityId)
        orphanPaths.push(...this.detachAttachments(database, 'course', [item.entityId]))
        this.deleteRelations(database, 'course', [item.entityId])
        database.prepare('DELETE FROM course_profiles WHERE id = ?').run(item.entityId)
      } else if (item.entityType === 'knowledge') {
        database.prepare('UPDATE mistakes SET knowledge_item_id = NULL WHERE knowledge_item_id = ?').run(item.entityId)
        database.prepare("DELETE FROM review_queue WHERE entity_type = 'knowledge' AND entity_id = ?").run(item.entityId)
        orphanPaths.push(...this.detachAttachments(database, 'knowledge', [item.entityId]))
        this.deleteRelations(database, 'knowledge', [item.entityId])
        database.prepare('DELETE FROM knowledge_items WHERE id = ?').run(item.entityId)
      } else if (item.entityType === 'mistake') {
        database.prepare("DELETE FROM review_queue WHERE entity_type = 'mistake' AND entity_id = ?").run(item.entityId)
        orphanPaths.push(...this.detachAttachments(database, 'mistake', [item.entityId]))
        this.deleteRelations(database, 'mistake', [item.entityId])
        database.prepare('DELETE FROM mistakes WHERE id = ?').run(item.entityId)
      } else if (item.entityType === 'learning_test') {
        orphanPaths.push(...this.detachAttachments(database, 'learning_test', [item.entityId]))
        this.deleteRelations(database, 'learning_test', [item.entityId])
        database.prepare('DELETE FROM learning_tests WHERE id = ?').run(item.entityId)
      } else if (item.entityType === 'evidence') {
        const attachments = database
          .prepare(
            `SELECT a.id, a.relative_path,
                    (SELECT COUNT(*) FROM entity_attachments shared
                      WHERE shared.attachment_id = a.id) AS reference_count
               FROM attachments a
               JOIN entity_attachments ea ON ea.attachment_id = a.id
              WHERE ea.entity_type = 'evidence' AND ea.entity_id = ?`
          )
          .all(item.entityId) as Array<{
          id: string
          relative_path: string
          reference_count: number
        }>
        database
          .prepare("DELETE FROM entity_attachments WHERE entity_type = 'evidence' AND entity_id = ?")
          .run(item.entityId)
        for (const attachment of attachments) {
          if (attachment.reference_count === 1) {
            orphanPaths.push(attachment.relative_path)
            database.prepare('DELETE FROM attachments WHERE id = ?').run(attachment.id)
          }
        }
        database.prepare('DELETE FROM entity_evidence WHERE evidence_id = ?').run(item.entityId)
        database
          .prepare("DELETE FROM tag_assignments WHERE entity_type = 'evidence' AND entity_id = ?")
          .run(item.entityId)
        database
          .prepare("DELETE FROM searchable_content WHERE entity_type = 'evidence' AND entity_id = ?")
          .run(item.entityId)
        database.prepare('DELETE FROM evidence WHERE id = ?').run(item.entityId)
      } else {
        database.prepare('DELETE FROM plan_adjustments WHERE review_id = ?').run(item.entityId)
        database.prepare('DELETE FROM review_snapshots WHERE review_id = ?').run(item.entityId)
        database.prepare('DELETE FROM reviews WHERE id = ?').run(item.entityId)
      }
      database.prepare('UPDATE trash_entries SET purged_at = ? WHERE id = ?').run(now, id)
      this.insertAudit(database, item.entityType, item.entityId, 'purged', { trashId: id }, now)
    })
    transaction()
    return { item, orphanPaths }
  }

  findAttachmentByHash(hash: string): {
    id: string
    originalName: string
    relativePath: string
    sizeBytes: number
    contentHash: string
  } | null {
    const row = this.database()
      .prepare(
        `SELECT id, original_name, relative_path, size_bytes, content_hash
           FROM attachments WHERE content_hash = ? AND pending_cleanup_at IS NULL LIMIT 1`
      )
      .get(hash) as {
      id: string
      original_name: string
      relative_path: string
      size_bytes: number
      content_hash: string
    } | undefined
    return row
      ? {
          id: row.id,
          originalName: row.original_name,
          relativePath: row.relative_path,
          sizeBytes: row.size_bytes,
          contentHash: row.content_hash
        }
      : null
  }

  hasEvidence(id: string): boolean {
    return Boolean(
      this.database()
        .prepare('SELECT id FROM evidence WHERE id = ? AND deleted_at IS NULL')
        .get(id)
    )
  }

  listEvidenceAttachments(evidenceId: string): EvidenceAttachment[] {
    return (
      this.database()
        .prepare(
          `SELECT a.id, a.original_name, a.relative_path, a.size_bytes, a.content_hash
             FROM attachments a
             JOIN entity_attachments ea ON ea.attachment_id = a.id
            WHERE ea.entity_type = 'evidence' AND ea.entity_id = ?
              AND a.pending_cleanup_at IS NULL
            ORDER BY ea.created_at, a.original_name`
        )
        .all(evidenceId) as Array<{
        id: string
        original_name: string
        relative_path: string
        size_bytes: number
        content_hash: string
      }>
    ).map((row) => ({
      id: row.id,
      originalName: row.original_name,
      relativePath: row.relative_path,
      sizeBytes: row.size_bytes,
      contentHash: row.content_hash
    }))
  }

  attachEvidenceFile(
    evidenceId: string,
    attachment: {
      id: string
      relativePath: string
      originalName: string
      contentHash: string
      sizeBytes: number
      mimeType: string | null
      reused: boolean
    },
    now: string
  ): boolean {
    const database = this.database()
    return database.transaction(() => {
      const evidence = database
        .prepare('SELECT id FROM evidence WHERE id = ? AND deleted_at IS NULL')
        .get(evidenceId)
      if (!evidence) return false
      if (!attachment.reused) {
        database
          .prepare(
            `INSERT INTO attachments(
               id, relative_path, original_name, content_hash, size_bytes, mime_type, created_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            attachment.id,
            attachment.relativePath,
            attachment.originalName,
            attachment.contentHash,
            attachment.sizeBytes,
            attachment.mimeType,
            now
          )
      }
      database
        .prepare(
          `INSERT OR IGNORE INTO entity_attachments(
             attachment_id, entity_type, entity_id, created_at
           ) VALUES (?, 'evidence', ?, ?)`
        )
        .run(attachment.id, evidenceId, now)
      this.insertAudit(
        database,
        'evidence',
        evidenceId,
        'attachment_added',
        { attachmentId: attachment.id, originalName: attachment.originalName },
        now
      )
      return true
    })()
  }

  insertEvidenceFile(
    evidenceId: string,
    attachment: {
      id: string
      relativePath: string
      originalName: string
      contentHash: string
      sizeBytes: number
      mimeType: string | null
      reused: boolean
    },
    input: ImportEvidenceFileInput,
    now: string
  ): Evidence {
    const database = this.database()
    const transaction = database.transaction(() => {
      if (!attachment.reused) {
        database
          .prepare(
            `INSERT INTO attachments(
               id, relative_path, original_name, content_hash, size_bytes, mime_type, created_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            attachment.id,
            attachment.relativePath,
            attachment.originalName,
            attachment.contentHash,
            attachment.sizeBytes,
            attachment.mimeType,
            now
          )
      }
      database
        .prepare(
          `INSERT INTO evidence(
             id, kind, title, note, source, verification_status, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          evidenceId,
          input.kind,
          input.title,
          input.note,
          input.kind === 'file' || input.kind === 'image'
            ? attachment.originalName
            : input.source ?? null,
          input.verificationStatus,
          now,
          now
        )
      database
        .prepare(
          `INSERT INTO entity_attachments(attachment_id, entity_type, entity_id, created_at)
           VALUES (?, 'evidence', ?, ?)`
        )
        .run(attachment.id, evidenceId, now)
      if (input.entityType && input.entityId) {
        database
          .prepare(
            `INSERT INTO entity_evidence(evidence_id, entity_type, entity_id, created_at)
             VALUES (?, ?, ?, ?)`
          )
          .run(evidenceId, input.entityType, input.entityId, now)
      }
      const insertTag = database.prepare(
        `INSERT INTO tag_assignments(tag_id, entity_type, entity_id, created_at)
         VALUES (?, 'evidence', ?, ?)`
      )
      for (const tagId of [...new Set(input.tagIds)]) insertTag.run(tagId, evidenceId, now)
      this.upsertSearch(database, 'evidence', evidenceId, input.title, input.note)
      this.insertAudit(database, 'evidence', evidenceId, 'file_imported', input, now)
    })
    transaction()
    return {
      id: evidenceId,
      kind: input.kind,
      title: input.title,
      note: input.note,
      source:
        input.kind === 'file' || input.kind === 'image'
          ? attachment.originalName
          : input.source ?? null,
      verificationStatus: input.verificationStatus,
      entityType: input.entityType,
      entityId: input.entityId,
      attachmentCount: 1,
      tagIds: input.tagIds,
      createdAt: now,
      updatedAt: now
    }
  }

  private purgeProject(
    database: Database.Database,
    projectId: string,
    now: string
  ): string[] {
    const goalIds = (
      database.prepare('SELECT id FROM goals WHERE project_id = ?').all(projectId) as Array<{ id: string }>
    ).map((row) => row.id)
    const milestoneIds = (
      database.prepare('SELECT id FROM milestones WHERE project_id = ?').all(projectId) as Array<{ id: string }>
    ).map((row) => row.id)
    const courseIds = (database.prepare('SELECT id FROM course_profiles WHERE project_id = ?').all(projectId) as Array<{ id: string }>).map((row) => row.id)
    const knowledgeIds = (database.prepare('SELECT id FROM knowledge_items WHERE project_id = ?').all(projectId) as Array<{ id: string }>).map((row) => row.id)
    const mistakeIds = (database.prepare('SELECT id FROM mistakes WHERE project_id = ?').all(projectId) as Array<{ id: string }>).map((row) => row.id)
    const learningTestIds = (database.prepare('SELECT id FROM learning_tests WHERE project_id = ?').all(projectId) as Array<{ id: string }>).map((row) => row.id)
    const habitIds = (database.prepare('SELECT id FROM habit_rules WHERE project_id = ?').all(projectId) as Array<{ id: string }>).map((row) => row.id)
    const metricIds = (database.prepare('SELECT id FROM metrics WHERE project_id = ?').all(projectId) as Array<{ id: string }>).map((row) => row.id)
    const taskIds = (
      database.prepare('SELECT id FROM tasks WHERE project_id = ?').all(projectId) as Array<{ id: string }>
    ).map((row) => row.id)
    const protectedTaskIds = new Set(
      (
        database
          .prepare(
            `SELECT entity_id AS id
               FROM trash_entries
              WHERE entity_type = 'task'
                AND purged_at IS NULL
                AND entity_id IN (SELECT id FROM tasks WHERE project_id = ?)`
          )
          .all(projectId) as Array<{ id: string }>
      ).map((row) => row.id)
    )
    const purgedTaskIds = taskIds.filter((taskId) => !protectedTaskIds.has(taskId))
    for (const taskId of purgedTaskIds) {
      database.prepare('UPDATE time_blocks SET task_id = NULL WHERE task_id = ?').run(taskId)
      database.prepare('DELETE FROM task_dependencies WHERE task_id = ? OR prerequisite_task_id = ?').run(taskId, taskId)
      database.prepare('UPDATE tasks SET parent_task_id = NULL WHERE parent_task_id = ?').run(taskId)
    }
    for (const taskId of protectedTaskIds) {
      database
        .prepare(
          `UPDATE tasks
              SET project_id = NULL, goal_id = NULL, milestone_id = NULL,
                  parent_task_id = NULL, updated_at = ?
            WHERE id = ?`
        )
        .run(now, taskId)
      this.insertAudit(database, 'task', taskId, 'parent_purged', { projectId }, now)
    }
    const orphanPaths = this.detachAttachments(database, 'task', purgedTaskIds)
    this.deleteRelations(database, 'task', purgedTaskIds)
    database.prepare('DELETE FROM tasks WHERE project_id = ?').run(projectId)
    orphanPaths.push(...this.detachAttachments(database, 'milestone', milestoneIds))
    orphanPaths.push(...this.detachAttachments(database, 'goal', goalIds))
    this.deleteRelations(database, 'milestone', milestoneIds)
    this.deleteRelations(database, 'goal', goalIds)
    database
      .prepare(
        `UPDATE trash_entries SET purged_at = ?
          WHERE purged_at IS NULL
            AND ((entity_type = 'milestone' AND entity_id IN (SELECT id FROM milestones WHERE project_id = ?))
              OR (entity_type = 'goal' AND entity_id IN (SELECT id FROM goals WHERE project_id = ?)))`
      )
      .run(now, projectId, projectId)
    database.prepare('DELETE FROM milestones WHERE project_id = ?').run(projectId)
    database.prepare('DELETE FROM goals WHERE project_id = ?').run(projectId)
    const practiceChildren = [
      ['course', courseIds],
      ['knowledge', knowledgeIds],
      ['mistake', mistakeIds],
      ['learning_test', learningTestIds],
      ['habit', habitIds],
      ['metric', metricIds]
    ] as const
    for (const [entityType, entityIds] of practiceChildren) {
      orphanPaths.push(...this.detachAttachments(database, entityType, [...entityIds]))
      this.deleteRelations(database, entityType, [...entityIds])
      for (const entityId of entityIds) {
        database.prepare('UPDATE trash_entries SET purged_at = ? WHERE entity_type = ? AND entity_id = ? AND purged_at IS NULL').run(now, entityType, entityId)
      }
    }
    for (const courseId of courseIds) database.prepare('DELETE FROM textbooks WHERE course_profile_id = ?').run(courseId)
    database.prepare('DELETE FROM review_queue WHERE entity_id IN (SELECT id FROM knowledge_items WHERE project_id = ?) OR entity_id IN (SELECT id FROM mistakes WHERE project_id = ?)').run(projectId, projectId)
    database.prepare('DELETE FROM mistakes WHERE project_id = ?').run(projectId)
    database.prepare('DELETE FROM knowledge_items WHERE project_id = ?').run(projectId)
    database.prepare('DELETE FROM learning_tests WHERE project_id = ?').run(projectId)
    database.prepare('DELETE FROM course_profiles WHERE project_id = ?').run(projectId)
    this.deleteReminders(database, 'habit', habitIds)
    database.prepare('DELETE FROM habit_instances WHERE habit_rule_id IN (SELECT id FROM habit_rules WHERE project_id = ?)').run(projectId)
    database.prepare('DELETE FROM habit_rules WHERE project_id = ?').run(projectId)
    database.prepare('DELETE FROM metric_entries WHERE metric_id IN (SELECT id FROM metrics WHERE project_id = ?)').run(projectId)
    database.prepare('DELETE FROM metrics WHERE project_id = ?').run(projectId)
    orphanPaths.push(...this.detachAttachments(database, 'project', [projectId]))
    this.deleteRelations(database, 'project', [projectId])
    database.prepare("DELETE FROM searchable_content WHERE entity_type = 'project' AND entity_id = ?").run(projectId)
    database.prepare('DELETE FROM projects WHERE id = ?').run(projectId)
    return orphanPaths
  }

  private detachAttachments(
    database: Database.Database,
    entityType: string,
    entityIds: string[]
  ): string[] {
    const orphanPaths: string[] = []
    for (const entityId of entityIds) {
      const attachments = database
        .prepare(
          `SELECT a.id, a.relative_path,
                  (SELECT COUNT(*) FROM entity_attachments shared
                    WHERE shared.attachment_id = a.id) AS reference_count
             FROM attachments a
             JOIN entity_attachments ea ON ea.attachment_id = a.id
            WHERE ea.entity_type = ? AND ea.entity_id = ?`
        )
        .all(entityType, entityId) as Array<{
        id: string
        relative_path: string
        reference_count: number
      }>
      database
        .prepare('DELETE FROM entity_attachments WHERE entity_type = ? AND entity_id = ?')
        .run(entityType, entityId)
      for (const attachment of attachments) {
        if (attachment.reference_count === 1) {
          orphanPaths.push(attachment.relative_path)
          database.prepare('DELETE FROM attachments WHERE id = ?').run(attachment.id)
        }
      }
    }
    return orphanPaths
  }

  private deleteReminders(database: Database.Database, sourceType: string, sourceIds: string[]): void {
    for (const sourceId of sourceIds) {
      database.prepare(
        `DELETE FROM reminder_event_payloads WHERE event_id IN (
           SELECT e.id FROM reminder_events e JOIN reminder_rules r ON r.id = e.rule_id
            WHERE r.source_type = ? AND r.source_id = ?)`
      ).run(sourceType, sourceId)
      database.prepare(
        `DELETE FROM reminder_events WHERE rule_id IN (
           SELECT id FROM reminder_rules WHERE source_type = ? AND source_id = ?)`
      ).run(sourceType, sourceId)
      database.prepare('DELETE FROM reminder_source_preferences WHERE source_type = ? AND source_id = ?').run(sourceType, sourceId)
      database.prepare('DELETE FROM reminder_rules WHERE source_type = ? AND source_id = ?').run(sourceType, sourceId)
    }
  }

  private deleteRelations(database: Database.Database, entityType: string, entityIds: string[]): void {
    for (const entityId of entityIds) {
      database.prepare('DELETE FROM tag_assignments WHERE entity_type = ? AND entity_id = ?').run(entityType, entityId)
      database.prepare('DELETE FROM entity_evidence WHERE entity_type = ? AND entity_id = ?').run(entityType, entityId)
      database.prepare('DELETE FROM entity_relations WHERE (source_type = ? AND source_id = ?) OR (target_type = ? AND target_id = ?)').run(entityType, entityId, entityType, entityId)
      database.prepare('DELETE FROM searchable_content WHERE entity_type = ? AND entity_id = ?').run(entityType, entityId)
    }
  }

  private upsertSearch(
    database: Database.Database,
    entityType: string,
    entityId: string,
    title: string,
    body: string
  ): void {
    database.prepare('DELETE FROM searchable_content WHERE entity_type = ? AND entity_id = ?').run(entityType, entityId)
    database.prepare('INSERT INTO searchable_content(entity_type, entity_id, title, body) VALUES (?, ?, ?, ?)').run(entityType, entityId, title, body)
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

function mapBackup(row: BackupRow): BackupInfo {
  return {
    id: row.id,
    relativePath: row.relative_path,
    kind: row.kind,
    label: row.label,
    createdAt: row.created_at,
    verifiedAt: row.verified_at,
    manifestHash: row.manifest_hash,
    sizeBytes: row.size_bytes,
    sourceSchemaVersion: row.source_schema_version
  }
}

function mapTrash(row: TrashRow): TrashItem {
  return {
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    title: row.title,
    deletedAt: row.deleted_at,
    parentAvailable: row.parent_available === 1,
    attachmentCount: row.attachment_count,
    sharedAttachmentCount: row.shared_attachment_count
  }
}
