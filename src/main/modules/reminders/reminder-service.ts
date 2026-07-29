import type {
  NotificationSettings,
  ReminderNotice,
  UpcomingReminder
} from '../../../shared/contracts'
import { notificationSettingsSchema } from '../../../shared/contracts'
import { YouTraceError } from '../../../shared/errors'
import { ReminderRepository, type ReminderCandidate } from './reminder-repository'

const defaultSettings: NotificationSettings = notificationSettingsSchema.parse({})

export class ReminderService {
  constructor(private readonly repository: ReminderRepository) {}

  getSettings(): NotificationSettings {
    return notificationSettingsSchema.parse(this.repository.getSettings() ?? defaultSettings)
  }

  updateSettings(input: NotificationSettings): NotificationSettings {
    const settings = notificationSettingsSchema.parse(input)
    this.repository.saveSettings(settings, new Date().toISOString())
    return settings
  }

  listUpcoming(): UpcomingReminder[] {
    return this.repository.listUpcoming()
  }

  snooze(id: string, minutes: number): UpcomingReminder {
    const now = new Date()
    const scheduledAt = new Date(now.getTime() + minutes * 60_000).toISOString()
    if (!this.repository.snooze(id, scheduledAt, now.toISOString())) {
      throw new YouTraceError({
        code: 'REMINDER_NOT_FOUND',
        message: '这项提醒已处理或不存在。'
      })
    }
    const reminder = this.repository.getUpcoming(id)
    if (!reminder) {
      throw new YouTraceError({
        code: 'REMINDER_NOT_FOUND',
        message: '无法读取延后的提醒。'
      })
    }
    return reminder
  }

  dismiss(id: string): void {
    if (!this.repository.dismiss(id, new Date().toISOString())) {
      throw new YouTraceError({
        code: 'REMINDER_NOT_FOUND',
        message: '这项提醒已处理或不存在。'
      })
    }
  }

  muteSource(sourceType: string, sourceId: string): void {
    this.repository.muteSource(sourceType, sourceId, new Date().toISOString())
  }

  refreshAndProcess(nowInput: string): ReminderNotice[] {
    const now = new Date(nowInput)
    const settings = this.getSettings()
    if (!settings.enabled) return []
    this.generateCandidates(now, settings)
    if (isQuietTime(now, settings.quietStart, settings.quietEnd)) return []
    const due = this.repository.listDue(now.toISOString())
    if (due.length === 0) return []
    this.repository.markFired(due.map((event) => event.id), now.toISOString())
    if (due.length > 3) {
      return [{
        id: `summary:${now.toISOString()}`,
        title: `有 ${due.length} 项提醒`,
        body: `${due.slice(0, 3).map((event) => event.title).join('、')} 等事项需要查看。`,
        sourceType: 'summary',
        sourceId: '',
        scheduledAt: now.toISOString(),
        aggregatedCount: due.length
      }]
    }
    return due.map((event) => ({
      id: event.id,
      title: reminderTitle(event.source_type),
      body: event.title,
      sourceType: event.source_type,
      sourceId: event.source_id,
      scheduledAt: event.scheduled_at,
      aggregatedCount: 1
    }))
  }

  private generateCandidates(now: Date, settings: NotificationSettings): void {
    const nowIso = now.toISOString()
    const candidates: ReminderCandidate[] = []
    if (settings.taskDue) {
      for (const task of this.repository.listTaskCandidates()) {
        candidates.push({
          sourceType: 'task_due',
          sourceId: task.id,
          title: `任务“${task.title}”即将到期`,
          triggerAt: shiftMinutes(task.due_at, -30),
          timezone: 'UTC'
        })
      }
    }
    if (settings.timeBlocks) {
      for (const block of this.repository.listTimeBlockCandidates()) {
        candidates.push({
          sourceType: 'time_block',
          sourceId: block.id,
          title: `时间块“${block.title}”将在 10 分钟后开始`,
          triggerAt: shiftMinutes(block.starts_at, -10),
          timezone: block.timezone
        })
      }
    }
    if (settings.countdowns) {
      for (const countdown of this.repository.listCountdownCandidates()) {
        candidates.push({
          sourceType: 'countdown',
          sourceId: countdown.id,
          title: `倒计时“${countdown.title}”将在 24 小时后到达`,
          triggerAt: shiftMinutes(countdown.target_at, -1_440),
          timezone: countdown.timezone
        })
      }
    }
    if (settings.reviews) {
      for (const review of this.repository.listReviewCandidates()) {
        candidates.push({
          sourceType: 'review',
          sourceId: review.id,
          title: `今天复习：${review.title}`,
          triggerAt: `${review.scheduled_date}T01:00:00.000Z`,
          timezone: 'Asia/Shanghai'
        })
      }
    }
    if (settings.stagnation) {
      const cutoff = new Date(now.getTime() - 14 * 86_400_000).toISOString()
      for (const project of this.repository.listStaleProjects(cutoff)) {
        candidates.push({
          sourceType: 'stagnation',
          sourceId: project.id,
          title: `项目“${project.name}”已 14 天没有更新`,
          triggerAt: nowIso,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
        })
      }
    }
    if (settings.overload) {
      for (const plan of this.repository.listOverloadedPlans()) {
        candidates.push({
          sourceType: 'overload',
          sourceId: plan.id,
          title: `计划“${plan.title}”超过容量 ${plan.planned_minutes - plan.capacity_minutes} 分钟`,
          triggerAt: `${plan.start_date}T00:00:00.000Z`,
          timezone: 'UTC'
        })
      }
    }
    for (const candidate of candidates) {
      if (this.repository.isSourceMuted(candidate.sourceType, candidate.sourceId)) continue
      if (
        this.repository.sourceHasAnyTag(
          candidate.sourceType,
          candidate.sourceId,
          settings.mutedTagIds
        )
      ) {
        continue
      }
      this.repository.upsertCandidate(candidate, nowIso)
    }
  }
}

export function isQuietTime(now: Date, quietStart: string, quietEnd: string): boolean {
  const current = now.getHours() * 60 + now.getMinutes()
  const start = parseClock(quietStart)
  const end = parseClock(quietEnd)
  return start <= end ? current >= start && current < end : current >= start || current < end
}

function parseClock(value: string): number {
  const [hours = '0', minutes = '0'] = value.split(':')
  return Number(hours) * 60 + Number(minutes)
}

function shiftMinutes(value: string, minutes: number): string {
  return new Date(Date.parse(value) + minutes * 60_000).toISOString()
}

function reminderTitle(sourceType: string): string {
  const labels: Record<string, string> = {
    task_due: '任务截止提醒',
    time_block: '时间块提醒',
    countdown: '倒计时提醒',
    review: '复习提醒',
    stagnation: '项目停滞提醒',
    overload: '计划超载提醒'
  }
  return labels[sourceType] ?? '有迹提醒'
}
