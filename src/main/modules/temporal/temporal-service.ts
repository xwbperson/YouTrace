import { randomUUID } from 'node:crypto'
import type {
  Countdown,
  CreateCountdownInput,
  CreatePlanInput,
  CreateTimeBlockInput,
  MoveTimeBlockInput,
  PlanPeriod,
  TimeBlock,
  TimeRangeInput
} from '../../../shared/contracts'
import { YouTraceError } from '../../../shared/errors'
import type { PlanningRepository } from '../planning/planning-repository'
import {
  mapPlan,
  mapTimeBlock,
  type CountdownRow,
  TemporalRepository
} from './temporal-repository'

export class TemporalService {
  constructor(
    private readonly repository: TemporalRepository,
    private readonly planningRepository: PlanningRepository
  ) {}

  listPlans(startDate: string, endDate: string): PlanPeriod[] {
    return this.repository
      .listPlans(startDate, endDate)
      .map((row) => mapPlan(row, this.repository.listPlanItems(row.id)))
  }

  createPlan(input: CreatePlanInput): PlanPeriod {
    if (input.endDate < input.startDate) {
      throw invalidTime('计划结束日期不能早于开始日期。')
    }
    for (const item of input.items) this.assertEntity(item.entityType, item.entityId)
    const id = randomUUID()
    this.repository.insertPlan(id, input, new Date().toISOString())
    const row = this.repository.getPlan(id)
    if (!row) throw notFound('计划')
    return mapPlan(row, this.repository.listPlanItems(id))
  }

  listTimeBlocks(input: TimeRangeInput): TimeBlock[] {
    if (Date.parse(input.end) <= Date.parse(input.start)) throw invalidTime('时间范围无效。')
    const rows = this.repository.listTimeBlocks(input.start, input.end)
    return rows.map((row) =>
      mapTimeBlock(
        row,
        rows
          .filter(
            (candidate) =>
              candidate.id !== row.id &&
              Date.parse(candidate.starts_at) < Date.parse(row.ends_at) &&
              Date.parse(candidate.ends_at) > Date.parse(row.starts_at)
          )
          .map((candidate) => candidate.id)
      )
    )
  }

  createTimeBlock(input: CreateTimeBlockInput): TimeBlock {
    this.assertTimeRange(input.startsAt, input.endsAt)
    if (input.taskId && !this.planningRepository.getTask(input.taskId)) throw notFound('任务')
    const id = randomUUID()
    this.repository.insertTimeBlock(id, input, new Date().toISOString())
    return this.requireTimeBlock(id)
  }

  moveTimeBlock(input: MoveTimeBlockInput): TimeBlock {
    this.assertTimeRange(input.startsAt, input.endsAt)
    if (!this.repository.moveTimeBlock(input.id, input.startsAt, input.endsAt, new Date().toISOString())) {
      throw notFound('时间块')
    }
    return this.requireTimeBlock(input.id)
  }

  trashTimeBlock(id: string): void {
    if (!this.repository.trashTimeBlock(id, new Date().toISOString())) throw notFound('时间块')
  }

  listCountdowns(now: string): Countdown[] {
    const nowDate = new Date(now)
    if (Number.isNaN(nowDate.getTime())) throw invalidTime('当前时间无效。')
    return this.repository.listCountdowns().map((row) => this.mapCountdown(row, nowDate))
  }

  createCountdown(input: CreateCountdownInput): Countdown {
    if (input.entityType && input.entityId) this.assertEntity(input.entityType, input.entityId)
    if ((input.entityType === null) !== (input.entityId === null)) {
      throw new YouTraceError({
        code: 'COUNTDOWN_RELATION_INCOMPLETE',
        message: '倒计时的关联类型和对象需要同时设置。'
      })
    }
    const tags = new Set(this.planningRepository.listTags().map((tag) => tag.id))
    if (input.tagIds.some((id) => !tags.has(id))) throw notFound('标签')
    const id = randomUUID()
    const now = new Date()
    this.repository.insertCountdown(id, input, now.toISOString())
    const row = this.repository.getCountdown(id)
    if (!row) throw notFound('倒计时')
    return this.mapCountdown(row, now)
  }

  private requireTimeBlock(id: string): TimeBlock {
    const row = this.repository.getTimeBlock(id)
    if (!row) throw notFound('时间块')
    const conflicts = this.repository
      .listTimeBlocks(row.starts_at, row.ends_at)
      .filter((candidate) => candidate.id !== id)
      .map((candidate) => candidate.id)
    return mapTimeBlock(row, conflicts)
  }

