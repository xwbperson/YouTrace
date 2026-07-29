import type Database from 'better-sqlite3'
import type { UserPreferences } from '../../../shared/contracts'

const PREFERENCES_KEY = 'user_preferences'

export class SettingsRepository {
  constructor(private readonly database: () => Database.Database) {}

  get(): UserPreferences | null {
    const row = this.database()
      .prepare('SELECT value_json FROM workspace_settings WHERE key = ?')
      .get(PREFERENCES_KEY) as { value_json: string } | undefined
    return row ? (JSON.parse(row.value_json) as UserPreferences) : null
  }

  save(preferences: UserPreferences, now: string): void {
    this.database()
      .prepare(
        `INSERT INTO workspace_settings(key, value_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           value_json = excluded.value_json,
           updated_at = excluded.updated_at`
      )
      .run(PREFERENCES_KEY, JSON.stringify(preferences), now)
  }
}
