import { z } from 'zod'

export const notificationSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  quietStart: z.string().regex(/^\d{2}:\d{2}$/).default('22:00'),
  quietEnd: z.string().regex(/^\d{2}:\d{2}$/).default('07:00'),
  taskDue: z.boolean().default(true),
  timeBlocks: z.boolean().default(true),
  countdowns: z.boolean().default(true),
  reviews: z.boolean().default(true),
  stagnation: z.boolean().default(true),
  overload: z.boolean().default(true)
})

export interface ReminderNotice {
  id: string
  title: string
  body: string
  sourceType: string
  sourceId: string
  scheduledAt: string
  aggregatedCount: number
}

export interface UpcomingReminder {
  id: string
  sourceType: string
  sourceId: string
  title: string
  scheduledAt: string
  status: 'pending' | 'fired' | 'dismissed'
}

export type NotificationSettings = z.infer<typeof notificationSettingsSchema>
