import { dirname } from 'node:path'
import { mkdirSync } from 'node:fs'
import Database from 'better-sqlite3'
import { CURRENT_SCHEMA_VERSION, INITIAL_SCHEMA_SQL } from './schema'
import { YouTraceError } from '../../shared/errors'

export class DatabaseManager {
  private connection: Database.Database | null = null

  open(databasePath: string, readOnly = false): Database.Database {
    this.close()
    mkdirSync(dirname(databasePath), { recursive: true })

    const database = new Database(databasePath, {
      readonly: readOnly,
      fileMustExist: readOnly
    })

    database.pragma('foreign_keys = ON')
    database.pragma('busy_timeout = 5000')

    if (!readOnly) {
      database.pragma('journal_mode = WAL')
      database.pragma('synchronous = NORMAL')
      this.migrate(database)
    }

    const integrity = database.pragma('quick_check', { simple: true })
    if (integrity !== 'ok') {
      database.close()
      throw new YouTraceError({
        code: 'DATABASE_INTEGRITY_FAILED',
        message: '工作区数据库未通过完整性检查，已停止写入。',
        recovery: '请以只读方式打开或从已验证备份恢复。'
      })
    }

    this.connection = database
    return database
  }

  get(): Database.Database {
    if (!this.connection) {
      throw new YouTraceError({
        code: 'DATABASE_NOT_OPEN',
        message: '当前没有可用的工作区数据库。',
        recovery: '请先创建或打开工作区。'
      })
    }

    return this.connection
  }

  close(): void {
    if (!this.connection) return
    const connection = this.connection
    this.connection = null
    connection.close()
  }

  private migrate(database: Database.Database): void {
    const transaction = database.transaction(() => {
      database.exec(INITIAL_SCHEMA_SQL)
      const row = database
        .prepare('SELECT MAX(version) AS version FROM schema_migrations')
        .get() as { version: number | null }

      if ((row.version ?? 0) < CURRENT_SCHEMA_VERSION) {
        database
          .prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)')
          .run(CURRENT_SCHEMA_VERSION, new Date().toISOString())
      }
    })

    transaction()
  }
}
