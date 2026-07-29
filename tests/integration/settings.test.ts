import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SettingsRepository } from '../../src/main/modules/settings/settings-repository'
import {
  defaultPreferences,
  SettingsService
} from '../../src/main/modules/settings/settings-service'
import { WorkspaceManager } from '../../src/main/workspace/workspace-manager'

let workspaceManager: WorkspaceManager
let settings: SettingsService

beforeEach(async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'youtrace-settings-test-'))
  workspaceManager = new WorkspaceManager(join(fixtureRoot, 'app-data'))
  await workspaceManager.create(join(fixtureRoot, 'workspace'), '设置测试')
  settings = new SettingsService(
    new SettingsRepository(() => workspaceManager.getDatabase())
  )
})

afterEach(async () => {
  await workspaceManager.close()
})

describe('workspace preferences', () => {
  it('returns useful defaults and persists a validated workspace-specific update', () => {
    expect(settings.getPreferences()).toEqual(defaultPreferences())

    const updated = settings.updatePreferences({
      ...settings.getPreferences(),
      workingDays: [1, 2, 3, 4, 5, 6],
      dailyCapacityMinutes: 420,
      difficultyLabels: ['入门', '轻量', '标准', '深入', '攻坚'],
      theme: 'dark',
      fontScale: 1.1,
      density: 'comfortable',
      closeBehavior: 'quit',
      automaticBackupIntervalHours: 12,
      backupRetentionCount: 5
    })

    expect(settings.getPreferences()).toEqual(updated)
    expect(settings.getPreferences()).toMatchObject({
      dailyCapacityMinutes: 420,
      difficultyLabels: ['入门', '轻量', '标准', '深入', '攻坚'],
      theme: 'dark',
      closeBehavior: 'quit',
      automaticBackupIntervalHours: 12,
      backupRetentionCount: 5
    })
  })

  it('rejects invalid capacity and empty working-day settings', () => {
    expect(() =>
      settings.updatePreferences({
        ...settings.getPreferences(),
        dailyCapacityMinutes: 0
      })
    ).toThrow()
    expect(() =>
      settings.updatePreferences({
        ...settings.getPreferences(),
        workingDays: []
      })
    ).toThrow()
  })
})
