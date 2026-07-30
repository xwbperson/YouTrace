import type { BrowserWindow, IpcMainEvent, IpcMainInvokeEvent } from 'electron'
import { dialog, ipcMain, shell } from 'electron'
import { z } from 'zod'
import {
  addTaskDependencyInputSchema,
  applyReviewAdjustmentsInputSchema,
  assignTagInputSchema,
  createAreaInputSchema,
  createChecklistItemInputSchema,
  convertMemoToTaskInputSchema,
  convertMemoToLearningInputSchema,
  correctEffortInputSchema,
  createGoalInputSchema,
  createEvidenceInputSchema,
  createManualEffortInputSchema,
  createMemoInputSchema,
  createMilestoneInputSchema,
  createCourseInputSchema,
  createHabitInputSchema,
  createKnowledgeInputSchema,
  createLearningTestInputSchema,
  createMetricInputSchema,
  createMistakeInputSchema,
  createProjectInputSchema,
  createTagInputSchema,
  createTaskInputSchema,
  createCountdownInputSchema,
  createPlanInputSchema,
  createTimeBlockInputSchema,
  createWorkspaceInputSchema,
  createReviewInputSchema,
  effortListInputSchema,
  openWorkspaceInputSchema,
  notificationSettingsSchema,
  importEvidenceFileInputSchema,
  mergeTagsInputSchema,
  migrateWorkspaceInputSchema,
  restoreBackupInputSchema,
  trashActionInputSchema,
  moveTimeBlockInputSchema,
  recordHabitInputSchema,
  recordMetricInputSchema,
  recordReviewResultInputSchema,
  searchInputSchema,
  saveViewInputSchema,
  setChecklistProgressInputSchema,
  setTaskRecurrenceInputSchema,
  previewTemplateInputSchema,
  saveProjectTemplateInputSchema,
  startEffortInputSchema,
  stopEffortInputSchema,
  taskListInputSchema,
  timeRangeInputSchema,
  updateEvidenceStatusInputSchema,
  updateAreaInputSchema,
  updateChecklistItemInputSchema,
  updateGoalInputSchema,
  updateMilestoneInputSchema,
  updateProjectInputSchema,
  updateTaskInputSchema,
  updateReviewInputSchema,
  userPreferencesSchema,
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
import type { WorkflowService } from '../modules/workflow/workflow-service'
import type { ReminderService } from '../modules/reminders/reminder-service'
import type { DataService } from '../modules/data/data-service'
import type { SettingsService } from '../modules/settings/settings-service'

interface RegisterIpcOptions {
  getWindow: () => BrowserWindow | null
  workspaceManager: WorkspaceManager
  planningService: PlanningService
  executionService: ExecutionService
  practiceService: PracticeService
  temporalService: TemporalService
  workflowService: WorkflowService
  reminderService: ReminderService
  dataService: DataService
  settingsService: SettingsService
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
    workflowService,
    reminderService,
    dataService,
    settingsService,
    getBootstrapState,
    setBootstrapState
  } = options

  const trusted = (event: IpcMainInvokeEvent | IpcMainEvent): BrowserWindow => {
    const window = getWindow()
    if (!window || event.sender.id !== window.webContents.id) {
      throw new YouTraceError({
        code: 'IPC_SENDER_REJECTED',
        message: '请求不是来自当前有迹窗口。'
      })
    }
    return window
  }
  const resizeEdgeSchema = z.enum([
    'north',
    'south',
    'east',
    'west',
    'north-east',
    'north-west',
    'south-east',
    'south-west'
  ])
  let resizeSession: {
    edge: z.infer<typeof resizeEdgeSchema>
    screenX: number
    screenY: number
    bounds: Electron.Rectangle
  } | null = null

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

  ipcMain.handle('workspace:reconnect', (event, rawInput) =>
    wrap(async () => {
      trusted(event)
      const input = openWorkspaceInputSchema
        .pick({ rootPath: true })
        .parse(rawInput)
      const workspace = await workspaceManager.reconnect(input.rootPath)
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

  ipcMain.handle('planning:list-areas', (event, rawIncludeArchived) =>
    wrap(() => {
      trusted(event)
      return planningService.listAreas(z.boolean().optional().default(false).parse(rawIncludeArchived))
    })
  )

  ipcMain.handle('planning:create-area', (event, rawInput) =>
    wrap(() => {
      trusted(event)
      return planningService.createArea(createAreaInputSchema.parse(rawInput))
    })
  )

  ipcMain.handle('planning:update-area', (event, rawInput) =>
    wrap(() => {
      trusted(event)
      return planningService.updateArea(updateAreaInputSchema.parse(rawInput))
    })
  )

  ipcMain.handle('planning:list-projects', (event, rawIncludeArchived) =>
    wrap(() => {
      trusted(event)
      return planningService.listProjects(
        z.boolean().optional().default(false).parse(rawIncludeArchived)
      )
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

  ipcMain.handle('planning:list-project-history', (event, rawProjectId) =>
    wrap(() => {
      trusted(event)
      return planningService.listProjectHistory(z.string().uuid().parse(rawProjectId))
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

  ipcMain.handle('planning:list-checklist', (event, rawTaskId) =>
    wrap(() => {
      trusted(event)
      return planningService.listChecklist(z.string().uuid().parse(rawTaskId))
    })
  )

  ipcMain.handle('planning:create-checklist-item', (event, rawInput) =>
    wrap(() => {
      trusted(event)
      return planningService.createChecklistItem(createChecklistItemInputSchema.parse(rawInput))
    })
  )

  ipcMain.handle('planning:update-checklist-item', (event, rawInput) =>
    wrap(() => {
      trusted(event)
      return planningService.updateChecklistItem(updateChecklistItemInputSchema.parse(rawInput))
    })
  )

  ipcMain.handle('planning:delete-checklist-item', (event, rawId) =>
    wrap(() => {
      trusted(event)
      planningService.deleteChecklistItem(z.string().uuid().parse(rawId))
    })
  )

  ipcMain.handle('planning:set-checklist-progress', (event, rawInput) =>
    wrap(() => {
      trusted(event)
      return planningService.setChecklistProgress(setChecklistProgressInputSchema.parse(rawInput))
    })
  )

  ipcMain.handle('planning:get-task-recurrence', (event, rawTaskId) =>
    wrap(() => {
      trusted(event)
      return planningService.getTaskRecurrence(z.string().uuid().parse(rawTaskId))
    })
  )

  ipcMain.handle('planning:set-task-recurrence', (event, rawInput) =>
    wrap(() => {
      trusted(event)
      return planningService.setTaskRecurrence(setTaskRecurrenceInputSchema.parse(rawInput))
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

  ipcMain.handle('planning:get-tag-stats', (event, rawId) =>
    wrap(() => {
      trusted(event)
      return planningService.getTagStats(z.string().uuid().parse(rawId))
    })
  )

  ipcMain.handle('planning:merge-tags', (event, rawInput) =>
    wrap(() => {
      trusted(event)
      return planningService.mergeTags(mergeTagsInputSchema.parse(rawInput))
    })
  )

  ipcMain.handle('planning:search', (event, rawInput) =>
    wrap(() => {
      trusted(event)
      return planningService.search(searchInputSchema.parse(rawInput))
    })
  )

  ipcMain.handle('planning:list-saved-views', (event) =>
    wrap(() => {
      trusted(event)
      return planningService.listSavedViews()
    })
  )

  ipcMain.handle('planning:save-view', (event, rawInput) =>
    wrap(() => {
      trusted(event)
      return planningService.saveView(saveViewInputSchema.parse(rawInput))
    })
  )

  ipcMain.handle('planning:delete-saved-view', (event, rawId) =>
    wrap(() => {
      trusted(event)
      planningService.deleteSavedView(z.string().uuid().parse(rawId))
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

  ipcMain.handle('execution:suspend-effort', (event, rawId) =>
    wrap(() => {
      trusted(event)
      return executionService.suspendEffort(z.string().uuid().parse(rawId))
    })
  )

  ipcMain.handle('execution:resume-effort', (event, rawId) =>
    wrap(() => {
      trusted(event)
      return executionService.resumeEffort(z.string().uuid().parse(rawId))
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

  ipcMain.handle('execution:summarize-efforts', (event, rawFrom, rawTo) =>
    wrap(() => {
      trusted(event)
      const from = z.string().datetime().nullable().parse(rawFrom)
      const to = z.string().datetime().nullable().parse(rawTo)
      return executionService.summarizeEfforts(from, to)
    })
  )

  ipcMain.handle('execution:correct-effort', (event, rawInput) =>
    wrap(() => {
      trusted(event)
      return executionService.correctEffort(correctEffortInputSchema.parse(rawInput))
    })
  )

  ipcMain.handle('execution:list-effort-history', (event, rawId) =>
    wrap(() => {
      trusted(event)
      return executionService.listEffortHistory(z.string().uuid().parse(rawId))
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

  ipcMain.handle('execution:list-memos', (event, rawInboxOnly, rawIncludeArchived) =>
    wrap(() => {
      trusted(event)
      return executionService.listMemos(
        z.boolean().parse(rawInboxOnly),
        z.boolean().optional().default(false).parse(rawIncludeArchived)
      )
    })
  )

  ipcMain.handle('execution:convert-memo-to-task', (event, rawInput) =>
    wrap(() => {
      trusted(event)
      return executionService.convertMemoToTask(convertMemoToTaskInputSchema.parse(rawInput))
    })
  )

  ipcMain.handle('execution:convert-memo-to-learning', (event, rawInput) =>
    wrap(() => {
      trusted(event)
      return executionService.convertMemoToLearning(
        convertMemoToLearningInputSchema.parse(rawInput)
      )
    })
  )

  ipcMain.handle('execution:archive-memo', (event, rawId, rawArchived) =>
    wrap(() => {
      trusted(event)
      return executionService.archiveMemo(
        z.string().uuid().parse(rawId),
        z.boolean().parse(rawArchived)
      )
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

  ipcMain.handle('practice:list-learning-tests', (event, rawProjectId) =>
    wrap(() => {
      trusted(event)
      return practiceService.listLearningTests(z.string().uuid().parse(rawProjectId))
    })
  )

  ipcMain.handle('practice:create-learning-test', (event, rawInput) =>
    wrap(() => {
      trusted(event)
      return practiceService.createLearningTest(createLearningTestInputSchema.parse(rawInput))
    })
  )

  ipcMain.handle('practice:list-review-queue', (event, rawProjectId) =>
    wrap(() => {
      trusted(event)
      return practiceService.listReviewQueue(z.string().uuid().parse(rawProjectId))
    })
  )

  ipcMain.handle('practice:record-review-result', (event, rawInput) =>
    wrap(() => {
      trusted(event)
      return practiceService.recordReviewResult(recordReviewResultInputSchema.parse(rawInput))
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

  ipcMain.handle('workflow:list-reviews', (event) =>
    wrap(() => {
      trusted(event)
      return workflowService.listReviews()
    })
  )

  ipcMain.handle('workflow:create-review', (event, rawInput) =>
    wrap(() => {
      trusted(event)
      return workflowService.createReview(createReviewInputSchema.parse(rawInput))
    })
  )

  ipcMain.handle('workflow:update-review', (event, rawInput) =>
    wrap(() => {
      trusted(event)
      return workflowService.updateReview(updateReviewInputSchema.parse(rawInput))
    })
  )

  ipcMain.handle('workflow:apply-review-adjustments', (event, rawInput) =>
    wrap(() => {
      trusted(event)
      return workflowService.applyReviewAdjustments(
        applyReviewAdjustmentsInputSchema.parse(rawInput)
      )
    })
  )

  ipcMain.handle('workflow:list-templates', (event) =>
    wrap(() => {
      trusted(event)
      return workflowService.listTemplates()
    })
  )

  ipcMain.handle('workflow:preview-template', (event, rawInput) =>
    wrap(() => {
      trusted(event)
      return workflowService.previewTemplate(previewTemplateInputSchema.parse(rawInput))
    })
  )

  ipcMain.handle('workflow:apply-template', (event, rawInput) =>
    wrap(() => {
      trusted(event)
      return workflowService.applyTemplate(previewTemplateInputSchema.parse(rawInput))
    })
  )

  ipcMain.handle('workflow:save-project-template', (event, rawInput) =>
    wrap(() => {
      trusted(event)
      return workflowService.saveProjectTemplate(saveProjectTemplateInputSchema.parse(rawInput))
    })
  )

  ipcMain.handle('reminders:get-settings', (event) =>
    wrap(() => {
      trusted(event)
      return reminderService.getSettings()
    })
  )

  ipcMain.handle('reminders:update-settings', (event, rawInput) =>
    wrap(() => {
      trusted(event)
      return reminderService.updateSettings(notificationSettingsSchema.parse(rawInput))
    })
  )

  ipcMain.handle('reminders:list-upcoming', (event) =>
    wrap(() => {
      trusted(event)
      return reminderService.listUpcoming()
    })
  )

  ipcMain.handle('reminders:refresh', (event, rawNow) =>
    wrap(() => {
      trusted(event)
      return reminderService.refreshAndProcess(z.string().datetime().parse(rawNow))
    })
  )

  ipcMain.handle('reminders:snooze', (event, rawId, rawMinutes) =>
    wrap(() => {
      trusted(event)
      return reminderService.snooze(
        z.string().uuid().parse(rawId),
        z.number().int().min(5).max(10_080).parse(rawMinutes)
      )
    })
  )

  ipcMain.handle('reminders:dismiss', (event, rawId) =>
    wrap(() => {
      trusted(event)
      reminderService.dismiss(z.string().uuid().parse(rawId))
    })
  )

  ipcMain.handle('reminders:mute-source', (event, rawSourceType, rawSourceId) =>
    wrap(() => {
      trusted(event)
      reminderService.muteSource(
        z.string().min(1).max(60).parse(rawSourceType),
        z.string().uuid().parse(rawSourceId)
      )
    })
  )

  ipcMain.handle('data:check-workspace', (event) =>
    wrap(async () => {
      trusted(event)
      return dataService.checkWorkspace()
    })
  )

  ipcMain.handle('data:rebuild-search-index', (event) =>
    wrap(() => {
      trusted(event)
      return dataService.rebuildSearchIndex()
    })
  )

  ipcMain.handle('data:open-evidence', (event, rawId) =>
    wrap(async () => {
      trusted(event)
      const target = dataService.getEvidenceOpenTarget(z.string().uuid().parse(rawId))
      if (target.type === 'external') {
        await shell.openExternal(target.target)
        return
      }
      const error = await shell.openPath(target.target)
      if (error) {
        throw new YouTraceError({
          code: 'EVIDENCE_OPEN_FAILED',
          message: '无法打开成果文件。',
          details: { reason: error }
        })
      }
    })
  )

  ipcMain.handle('data:list-backups', (event) =>
    wrap(() => {
      trusted(event)
      return dataService.listBackups()
    })
  )

  ipcMain.handle('data:create-backup', (event, rawLabel) =>
    wrap(async () => {
      trusted(event)
      return dataService.createBackup(z.string().max(200).parse(rawLabel))
    })
  )

  ipcMain.handle('data:verify-backup', (event, rawId) =>
    wrap(async () => {
      trusted(event)
      return dataService.verifyBackup(z.string().uuid().parse(rawId))
    })
  )

  ipcMain.handle('data:restore-backup', (event, rawInput) =>
    wrap(async () => {
      trusted(event)
      const input = restoreBackupInputSchema.parse(rawInput)
      const result = await dataService.restoreBackup(input.backupId, input.targetRoot)
      setBootstrapState({ status: 'ready', workspace: result.workspace })
      return result
    })
  )

  ipcMain.handle('data:migrate-workspace', (event, rawInput) =>
    wrap(async () => {
      trusted(event)
      const input = migrateWorkspaceInputSchema.parse(rawInput)
      const result = await dataService.migrateWorkspace(input.targetRoot)
      setBootstrapState({ status: 'ready', workspace: result.workspace })
      return result
    })
  )

  ipcMain.handle('data:export-readable', (event) =>
    wrap(async () => {
      trusted(event)
      return dataService.exportReadable()
    })
  )

  ipcMain.handle('data:export-portable', (event) =>
    wrap(async () => {
      trusted(event)
      return dataService.exportPortable()
    })
  )

  ipcMain.handle('data:import-portable', (event, rawTargetRoot) =>
    wrap(async () => {
      const window = trusted(event)
      const targetRoot = z.string().min(1).parse(rawTargetRoot)
      const selection = await dialog.showOpenDialog(window, {
        title: '选择有迹便携包',
        properties: ['openFile'],
        filters: [{ name: '有迹便携包', extensions: ['ytrace'] }]
      })
      if (selection.canceled || !selection.filePaths[0]) return null
      const result = await dataService.importPortable(selection.filePaths[0], targetRoot)
      setBootstrapState({ status: 'ready', workspace: result.workspace })
      return result
    })
  )

  ipcMain.handle('data:import-evidence-file', (event, rawInput) =>
    wrap(async () => {
      const window = trusted(event)
      const input = importEvidenceFileInputSchema.parse(rawInput)
      const selection = await dialog.showOpenDialog(window, {
        title: '选择成果文件',
        properties: ['openFile']
      })
      if (selection.canceled || !selection.filePaths[0]) return null
      return dataService.importEvidenceFile(selection.filePaths[0], input)
    })
  )

  ipcMain.handle('data:list-trash', (event) =>
    wrap(() => {
      trusted(event)
      return dataService.listTrash()
    })
  )

  ipcMain.handle('data:restore-trash', (event, rawInput) =>
    wrap(() => {
      trusted(event)
      const input = trashActionInputSchema.parse(rawInput)
      return dataService.restoreTrash(input.id)
    })
  )

  ipcMain.handle('data:purge-trash', (event, rawInput) =>
    wrap(async () => {
      trusted(event)
      const input = trashActionInputSchema.parse(rawInput)
      await dataService.purgeTrash(input.id, input.confirmation)
    })
  )

  ipcMain.handle('settings:get-preferences', (event) =>
    wrap(() => {
      trusted(event)
      return settingsService.getPreferences()
    })
  )

  ipcMain.handle('settings:update-preferences', (event, rawInput) =>
    wrap(() => {
      trusted(event)
      return settingsService.updatePreferences(userPreferencesSchema.parse(rawInput))
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

  ipcMain.on('window:resize-start', (event, rawEdge, rawScreenX, rawScreenY) => {
    try {
      const window = trusted(event)
      if (window.isMaximized()) return
      resizeSession = {
        edge: resizeEdgeSchema.parse(rawEdge),
        screenX: z.number().finite().parse(rawScreenX),
        screenY: z.number().finite().parse(rawScreenY),
        bounds: window.getBounds()
      }
    } catch {
      resizeSession = null
    }
  })

  ipcMain.on('window:resize-move', (event, rawScreenX, rawScreenY) => {
    try {
      const window = trusted(event)
      if (!resizeSession || window.isMaximized()) return
      const screenX = z.number().finite().parse(rawScreenX)
      const screenY = z.number().finite().parse(rawScreenY)
      const deltaX = screenX - resizeSession.screenX
      const deltaY = screenY - resizeSession.screenY
      const initial = resizeSession.bounds
      const edge = resizeSession.edge
      let x = initial.x
      let y = initial.y
      let width = initial.width
      let height = initial.height
      if (edge.includes('east')) width = Math.max(1080, initial.width + deltaX)
      if (edge.includes('south')) height = Math.max(720, initial.height + deltaY)
      if (edge.includes('west')) {
        width = Math.max(1080, initial.width - deltaX)
        x = initial.x + initial.width - width
      }
      if (edge.includes('north')) {
        height = Math.max(720, initial.height - deltaY)
        y = initial.y + initial.height - height
      }
      window.setBounds({
        x: Math.round(x),
        y: Math.round(y),
        width: Math.round(width),
        height: Math.round(height)
      })
    } catch {
      resizeSession = null
    }
  })

  ipcMain.on('window:resize-end', (event) => {
    try {
      trusted(event)
    } finally {
      resizeSession = null
    }
  })
}

export function windowState(window: BrowserWindow): WindowState {
  return {
    maximized: window.isMaximized(),
    focused: window.isFocused()
  }
}
