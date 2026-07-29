import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import { dialog, ipcMain, shell } from 'electron'
import { z } from 'zod'
import {
  addTaskDependencyInputSchema,
  assignTagInputSchema,
  convertMemoToTaskInputSchema,
  createGoalInputSchema,
  createEvidenceInputSchema,
  createManualEffortInputSchema,
  createMemoInputSchema,
  createMilestoneInputSchema,
  createCourseInputSchema,
  createHabitInputSchema,
  createKnowledgeInputSchema,
  createMetricInputSchema,
  createMistakeInputSchema,
  createProjectInputSchema,
  createTagInputSchema,
  createTaskInputSchema,
  createCountdownInputSchema,
  createPlanInputSchema,
  createTimeBlockInputSchema,
  createWorkspaceInputSchema,
  effortListInputSchema,
  openWorkspaceInputSchema,
  moveTimeBlockInputSchema,
  recordHabitInputSchema,
  recordMetricInputSchema,
  searchInputSchema,
  startEffortInputSchema,
  stopEffortInputSchema,
  taskListInputSchema,
  timeRangeInputSchema,
  updateEvidenceStatusInputSchema,
  updateGoalInputSchema,
  updateMilestoneInputSchema,
  updateProjectInputSchema,
  updateTaskInputSchema,
  type AppBootstrapState,
  type IpcResult,
  type WindowState
} from '../../shared/contracts'
import { toAppError, YouTraceError } from '../../shared/errors'
import type { WorkspaceManager } from '../workspace/workspace-manager'
import type { PlanningService } from '../modules/planning/planning-service'
import type { ExecutionService } from '../modules/execution/execution-service'
import type { PracticeService } from '../modules/practice/practice-service'
import type { TemporalService } from '../modules/temporal/temporal-service'

interface RegisterIpcOptions {
  getWindow: () => BrowserWindow | null
  workspaceManager: WorkspaceManager
  planningService: PlanningService
  executionService: ExecutionService
  practiceService: PracticeService
  temporalService: TemporalService
  getBootstrapState: () => AppBootstrapState
  setBootstrapState: (state: AppBootstrapState) => void
}

