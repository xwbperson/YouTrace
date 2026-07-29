import { describe, expect, it } from 'vitest'
import { calculateRisk } from '../../src/main/modules/temporal/temporal-service'

describe('countdown risk', () => {
  it('does not invent a completion forecast without actual speed data', () => {
    expect(calculateRisk(20, 14, 840, 60, null)).toEqual({
      risk: 'normal',
      reason: '每天建议投入 60 分钟；历史速度数据不足。'
    })
  })

  it('marks overdue and unsustainable countdowns explicitly', () => {
    expect(calculateRisk(-2, 0, 120, null, null).risk).toBe('overdue')
    expect(calculateRisk(10, 6, 900, 150, 60).risk).toBe('danger')
  })
})
