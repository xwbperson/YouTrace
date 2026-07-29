import type { UserPreferences } from '../../../shared/contracts'
import { userPreferencesSchema } from '../../../shared/contracts'
import { SettingsRepository } from './settings-repository'

export class SettingsService {
  constructor(private readonly repository: SettingsRepository) {}

  getPreferences(): UserPreferences {
    return userPreferencesSchema.parse(this.repository.get() ?? defaultPreferences())
  }

  updatePreferences(input: UserPreferences): UserPreferences {
    const preferences = userPreferencesSchema.parse(input)
    this.repository.save(preferences, new Date().toISOString())
    return preferences
  }
}

export function defaultPreferences(): UserPreferences {
  return {
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai',
    workingDays: [1, 2, 3, 4, 5],
    dailyCapacityMinutes: 480,
    weekStartsOn: 1,
    defaultTaskMinutes: 30,
    difficultyLabels: ['轻松', '简单', '中等', '困难', '挑战'],
    defaultPriority: 'medium',
    completionConfirmation: false,
    theme: 'system',
    fontScale: 1,
    density: 'compact',
    closeBehavior: 'tray',
    automaticBackupEnabled: true,
    automaticBackupIntervalHours: 24,
    backupRetentionCount: 7
  }
}
