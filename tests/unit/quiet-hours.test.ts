import { describe, expect, it } from 'vitest'
import { isQuietTime } from '../../src/main/modules/reminders/reminder-service'

describe('quiet hours', () => {
  it('supports quiet ranges that cross midnight', () => {
    expect(isQuietTime(new Date(2026, 6, 30, 23, 0), '22:00', '07:00')).toBe(true)
    expect(isQuietTime(new Date(2026, 6, 30, 6, 30), '22:00', '07:00')).toBe(true)
    expect(isQuietTime(new Date(2026, 6, 30, 12, 0), '22:00', '07:00')).toBe(false)
  })
})
