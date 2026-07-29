import { z } from 'zod'

export const userPreferencesSchema = z.object({
  timezone: z.string().trim().min(1).max(100),
  workingDays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  dailyCapacityMinutes: z.number().int().min(30).max(1_440),
  weekStartsOn: z.union([z.literal(0), z.literal(1)]),
  defaultTaskMinutes: z.number().int().min(5).max(1_440),
  difficultyLabels: z.tuple([
    z.string().trim().min(1).max(30),
    z.string().trim().min(1).max(30),
    z.string().trim().min(1).max(30),
    z.string().trim().min(1).max(30),
    z.string().trim().min(1).max(30)
  ]),
  defaultPriority: z.enum(['low', 'medium', 'high', 'critical']),
  completionConfirmation: z.boolean(),
  theme: z.enum(['light', 'dark', 'system']),
  fontScale: z.number().min(0.9).max(1.25),
  density: z.enum(['compact', 'comfortable']),
  closeBehavior: z.enum(['tray', 'quit']),
  automaticBackupEnabled: z.boolean(),
  automaticBackupIntervalHours: z.number().int().min(1).max(168),
  backupRetentionCount: z.number().int().min(1).max(50)
})

export type UserPreferences = z.infer<typeof userPreferencesSchema>