  private mapCountdown(row: CountdownRow, now: Date): Countdown {
    const workingDays = parseWorkingDays(row.workday_rule_json)
    const today = calendarDate(now, row.timezone)
    const targetDate = calendarDate(new Date(row.target_at), row.timezone)
    const naturalDays = Math.ceil(
      (Date.parse(`${targetDate}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000
    )
    const effectiveWorkdays = naturalDays < 0 ? 0 : countWorkdays(today, targetDate, workingDays)
    const usableDays = Math.max(0, effectiveWorkdays - row.buffer_days)
    const suggestedDailyMinutes =
      row.remaining_minutes === null || usableDays === 0
        ? null
        : Math.ceil(row.remaining_minutes / usableDays)
    const since = new Date(now.getTime() - row.recent_window_days * 86_400_000).toISOString()
    const recentDailyMinutes = this.repository.getRecentDailyMinutes(row.entity_type, row.entity_id, since)
    const expectedCompletionAt =
      row.remaining_minutes !== null && recentDailyMinutes && recentDailyMinutes > 0
        ? addCalendarDays(today, Math.ceil(row.remaining_minutes / recentDailyMinutes))
        : null
    const { risk, reason } = calculateRisk(
      naturalDays,
      usableDays,
      row.remaining_minutes,
      suggestedDailyMinutes,
      recentDailyMinutes
    )
    return {
      id: row.id,
      title: row.title,
      targetAt: row.target_at,
      timezone: row.timezone,
      workingDays,
      bufferDays: row.buffer_days,
      importance: row.importance,
      entityType: row.entity_type,
      entityId: row.entity_id,
      remainingMinutes: row.remaining_minutes,
      naturalDays,
      effectiveWorkdays,
      suggestedDailyMinutes,
      recentDailyMinutes: recentDailyMinutes === null ? null : Math.round(recentDailyMinutes),
      expectedCompletionAt,
      risk,
      riskReason: reason,
      tagIds: row.tag_ids ? row.tag_ids.split(',') : [],
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }

  private assertTimeRange(startsAt: string, endsAt: string): void {
    if (Date.parse(endsAt) <= Date.parse(startsAt)) {
      throw invalidTime('时间块结束时间必须晚于开始时间。')
    }
  }

  private assertEntity(entityType: string, entityId: string): void {
    const found =
      entityType === 'project'
        ? this.planningRepository.getProject(entityId)
        : entityType === 'goal'
          ? this.planningRepository.getGoal(entityId)
          : entityType === 'milestone'
            ? this.planningRepository.getMilestone(entityId)
            : entityType === 'task'
              ? this.planningRepository.getTask(entityId)
              : entityType === 'habit' || entityType === 'metric' || entityType === 'external'
                ? true
                : false
    if (!found) throw notFound('关联对象')
  }
}

export function calculateRisk(
  naturalDays: number,
  usableDays: number,
  remainingMinutes: number | null,
  suggestedDailyMinutes: number | null,
  recentDailyMinutes: number | null
): { risk: Countdown['risk']; reason: string } {
  if (naturalDays < 0) return { risk: 'overdue', reason: `目标时间已过去 ${Math.abs(naturalDays)} 天。` }
  if (naturalDays === 0) return { risk: 'danger', reason: '目标时间就在今天。' }
  if (remainingMinutes === null) {
    if (naturalDays <= 2) return { risk: 'danger', reason: '期限临近，但没有剩余工作量数据。' }
    if (naturalDays <= 7) return { risk: 'attention', reason: '期限在一周内，建议补充剩余工作量。' }
    return { risk: 'normal', reason: '期限尚有余量；缺少工作量时不预测完成日期。' }
  }
  if (usableDays === 0 && remainingMinutes > 0) {
    return { risk: 'danger', reason: '扣除缓冲后没有可用工作日。' }
  }
  if (recentDailyMinutes === null) {
    return {
      risk: naturalDays <= 7 ? 'attention' : 'normal',
      reason: `每天建议投入 ${suggestedDailyMinutes ?? 0} 分钟；历史速度数据不足。`
    }
  }
  if ((suggestedDailyMinutes ?? 0) > recentDailyMinutes * 1.25) {
    return { risk: 'danger', reason: '所需速度明显高于近期实际速度。' }
  }
  if ((suggestedDailyMinutes ?? 0) > recentDailyMinutes) {
    return { risk: 'attention', reason: '所需速度略高于近期实际速度。' }
  }
  return { risk: 'normal', reason: '近期实际速度可以覆盖所需速度。' }
}

function calendarDate(date: Date, timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(date)
    const value = Object.fromEntries(parts.map((part) => [part.type, part.value]))
    return `${value['year']}-${value['month']}-${value['day']}`
  } catch {
    throw new YouTraceError({ code: 'INVALID_TIMEZONE', message: '工作区时区无效。' })
  }
}

function countWorkdays(startDate: string, endDate: string, workingDays: number[]): number {
  const allowed = new Set(workingDays)
  const cursor = new Date(`${startDate}T12:00:00Z`)
  const end = new Date(`${endDate}T12:00:00Z`)
  let count = 0
  while (cursor < end) {
    cursor.setUTCDate(cursor.getUTCDate() + 1)
    if (allowed.has(cursor.getUTCDay())) count += 1
  }
  return count
}

function addCalendarDays(startDate: string, days: number): string {
  const date = new Date(`${startDate}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function parseWorkingDays(value: string): number[] {
  try {
    const parsed = JSON.parse(value) as { workingDays?: unknown }
    return Array.isArray(parsed.workingDays) ? (parsed.workingDays as number[]) : [1, 2, 3, 4, 5]
  } catch {
    return [1, 2, 3, 4, 5]
  }
}

function notFound(label: string): YouTraceError {
  return new YouTraceError({ code: 'ENTITY_NOT_FOUND', message: `${label}不存在或已进入回收站。` })
}

function invalidTime(message: string): YouTraceError {
  return new YouTraceError({ code: 'INVALID_TIME_RANGE', message })
}
