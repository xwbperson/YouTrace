import type Database from 'better-sqlite3'
import type {
  BackupInfo,
  Evidence,
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

  listTrash(): TrashItem[] {
    const rows = this.database()
      .prepare(
        `SELECT tr.id, tr.entity_type, tr.entity_id, tr.deleted_at,
                CASE tr.entity_type
                  WHEN 'project' THEN COALESCE(p.name, '已删除项目')
                  WHEN 'task' THEN COALESCE(t.title, '已删除任务')
                END AS title,
                CASE
                  WHEN tr.entity_type = 'project' THEN 1
                  WHEN t.project_id IS NULL THEN 1
                  WHEN EXISTS(SELECT 1 FROM projects parent WHERE parent.id = t.project_id AND parent.deleted_at IS NULL) THEN 1
                  ELSE 0
                END AS parent_available,
                CASE tr.entity_type
                  WHEN 'task' THEN (
                    SELECT COUNT(*) FROM entity_attachments ea
                     WHERE ea.entity_type = 'task' AND ea.entity_id = tr.entity_id
                  )
                  ELSE 0
                END AS attachment_count,
                CASE tr.entity_type
                  WHEN 'task' THEN (
                    SELECT COUNT(*) FROM entity_attachments ea
                     WHERE ea.entity_type = 'task' AND ea.entity_id = tr.entity_id
                       AND (SELECT COUNT(*) FROM entity_attachments shared
                             WHERE shared.attachment_id = ea.attachment_id) > 1
                  )
                  ELSE 0
                END AS shared_attachment_count
           FROM trash_entries tr
           LEFT JOIN projects p ON tr.entity_type = 'project' AND p.id = tr.entity_id
           LEFT JOIN tasks t ON tr.entity_type = 'task' AND t.id = tr.entity_id
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
      if (item.entityType === 'project') {
        database
          .prepare('UPDATE projects SET deleted_at = NULL, updated_at = ? WHERE id = ?')
          .run(now, item.entityId)
        const project = database
          .prepare('SELECT name, description FROM projects WHERE id = ?')
          .get(item.entityId) as { name: string; description: string }
        this.upsertSearch(database, 'project', item.entityId, project.name, project.description)
      } else {
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
      if (item.entityType === 'task') {
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
      } else {
        this.purgeProject(database, item.entityId)
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
          attachment.originalName,
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
      source: attachment.originalName,
      verificationStatus: input.verificationStatus,
      entityType: input.entityType,
      entityId: input.entityId,
      tagIds: input.tagIds,
      createdAt: now,
      updatedAt: now
    }
  }

  private purgeProject(database: Database.Database, projectId: string): void {
    const taskIds = (
      database.prepare('SELECT id FROM tasks WHERE project_id = ?').all(projectId) as Array<{ id: string }>
    ).map((row) => row.id)
    for (const taskId of taskIds) {
      database.prepare('UPDATE time_blocks SET task_id = NULL WHERE task_id = ?').run(taskId)
      database.prepare('DELETE FROM task_dependencies WHERE task_id = ? OR prerequisite_task_id = ?').run(taskId, taskId)
    }
    this.deleteRelations(database, 'task', taskIds)
    database.prepare('DELETE FROM tasks WHERE project_id = ?').run(projectId)
    database.prepare("DELETE FROM searchable_content WHERE entity_type IN ('milestone', 'goal') AND entity_id IN (SELECT id FROM milestones WHERE project_id = ? UNION SELECT id FROM goals WHERE project_id = ?)").run(projectId, projectId)
    database.prepare('DELETE FROM milestones WHERE project_id = ?').run(projectId)
    database.prepare('DELETE FROM goals WHERE project_id = ?').run(projectId)
    const courseIds = (
      database.prepare('SELECT id FROM course_profiles WHERE project_id = ?').all(projectId) as Array<{ id: string }>
    ).map((row) => row.id)
    for (const courseId of courseIds) database.prepare('DELETE FROM textbooks WHERE course_profile_id = ?').run(courseId)
    database.prepare('DELETE FROM review_queue WHERE entity_id IN (SELECT id FROM knowledge_items WHERE project_id = ?) OR entity_id IN (SELECT id FROM mistakes WHERE project_id = ?)').run(projectId, projectId)
    database.prepare('DELETE FROM mistakes WHERE project_id = ?').run(projectId)
    database.prepare('DELETE FROM knowledge_items WHERE project_id = ?').run(projectId)
    database.prepare('DELETE FROM learning_tests WHERE project_id = ?').run(projectId)
    database.prepare('DELETE FROM course_profiles WHERE project_id = ?').run(projectId)
    database.prepare('DELETE FROM habit_instances WHERE habit_rule_id IN (SELECT id FROM habit_rules WHERE project_id = ?)').run(projectId)
    database.prepare('DELETE FROM habit_rules WHERE project_id = ?').run(projectId)
    database.prepare('DELETE FROM metric_entries WHERE metric_id IN (SELECT id FROM metrics WHERE project_id = ?)').run(projectId)
    database.prepare('DELETE FROM metrics WHERE project_id = ?').run(projectId)
    this.deleteRelations(database, 'project', [projectId])
    database.prepare("DELETE FROM searchable_content WHERE entity_type = 'project' AND entity_id = ?").run(projectId)
    database.prepare('DELETE FROM projects WHERE id = ?').run(projectId)
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
