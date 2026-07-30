import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import {
  interruptedEffortRecoveryActionSchema,
  interruptedEffortRecoverySchema,
  type EffortEntry,
  type InterruptedEffortRecovery,
  type InterruptedEffortRecoveryAction
} from '../../../shared/contracts'
import { YouTraceError } from '../../../shared/errors'
import type { WorkspaceManager } from '../../workspace/workspace-manager'
import type { ExecutionService } from './execution-service'

const heartbeatSchema = z.object({
  workspaceId: z.string().uuid(),
  effortId: z.string().uuid(),
  heartbeatAt: z.string().datetime()
})

export class EffortRecoveryService {
  constructor(
    private readonly workspaceManager: WorkspaceManager,
    private readonly executionService: ExecutionService
  ) {}

  async recordHeartbeat(now = new Date().toISOString()): Promise<void> {
    const workspace = this.workspaceManager.getCurrent()
    if (!workspace) return
    const active = this.executionService.getActiveEffort()
    const path = this.heartbeatPath(workspace.path)
    if (!active || active.suspendedAt) {
      await removeIfPresent(path)
      return
    }
    await writeJsonAtomic(path, {
      workspaceId: workspace.id,
      effortId: active.id,
      heartbeatAt: now
    })
  }

  async recoverInterruptedEffort(
    detectedAt = new Date().toISOString()
  ): Promise<InterruptedEffortRecovery | null> {
    const existing = await this.getPendingRecovery()
    const active = this.executionService.getActiveEffort()
    if (existing) {
      if (active?.id === existing.effortId) return existing
      await this.clearPendingRecovery()
    }
    if (!active || active.suspendedAt) {
      await this.clearHeartbeat()
      return null
    }

    const workspace = this.workspaceManager.getCurrent()
    if (!workspace) return null
    const heartbeat = await this.readHeartbeat()
    const heartbeatAt =
      heartbeat?.workspaceId === workspace.id &&
      heartbeat.effortId === active.id &&
      Date.parse(heartbeat.heartbeatAt) >= Date.parse(active.startedAt) &&
      Date.parse(heartbeat.heartbeatAt) <= Date.parse(detectedAt)
        ? heartbeat.heartbeatAt
        : active.startedAt
    this.executionService.suspendEffortAt(active.id, heartbeatAt)
    const recovery = interruptedEffortRecoverySchema.parse({
      workspaceId: workspace.id,
      effortId: active.id,
      entityTitle: active.entityTitle,
      startedAt: active.startedAt,
      lastHeartbeatAt: heartbeatAt,
      detectedAt
    })
    await writeJsonAtomic(this.recoveryPath(workspace.path), recovery)
    await this.clearHeartbeat()
    return recovery
  }

  async getPendingRecovery(): Promise<InterruptedEffortRecovery | null> {
    const workspace = this.workspaceManager.getCurrent()
    if (!workspace) return null
    try {
      const recovery = interruptedEffortRecoverySchema.parse(
        JSON.parse(await readFile(this.recoveryPath(workspace.path), 'utf8'))
      )
      return recovery.workspaceId === workspace.id ? recovery : null
    } catch (error) {
      if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') return null
      if (error instanceof SyntaxError || error instanceof z.ZodError) return null
      throw error
    }
  }

  async resolvePendingRecovery(
    input: InterruptedEffortRecoveryAction
  ): Promise<EffortEntry> {
    const action = interruptedEffortRecoveryActionSchema.parse(input)
    const recovery = await this.getPendingRecovery()
    const active = this.executionService.getActiveEffort()
    if (!recovery || !active || active.id !== recovery.effortId) {
      throw new YouTraceError({
        code: 'EFFORT_RECOVERY_NOT_FOUND',
        message: '当前没有等待确认的中断计时。'
      })
    }

    let result: EffortEntry
    if (action.action === 'resume') {
      result = this.executionService.resumeEffort(active.id)
    } else if (action.action === 'retain') {
      result = active
    } else {
      const endedAt = Date.parse(action.endedAt)
      if (
        endedAt < Date.parse(recovery.startedAt) ||
        endedAt > Date.parse(recovery.detectedAt)
      ) {
        throw new YouTraceError({
          code: 'EFFORT_RECOVERY_END_TIME_INVALID',
          message: '确认的结束时间必须在计时开始与本次启动检测之间。'
        })
      }
      this.executionService.closeOpenSuspensionAt(active.id, action.endedAt)
      result = this.executionService.stopEffortAt(
        {
          id: active.id,
          result: '异常中断后确认停止',
          interruptions: '',
          obstacles: '',
          nextStep: '',
          energy: null,
          perceivedDifficulty: null
        },
        action.endedAt
      )
    }
    await this.clearPendingRecovery()
    return result
  }

  private async readHeartbeat(): Promise<z.infer<typeof heartbeatSchema> | null> {
    const workspace = this.workspaceManager.getCurrent()
    if (!workspace) return null
    try {
      return heartbeatSchema.parse(
        JSON.parse(await readFile(this.heartbeatPath(workspace.path), 'utf8'))
      )
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException | null)?.code === 'ENOENT' ||
        error instanceof SyntaxError ||
        error instanceof z.ZodError
      ) {
        return null
      }
      throw error
    }
  }

  private async clearHeartbeat(): Promise<void> {
    const workspace = this.workspaceManager.getCurrent()
    if (workspace) await removeIfPresent(this.heartbeatPath(workspace.path))
  }

  private async clearPendingRecovery(): Promise<void> {
    const workspace = this.workspaceManager.getCurrent()
    if (workspace) await removeIfPresent(this.recoveryPath(workspace.path))
  }

  private heartbeatPath(workspacePath: string): string {
    return join(workspacePath, 'recovery', 'active-effort-heartbeat.json')
  }

  private recoveryPath(workspacePath: string): string {
    return join(workspacePath, 'recovery', 'interrupted-effort.json')
  }
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporaryPath = `${path}.tmp-${randomUUID()}`
  await writeFile(temporaryPath, JSON.stringify(value, null, 2), 'utf8')
  await rename(temporaryPath, path)
}

async function removeIfPresent(path: string): Promise<void> {
  await unlink(path).catch((error) => {
    if ((error as NodeJS.ErrnoException | null)?.code !== 'ENOENT') throw error
  })
}