export function registerIpc(options: RegisterIpcOptions): void {
  const {
    getWindow,
    workspaceManager,
    planningService,
    executionService,
    practiceService,
    temporalService,
    getBootstrapState,
    setBootstrapState
  } = options

  const trusted = (event: IpcMainInvokeEvent): BrowserWindow => {
    const window = getWindow()
    if (!window || event.sender.id !== window.webContents.id) {
      throw new YouTraceError({
        code: 'IPC_SENDER_REJECTED',
        message: '请求不是来自当前有迹窗口。'
      })
    }
    return window
  }

  const wrap = async <T>(operation: () => T | Promise<T>): Promise<IpcResult<T>> => {
    try {
      return { ok: true, data: await operation() }
    } catch (error) {
      if (error instanceof z.ZodError) {
        return {
          ok: false,
          error: {
            code: 'INVALID_INPUT',
            message: '输入内容不完整或格式不正确。',
            details: { issues: error.issues.map((issue) => issue.path.join('.')) }
          }
        }
      }
      return { ok: false, error: toAppError(error) }
    }
  }

  ipcMain.handle('app:get-bootstrap-state', (event) =>
    wrap(() => {
      trusted(event)
      return getBootstrapState()
    })
  )

  ipcMain.handle('dialog:select-directory', (event) =>
    wrap(async () => {
      const window = trusted(event)
      const result = await dialog.showOpenDialog(window, {
        title: '选择有迹工作区文件夹',
        properties: ['openDirectory', 'createDirectory', 'promptToCreate'],
        buttonLabel: '选择此文件夹'
      })
      return result.canceled ? null : (result.filePaths[0] ?? null)
    })
  )

  ipcMain.handle('workspace:create', (event, rawInput) =>
    wrap(async () => {
      trusted(event)
      const input = createWorkspaceInputSchema.parse(rawInput)
      const workspace = await workspaceManager.create(input.rootPath, input.name)
      setBootstrapState({ status: 'ready', workspace })
      return workspace
    })
  )

  ipcMain.handle('workspace:open', (event, rawInput) =>
    wrap(async () => {
      trusted(event)
      const input = openWorkspaceInputSchema.parse(rawInput)
      const workspace = await workspaceManager.open(input.rootPath, input.readOnly)
      setBootstrapState({ status: 'ready', workspace })
      return workspace
    })
  )

  ipcMain.handle('workspace:reveal', (event) =>
    wrap(async () => {
      trusted(event)
      const error = await shell.openPath(workspaceManager.getCurrentPath())
      if (error) {
        throw new YouTraceError({
          code: 'WORKSPACE_REVEAL_FAILED',
          message: '无法在资源管理器中打开当前工作区。',
          details: { reason: error }
        })
      }
    })
  )

  ipcMain.handle('planning:list-projects', (event) =>
    wrap(() => {
      trusted(event)
      return planningService.listProjects()
    })
  )

  ipcMain.handle('planning:create-project', (event, rawInput) =>
    wrap(() => {
      trusted(event)
      return planningService.createProject(createProjectInputSchema.parse(rawInput))
    })
  )

  ipcMain.handle('planning:update-project', (event, rawInput) =>
    wrap(() => {
      trusted(event)
      return planningService.updateProject(updateProjectInputSchema.parse(rawInput))
    })
  )

  ipcMain.handle('planning:trash-project', (event, rawId) =>
    wrap(() => {
      trusted(event)
      planningService.trashProject(z.string().uuid().parse(rawId))
    })
  )

  ipcMain.handle('planning:list-goals', (event, rawProjectId) =>
    wrap(() => {
      trusted(event)
      const projectId = z.string().uuid().nullable().parse(rawProjectId)
      return planningService.listGoals(projectId)
    })
  )

  ipcMain.handle('planning:create-goal', (event, rawInput) =>
    wrap(() => {
      trusted(event)
      return planningService.createGoal(createGoalInputSchema.parse(rawInput))
    })
  )

  ipcMain.handle('planning:update-goal', (event, rawInput) =>
    wrap(() => {
      trusted(event)
      return planningService.updateGoal(updateGoalInputSchema.parse(rawInput))
    })
  )

  ipcMain.handle('planning:list-milestones', (event, rawProjectId) =>
    wrap(() => {
      trusted(event)
      return planningService.listMilestones(z.string().uuid().parse(rawProjectId))
    })
  )

  ipcMain.handle('planning:create-milestone', (event, rawInput) =>
    wrap(() => {
      trusted(event)
      return planningService.createMilestone(createMilestoneInputSchema.parse(rawInput))
    })
  )

  ipcMain.handle('planning:update-milestone', (event, rawInput) =>
    wrap(() => {
      trusted(event)
      return planningService.updateMilestone(updateMilestoneInputSchema.parse(rawInput))
    })
  )

  ipcMain.handle('planning:list-tasks', (event, rawInput) =>
    wrap(() => {
      trusted(event)
      return planningService.listTasks(taskListInputSchema.parse(rawInput))
    })
  )

  ipcMain.handle('planning:create-task', (event, rawInput) =>
    wrap(() => {
      trusted(event)
      return planningService.createTask(createTaskInputSchema.parse(rawInput))
    })
  )

  ipcMain.handle('planning:update-task', (event, rawInput) =>
    wrap(() => {
      trusted(event)
      return planningService.updateTask(updateTaskInputSchema.parse(rawInput))
    })
  )

  ipcMain.handle('planning:trash-task', (event, rawId) =>
    wrap(() => {
      trusted(event)
      planningService.trashTask(z.string().uuid().parse(rawId))
    })
  )

  ipcMain.handle('planning:add-task-dependency', (event, rawInput) =>
    wrap(() => {
      trusted(event)
      planningService.addTaskDependency(addTaskDependencyInputSchema.parse(rawInput))
    })
  )

  ipcMain.handle('planning:list-task-dependencies', (event, rawTaskId) =>
    wrap(() => {
      trusted(event)
      return planningService.listTaskDependencies(z.string().uuid().parse(rawTaskId))
    })
  )

  ipcMain.handle('planning:list-tags', (event) =>
    wrap(() => {
      trusted(event)
      return planningService.listTags()
    })
  )

  ipcMain.handle('planning:create-tag', (event, rawInput) =>
    wrap(() => {
      trusted(event)
      return planningService.createTag(createTagInputSchema.parse(rawInput))
    })
  )

  ipcMain.handle('planning:assign-tag', (event, rawInput) =>
    wrap(() => {
      trusted(event)
      planningService.assignTag(assignTagInputSchema.parse(rawInput))
    })
  )

  ipcMain.handle('planning:search', (event, rawInput) =>
    wrap(() => {
      trusted(event)
      return planningService.search(searchInputSchema.parse(rawInput))
    })
  )

  ipcMain.handle('execution:get-active-effort', (event) =>
    wrap(() => {
      trusted(event)
      return executionService.getActiveEffort()
    })
  )

  ipcMain.handle('execution:start-effort', (event, rawInput) =>
    wrap(() => {
      trusted(event)
      return executionService.startEffort(startEffortInputSchema.parse(rawInput))
    })
  )

  ipcMain.handle('execution:stop-effort', (event, rawInput) =>
    wrap(() => {
      trusted(event)
      return executionService.stopEffort(stopEffortInputSchema.parse(rawInput))
    })
  )

  ipcMain.handle('execution:create-manual-effort', (event, rawInput) =>
    wrap(() => {
      trusted(event)
      return executionService.createManualEffort(createManualEffortInputSchema.parse(rawInput))
    })
  )

  ipcMain.handle('execution:list-efforts', (event, rawInput) =>
    wrap(() => {
      trusted(event)
      return executionService.listEfforts(effortListInputSchema.parse(rawInput))
    })
  )

  ipcMain.handle('execution:create-evidence', (event, rawInput) =>
    wrap(() => {
      trusted(event)
      return executionService.createEvidence(createEvidenceInputSchema.parse(rawInput))
    })
  )

  ipcMain.handle('execution:list-evidence', (event, rawEntityType, rawEntityId) =>
    wrap(() => {
      trusted(event)
      const entityType = z.string().max(60).nullable().parse(rawEntityType)
      const entityId = z.string().uuid().nullable().parse(rawEntityId)
      return executionService.listEvidence(entityType, entityId)
    })
  )

  ipcMain.handle('execution:update-evidence-status', (event, rawInput) =>
    wrap(() => {
      trusted(event)
      return executionService.updateEvidenceStatus(updateEvidenceStatusInputSchema.parse(rawInput))
    })
  )

  ipcMain.handle('execution:create-memo', (event, rawInput) =>
    wrap(() => {
      trusted(event)
      return executionService.createMemo(createMemoInputSchema.parse(rawInput))
    })
  )

  ipcMain.handle('execution:list-memos', (event, rawInboxOnly) =>
    wrap(() => {
      trusted(event)
      return executionService.listMemos(z.boolean().parse(rawInboxOnly))
    })
  )

  ipcMain.handle('execution:convert-memo-to-task', (event, rawInput) =>
    wrap(() => {
      trusted(event)
      return executionService.convertMemoToTask(convertMemoToTaskInputSchema.parse(rawInput))
    })
  )

  ipcMain.handle('practice:list-habits', (event, rawProjectId, rawDate) =>
    wrap(() => {
      trusted(event)
      const projectId = z.string().uuid().nullable().parse(rawProjectId)
      const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(rawDate)
      return practiceService.listHabits(projectId, date)
    })
  )

  ipcMain.handle('practice:create-habit', (event, rawInput) =>
    wrap(() => {
      trusted(event)
      return practiceService.createHabit(createHabitInputSchema.parse(rawInput))
    })
  )

  ipcMain.handle('practice:record-habit', (event, rawInput) =>
    wrap(() => {
      trusted(event)
      return practiceService.recordHabit(recordHabitInputSchema.parse(rawInput))
    })
  )

  ipcMain.handle('practice:list-metrics', (event, rawProjectId) =>
    wrap(() => {
      trusted(event)
      return practiceService.listMetrics(z.string().uuid().nullable().parse(rawProjectId))
    })
  )

  ipcMain.handle('practice:create-metric', (event, rawInput) =>
    wrap(() => {
      trusted(event)
      return practiceService.createMetric(createMetricInputSchema.parse(rawInput))
    })
  )

  ipcMain.handle('practice:record-metric', (event, rawInput) =>
    wrap(() => {
      trusted(event)
      return practiceService.recordMetric(recordMetricInputSchema.parse(rawInput))
    })
  )

  ipcMain.handle('practice:list-courses', (event) =>
    wrap(() => {
      trusted(event)
      return practiceService.listCourses()
    })
  )

  ipcMain.handle('practice:create-course', (event, rawInput) =>
    wrap(() => {
      trusted(event)
      return practiceService.createCourse(createCourseInputSchema.parse(rawInput))
    })
  )

  ipcMain.handle('practice:list-knowledge', (event, rawProjectId) =>
    wrap(() => {
      trusted(event)
      return practiceService.listKnowledge(z.string().uuid().parse(rawProjectId))
    })
  )

  ipcMain.handle('practice:create-knowledge', (event, rawInput) =>
    wrap(() => {
      trusted(event)
      return practiceService.createKnowledge(createKnowledgeInputSchema.parse(rawInput))
    })
  )

  ipcMain.handle('practice:list-mistakes', (event, rawProjectId) =>
    wrap(() => {
      trusted(event)
      return practiceService.listMistakes(z.string().uuid().parse(rawProjectId))
    })
  )

  ipcMain.handle('practice:create-mistake', (event, rawInput) =>
    wrap(() => {
      trusted(event)
      return practiceService.createMistake(createMistakeInputSchema.parse(rawInput))
    })
  )

  ipcMain.handle('temporal:list-plans', (event, rawStartDate, rawEndDate) =>
    wrap(() => {
      trusted(event)
      const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
      return temporalService.listPlans(date.parse(rawStartDate), date.parse(rawEndDate))
    })
  )

  ipcMain.handle('temporal:create-plan', (event, rawInput) =>
    wrap(() => {
      trusted(event)
      return temporalService.createPlan(createPlanInputSchema.parse(rawInput))
    })
  )

  ipcMain.handle('temporal:list-time-blocks', (event, rawInput) =>
    wrap(() => {
      trusted(event)
      return temporalService.listTimeBlocks(timeRangeInputSchema.parse(rawInput))
    })
  )

  ipcMain.handle('temporal:create-time-block', (event, rawInput) =>
    wrap(() => {
      trusted(event)
      return temporalService.createTimeBlock(createTimeBlockInputSchema.parse(rawInput))
    })
  )

  ipcMain.handle('temporal:move-time-block', (event, rawInput) =>
    wrap(() => {
      trusted(event)
      return temporalService.moveTimeBlock(moveTimeBlockInputSchema.parse(rawInput))
    })
  )

  ipcMain.handle('temporal:trash-time-block', (event, rawId) =>
    wrap(() => {
      trusted(event)
      temporalService.trashTimeBlock(z.string().uuid().parse(rawId))
    })
  )

  ipcMain.handle('temporal:list-countdowns', (event, rawNow) =>
    wrap(() => {
      trusted(event)
      return temporalService.listCountdowns(z.string().datetime().parse(rawNow))
    })
  )

  ipcMain.handle('temporal:create-countdown', (event, rawInput) =>
    wrap(() => {
      trusted(event)
      return temporalService.createCountdown(createCountdownInputSchema.parse(rawInput))
    })
  )

  ipcMain.handle('window:minimize', (event) =>
    wrap(() => {
      trusted(event).minimize()
    })
  )

  ipcMain.handle('window:toggle-maximize', (event) =>
    wrap(() => {
      const window = trusted(event)
      if (window.isMaximized()) window.unmaximize()
      else window.maximize()
      return windowState(window)
    })
  )

  ipcMain.handle('window:close', (event) =>
    wrap(() => {
      trusted(event).close()
    })
  )

  ipcMain.handle('window:get-state', (event) =>
    wrap(() => {
      return windowState(trusted(event))
    })
  )
}

export function windowState(window: BrowserWindow): WindowState {
  return {
    maximized: window.isMaximized(),
    focused: window.isFocused()
  }
}
