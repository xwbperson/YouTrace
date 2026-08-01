import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  AppBootstrapState,
  CreateWorkspaceInput,
  IpcResult,
  OpenWorkspaceInput,
  ReconnectWorkspaceInput,
  WindowState,
  WorkspaceSummary,
  WorkspaceUnavailableState,
  YouTraceApi
} from '../shared/contracts'

const api: YouTraceApi = {
  app: {
    getBootstrapState: () =>
      ipcRenderer.invoke('app:get-bootstrap-state') as Promise<IpcResult<AppBootstrapState>>,
    onWorkspaceUnavailable: (callback) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        state: WorkspaceUnavailableState
      ): void => callback(state)
      ipcRenderer.on('workspace:unavailable', listener)
      return () => ipcRenderer.removeListener('workspace:unavailable', listener)
    }
  },
  dialog: {
    selectDirectory: () =>
      ipcRenderer.invoke('dialog:select-directory') as Promise<IpcResult<string | null>>
  },
  workspace: {
    create: (input: CreateWorkspaceInput) =>
      ipcRenderer.invoke('workspace:create', input) as Promise<IpcResult<WorkspaceSummary>>,
    open: (input: OpenWorkspaceInput) =>
      ipcRenderer.invoke('workspace:open', input) as Promise<IpcResult<WorkspaceSummary>>,
    reconnect: (input: ReconnectWorkspaceInput) =>
      ipcRenderer.invoke('workspace:reconnect', input) as Promise<IpcResult<WorkspaceSummary>>,
    reveal: () => ipcRenderer.invoke('workspace:reveal') as Promise<IpcResult<void>>,
    getDatabaseRecovery: () => ipcRenderer.invoke('workspace:get-database-recovery'),
    confirmDatabaseRecovery: (id) =>
      ipcRenderer.invoke('workspace:confirm-database-recovery', id),
    revealDatabaseRecoveryReport: () =>
      ipcRenderer.invoke('workspace:reveal-database-recovery-report')
  },
  planning: {
    listAreas: (includeArchived) => ipcRenderer.invoke('planning:list-areas', includeArchived),
    createArea: (input) => ipcRenderer.invoke('planning:create-area', input),
    updateArea: (input) => ipcRenderer.invoke('planning:update-area', input),
    trashArea: (id) => ipcRenderer.invoke('planning:trash-area', id),
    listProjects: (includeArchived) => ipcRenderer.invoke('planning:list-projects', includeArchived),
    createProject: (input) => ipcRenderer.invoke('planning:create-project', input),
    updateProject: (input) => ipcRenderer.invoke('planning:update-project', input),
    trashProject: (id) => ipcRenderer.invoke('planning:trash-project', id),
    listProjectHistory: (projectId) =>
      ipcRenderer.invoke('planning:list-project-history', projectId),
    listGoals: (projectId) => ipcRenderer.invoke('planning:list-goals', projectId),
    createGoal: (input) => ipcRenderer.invoke('planning:create-goal', input),
    updateGoal: (input) => ipcRenderer.invoke('planning:update-goal', input),
    trashGoal: (id) => ipcRenderer.invoke('planning:trash-goal', id),
    listMilestones: (projectId) => ipcRenderer.invoke('planning:list-milestones', projectId),
    createMilestone: (input) => ipcRenderer.invoke('planning:create-milestone', input),
    updateMilestone: (input) => ipcRenderer.invoke('planning:update-milestone', input),
    trashMilestone: (id) => ipcRenderer.invoke('planning:trash-milestone', id),
    listTasks: (input) => ipcRenderer.invoke('planning:list-tasks', input),
    createTask: (input) => ipcRenderer.invoke('planning:create-task', input),
    updateTask: (input) => ipcRenderer.invoke('planning:update-task', input),
    trashTask: (id) => ipcRenderer.invoke('planning:trash-task', id),
    addTaskDependency: (input) => ipcRenderer.invoke('planning:add-task-dependency', input),
    listTaskDependencies: (taskId) =>
      ipcRenderer.invoke('planning:list-task-dependencies', taskId),
    listChecklist: (taskId) => ipcRenderer.invoke('planning:list-checklist', taskId),
    createChecklistItem: (input) => ipcRenderer.invoke('planning:create-checklist-item', input),
    updateChecklistItem: (input) => ipcRenderer.invoke('planning:update-checklist-item', input),
    deleteChecklistItem: (id) => ipcRenderer.invoke('planning:delete-checklist-item', id),
    setChecklistProgress: (input) => ipcRenderer.invoke('planning:set-checklist-progress', input),
    getTaskRecurrence: (taskId) => ipcRenderer.invoke('planning:get-task-recurrence', taskId),
    setTaskRecurrence: (input) => ipcRenderer.invoke('planning:set-task-recurrence', input),
    listTags: (includeArchived) => ipcRenderer.invoke('planning:list-tags', includeArchived),
    createTag: (input) => ipcRenderer.invoke('planning:create-tag', input),
    updateTag: (input) => ipcRenderer.invoke('planning:update-tag', input),
    archiveTag: (id, archived) => ipcRenderer.invoke('planning:archive-tag', id, archived),
    trashTag: (id) => ipcRenderer.invoke('planning:trash-tag', id),
    assignTag: (input) => ipcRenderer.invoke('planning:assign-tag', input),
    getTagStats: (id) => ipcRenderer.invoke('planning:get-tag-stats', id),
    mergeTags: (input) => ipcRenderer.invoke('planning:merge-tags', input),
    search: (input) => ipcRenderer.invoke('planning:search', input),
    listSavedViews: () => ipcRenderer.invoke('planning:list-saved-views'),
    saveView: (input) => ipcRenderer.invoke('planning:save-view', input),
    updateSavedView: (input) => ipcRenderer.invoke('planning:update-saved-view', input),
    deleteSavedView: (id) => ipcRenderer.invoke('planning:delete-saved-view', id)
  },
  execution: {
    getActiveEffort: () => ipcRenderer.invoke('execution:get-active-effort'),
    startEffort: (input) => ipcRenderer.invoke('execution:start-effort', input),
    suspendEffort: (id) => ipcRenderer.invoke('execution:suspend-effort', id),
    resumeEffort: (id) => ipcRenderer.invoke('execution:resume-effort', id),
    stopEffort: (input) => ipcRenderer.invoke('execution:stop-effort', input),
    getPendingRecovery: () => ipcRenderer.invoke('execution:get-pending-recovery'),
    resolvePendingRecovery: (input) =>
      ipcRenderer.invoke('execution:resolve-pending-recovery', input),
    createManualEffort: (input) => ipcRenderer.invoke('execution:create-manual-effort', input),
    listEfforts: (input) => ipcRenderer.invoke('execution:list-efforts', input),
    summarizeEfforts: (from, to) => ipcRenderer.invoke('execution:summarize-efforts', from, to),
    correctEffort: (input) => ipcRenderer.invoke('execution:correct-effort', input),
    listEffortHistory: (id) => ipcRenderer.invoke('execution:list-effort-history', id),
    createEvidence: (input) => ipcRenderer.invoke('execution:create-evidence', input),
    listEvidence: (entityType, entityId) =>
      ipcRenderer.invoke('execution:list-evidence', entityType, entityId),
    updateEvidence: (input) => ipcRenderer.invoke('execution:update-evidence', input),
    trashEvidence: (id) => ipcRenderer.invoke('execution:trash-evidence', id),
    updateEvidenceStatus: (input) =>
      ipcRenderer.invoke('execution:update-evidence-status', input),
    createMemo: (input) => ipcRenderer.invoke('execution:create-memo', input),
    updateMemo: (input) => ipcRenderer.invoke('execution:update-memo', input),
    listMemos: (inboxOnly, includeArchived) =>
      ipcRenderer.invoke('execution:list-memos', inboxOnly, includeArchived),
    convertMemoToTask: (input) => ipcRenderer.invoke('execution:convert-memo-to-task', input),
    convertMemoToLearning: (input) =>
      ipcRenderer.invoke('execution:convert-memo-to-learning', input),
    archiveMemo: (id, archived) => ipcRenderer.invoke('execution:archive-memo', id, archived),
    deleteArchivedMemo: (id) => ipcRenderer.invoke('execution:delete-archived-memo', id)
  },
  practice: {
    listHabits: (projectId, date) =>
      ipcRenderer.invoke('practice:list-habits', projectId, date),
    createHabit: (input) => ipcRenderer.invoke('practice:create-habit', input),
    updateHabit: (input) => ipcRenderer.invoke('practice:update-habit', input),
    trashHabit: (id) => ipcRenderer.invoke('practice:trash-habit', id),
    recordHabit: (input) => ipcRenderer.invoke('practice:record-habit', input),
    listMetrics: (projectId) => ipcRenderer.invoke('practice:list-metrics', projectId),
    createMetric: (input) => ipcRenderer.invoke('practice:create-metric', input),
    updateMetric: (input) => ipcRenderer.invoke('practice:update-metric', input),
    trashMetric: (id) => ipcRenderer.invoke('practice:trash-metric', id),
    recordMetric: (input) => ipcRenderer.invoke('practice:record-metric', input),
    listCourses: () => ipcRenderer.invoke('practice:list-courses'),
    createCourse: (input) => ipcRenderer.invoke('practice:create-course', input),
    updateCourse: (input) => ipcRenderer.invoke('practice:update-course', input),
    trashCourse: (id) => ipcRenderer.invoke('practice:trash-course', id),
    listKnowledge: (projectId) => ipcRenderer.invoke('practice:list-knowledge', projectId),
    createKnowledge: (input) => ipcRenderer.invoke('practice:create-knowledge', input),
    updateKnowledge: (input) => ipcRenderer.invoke('practice:update-knowledge', input),
    trashKnowledge: (id) => ipcRenderer.invoke('practice:trash-knowledge', id),
    listMistakes: (projectId) => ipcRenderer.invoke('practice:list-mistakes', projectId),
    createMistake: (input) => ipcRenderer.invoke('practice:create-mistake', input),
    updateMistake: (input) => ipcRenderer.invoke('practice:update-mistake', input),
    trashMistake: (id) => ipcRenderer.invoke('practice:trash-mistake', id),
    listLearningTests: (projectId) => ipcRenderer.invoke('practice:list-learning-tests', projectId),
    createLearningTest: (input) => ipcRenderer.invoke('practice:create-learning-test', input),
    updateLearningTest: (input) => ipcRenderer.invoke('practice:update-learning-test', input),
    trashLearningTest: (id) => ipcRenderer.invoke('practice:trash-learning-test', id),
    listReviewQueue: (projectId) => ipcRenderer.invoke('practice:list-review-queue', projectId),
    recordReviewResult: (input) => ipcRenderer.invoke('practice:record-review-result', input)
  },
  temporal: {
    listPlans: (startDate, endDate) =>
      ipcRenderer.invoke('temporal:list-plans', startDate, endDate),
    createPlan: (input) => ipcRenderer.invoke('temporal:create-plan', input),
    updatePlan: (input) => ipcRenderer.invoke('temporal:update-plan', input),
    trashPlan: (id) => ipcRenderer.invoke('temporal:trash-plan', id),
    listTimeBlocks: (input) => ipcRenderer.invoke('temporal:list-time-blocks', input),
    createTimeBlock: (input) => ipcRenderer.invoke('temporal:create-time-block', input),
    updateTimeBlock: (input) => ipcRenderer.invoke('temporal:update-time-block', input),
    moveTimeBlock: (input) => ipcRenderer.invoke('temporal:move-time-block', input),
    trashTimeBlock: (id) => ipcRenderer.invoke('temporal:trash-time-block', id),
    listCountdowns: (now) => ipcRenderer.invoke('temporal:list-countdowns', now),
    createCountdown: (input) => ipcRenderer.invoke('temporal:create-countdown', input),
    updateCountdown: (input) => ipcRenderer.invoke('temporal:update-countdown', input),
    trashCountdown: (id) => ipcRenderer.invoke('temporal:trash-countdown', id)
  },
  workflow: {
    listReviews: () => ipcRenderer.invoke('workflow:list-reviews'),
    createReview: (input) => ipcRenderer.invoke('workflow:create-review', input),
    updateReview: (input) => ipcRenderer.invoke('workflow:update-review', input),
    trashReview: (id) => ipcRenderer.invoke('workflow:trash-review', id),
    applyReviewAdjustments: (input) =>
      ipcRenderer.invoke('workflow:apply-review-adjustments', input),
    listTemplates: (includeArchived) => ipcRenderer.invoke('workflow:list-templates', includeArchived),
    previewTemplate: (input) => ipcRenderer.invoke('workflow:preview-template', input),
    applyTemplate: (input) => ipcRenderer.invoke('workflow:apply-template', input),
    saveProjectTemplate: (input) => ipcRenderer.invoke('workflow:save-project-template', input),
    updateProjectTemplate: (input) => ipcRenderer.invoke('workflow:update-project-template', input),
    archiveTemplate: (id, archived) => ipcRenderer.invoke('workflow:archive-template', id, archived),
    trashTemplate: (id) => ipcRenderer.invoke('workflow:trash-template', id)
  },
  reminders: {
    getSettings: () => ipcRenderer.invoke('reminders:get-settings'),
    updateSettings: (input) => ipcRenderer.invoke('reminders:update-settings', input),
    listUpcoming: () => ipcRenderer.invoke('reminders:list-upcoming'),
    refresh: (now) => ipcRenderer.invoke('reminders:refresh', now),
    snooze: (id, minutes) => ipcRenderer.invoke('reminders:snooze', id, minutes),
    dismiss: (id) => ipcRenderer.invoke('reminders:dismiss', id),
    muteSource: (sourceType, sourceId) =>
      ipcRenderer.invoke('reminders:mute-source', sourceType, sourceId),
    onNavigate: (callback) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        navigation: Parameters<typeof callback>[0]
      ): void => callback(navigation)
      ipcRenderer.on('reminder:navigate', listener)
      return () => ipcRenderer.removeListener('reminder:navigate', listener)
    }
  },
  data: {
    checkWorkspace: () => ipcRenderer.invoke('data:check-workspace'),
    rebuildSearchIndex: () => ipcRenderer.invoke('data:rebuild-search-index'),
    openEvidence: (id) => ipcRenderer.invoke('data:open-evidence', id),
    listBackups: () => ipcRenderer.invoke('data:list-backups'),
    getBackupStorageStatus: () => ipcRenderer.invoke('data:get-backup-storage-status'),
    createBackup: (label) => ipcRenderer.invoke('data:create-backup', label),
    verifyBackup: (id) => ipcRenderer.invoke('data:verify-backup', id),
    restoreBackup: (input) => ipcRenderer.invoke('data:restore-backup', input),
    migrateWorkspace: (input) => ipcRenderer.invoke('data:migrate-workspace', input),
    getPendingMigration: () => ipcRenderer.invoke('data:get-pending-migration'),
    resolvePendingMigration: (action) =>
      ipcRenderer.invoke('data:resolve-pending-migration', action),
    revealPendingMigrationReport: () =>
      ipcRenderer.invoke('data:reveal-pending-migration-report'),
    saveRecoveryDraft: (input) => ipcRenderer.invoke('data:save-recovery-draft', input),
    listRecoveryDrafts: () => ipcRenderer.invoke('data:list-recovery-drafts'),
    discardRecoveryDraft: (key) =>
      ipcRenderer.invoke('data:discard-recovery-draft', key),
    exportReadable: () => ipcRenderer.invoke('data:export-readable'),
    exportPortable: () => ipcRenderer.invoke('data:export-portable'),
    importPortable: (targetRoot) => ipcRenderer.invoke('data:import-portable', targetRoot),
    importEvidenceFile: (input) => ipcRenderer.invoke('data:import-evidence-file', input),
    importDroppedEvidenceFile: (file, input) =>
      ipcRenderer.invoke('data:import-dropped-evidence-file', webUtils.getPathForFile(file), input),
    attachDroppedEvidenceFile: (file, evidenceId) =>
      ipcRenderer.invoke(
        'data:attach-dropped-evidence-file',
        webUtils.getPathForFile(file),
        evidenceId
      ),
    listEvidenceAttachments: (evidenceId) =>
      ipcRenderer.invoke('data:list-evidence-attachments', evidenceId),
    openEvidenceAttachment: (attachmentId) =>
      ipcRenderer.invoke('data:open-evidence-attachment', attachmentId),
    listTrash: () => ipcRenderer.invoke('data:list-trash'),
    restoreTrash: (input) => ipcRenderer.invoke('data:restore-trash', input),
    purgeTrash: (input) => ipcRenderer.invoke('data:purge-trash', input)
  },
  settings: {
    getPreferences: () => ipcRenderer.invoke('settings:get-preferences'),
    updatePreferences: (input) => ipcRenderer.invoke('settings:update-preferences', input)
  },
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize') as Promise<IpcResult<void>>,
    toggleMaximize: () =>
      ipcRenderer.invoke('window:toggle-maximize') as Promise<IpcResult<WindowState>>,
    close: () => ipcRenderer.invoke('window:close') as Promise<IpcResult<void>>,
    quit: () => ipcRenderer.invoke('window:quit') as Promise<IpcResult<void>>,
    getState: () => ipcRenderer.invoke('window:get-state') as Promise<IpcResult<WindowState>>,
    startResize: (edge, screenX, screenY) =>
      ipcRenderer.send('window:resize-start', edge, screenX, screenY),
    moveResize: (screenX, screenY) =>
      ipcRenderer.send('window:resize-move', screenX, screenY),
    endResize: () => ipcRenderer.send('window:resize-end'),
    onQuitRequested: (callback) => {
      const listener = (): void => callback()
      ipcRenderer.on('window:quit-requested', listener)
      return () => ipcRenderer.removeListener('window:quit-requested', listener)
    },
    onStateChanged: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, state: WindowState): void => {
        callback(state)
      }
      ipcRenderer.on('window:state-changed', listener)
      return () => ipcRenderer.removeListener('window:state-changed', listener)
    }
  }
}

contextBridge.exposeInMainWorld('youtrace', api)
