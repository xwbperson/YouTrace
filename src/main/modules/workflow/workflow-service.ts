import { randomUUID } from 'node:crypto'
import type {
  AppliedTemplate,
  ApplyReviewAdjustmentsInput,
  CreateReviewInput,
  PreviewTemplateInput,
  ProjectTemplate,
  Review,
  SaveProjectTemplateInput,
  TemplatePreview,
  UpdateReviewInput
} from '../../../shared/contracts'
import { YouTraceError } from '../../../shared/errors'
import type { PlanningService } from '../planning/planning-service'
import { mapReview, type TemplateDefinition, WorkflowRepository } from './workflow-repository'

const builtInDefinitions: Record<string, { name: string; description: string; definition: TemplateDefinition }> = {
  course: {
    name: '课程学习',
    description: '五个章节，每章包含阅读、笔记、习题、测试和复盘。',
    definition: {
      milestones: Array.from({ length: 5 }, (_, index) => ({
        title: `第 ${index + 1} 章`,
        estimatedMinutes: 300,
        tasks: [
          { title: '阅读教材', estimatedMinutes: 90, difficulty: 3 },
          { title: '整理笔记', estimatedMinutes: 60, difficulty: 3 },
          { title: '完成习题', estimatedMinutes: 75, difficulty: 4 },
          { title: '章节测试', estimatedMinutes: 45, difficulty: 4, priority: 'high' },
          { title: '章节复盘', estimatedMinutes: 30, difficulty: 2 }
        ]
      }))
    }
  },
  reading: {
    name: '阅读一本书',
    description: '从通读、分段笔记到总结输出。',
    definition: {
      milestones: ['通读与标记', '重点章节', '主题笔记', '总结输出'].map((title) => ({
        title,
        estimatedMinutes: 180,
        tasks: [
          { title: `完成${title}`, estimatedMinutes: 120, difficulty: 3 },
          { title: `复盘${title}`, estimatedMinutes: 60, difficulty: 2 }
        ]
      }))
    }
  },
  software: {
    name: '开发一个程序',
    description: '需求、架构、实现、验证和发布的完整轨迹。',
    definition: {
      milestones: ['需求冻结', '架构与原型', '核心实现', '完整验证', '发布交付'].map((title, index) => ({
        title,
        estimatedMinutes: 480,
        tasks: [
          { title: `完成${title}`, estimatedMinutes: 360, difficulty: index >= 2 ? 4 : 3, priority: 'high' },
          { title: `记录${title}证据`, estimatedMinutes: 120, difficulty: 2 }
        ]
      }))
    }
  },
  fitness: {
    name: '健身训练',
    description: '四个训练周期，保留训练、恢复和测量记录。',
    definition: {
      milestones: Array.from({ length: 4 }, (_, index) => ({
        title: `第 ${index + 1} 周训练`,
        estimatedMinutes: 240,
        tasks: [
          { title: '完成三次训练', estimatedMinutes: 180, difficulty: 4 },
          { title: '记录恢复与指标', estimatedMinutes: 30, difficulty: 1 },
          { title: '周训练复盘', estimatedMinutes: 30, difficulty: 2 }
        ]
      }))
    }
  },
  exam: {
    name: '考试准备',
    description: '大纲、基础、专题、模拟和冲刺。',
    definition: {
      milestones: ['确认大纲', '基础复习', '专题练习', '模拟测试', '考前冲刺'].map((title, index) => ({
        title,
        estimatedMinutes: 300,
        tasks: [
          { title: `完成${title}`, estimatedMinutes: 240, difficulty: index > 1 ? 4 : 3, priority: 'high' },
          { title: `检查${title}成果`, estimatedMinutes: 60, difficulty: 2 }
        ]
      }))
    }
  }
}

export class WorkflowService {
  constructor(
    private readonly repository: WorkflowRepository,
    private readonly planningService: PlanningService
  ) {}

  listReviews(): Review[] {
    return this.repository.listReviews().map(mapReview)
  }

  createReview(input: CreateReviewInput): Review {
    if (input.endDate < input.startDate) {
      throw new YouTraceError({ code: 'INVALID_REVIEW_PERIOD', message: '复盘结束日期不能早于开始日期。' })
    }
    const id = randomUUID()
    const now = new Date().toISOString()
    const snapshot = this.repository.captureSnapshot(input.startDate, input.endDate, now)
    this.repository.insertReview(id, input, snapshot, now)
    return this.requireReview(id)
  }

  updateReview(input: UpdateReviewInput): Review {
    const review = this.requireReview(input.id)
    this.repository.updateReview(
      input.id,
      {
        importantOutcomes: input.importantOutcomes ?? review.importantOutcomes,
        incompleteItems: input.incompleteItems ?? review.incompleteItems,
        blockers: input.blockers ?? review.blockers,
        nextFirstStep: input.nextFirstStep ?? review.nextFirstStep,
        nextCommitments: input.nextCommitments ?? review.nextCommitments,
        status: input.status ?? review.status
      },
      new Date().toISOString()
    )
    return this.requireReview(input.id)
  }

  trashReview(id: string): void {
    this.requireReview(id)
    if (!this.repository.trashReview(id, new Date().toISOString())) {
      throw notFound('复盘')
    }
  }

  applyReviewAdjustments(input: ApplyReviewAdjustmentsInput): Review {
    this.requireReview(input.reviewId)
    const now = new Date().toISOString()
    for (const adjustment of input.adjustments) {
      const before = this.planningService.listTasks({
        projectId: null,
        statuses: [],
        tagIds: [],
        includeDeleted: false,
        limit: 500,
        offset: 0
      }).find((task) => task.id === adjustment.taskId)
      if (!before) throw notFound('任务')
      const after =
        adjustment.action === 'reschedule'
          ? this.planningService.updateTask({ id: before.id, dueAt: adjustment.newDueAt, status: 'scheduled' })
          : adjustment.action === 'cancel'
            ? this.planningService.updateTask({ id: before.id, status: 'cancelled' })
            : this.planningService.createTask({
                parentTaskId: before.parentTaskId,
                projectId: before.projectId,
                goalId: before.goalId,
                milestoneId: before.milestoneId,
                title: adjustment.newTitle,
                description: before.description,
                status: 'ready',
                difficulty: before.difficulty,
                priority: before.priority,
                estimatedMinutes: adjustment.estimatedMinutes,
                progressWeight: before.progressWeight,
                startDate: null,
                dueAt: adjustment.newDueAt,
                verificationCriteria: before.verificationCriteria,
                includeInProgress: before.includeInProgress,
                tagIds: before.tagIds
              })
      this.repository.insertAdjustment(
        input.reviewId,
        before.id,
        adjustment.action,
        input.reason,
        before,
        after,
        now
      )
    }
    return this.requireReview(input.reviewId)
  }

  listTemplates(): ProjectTemplate[] {
    const builtIns = Object.entries(builtInDefinitions).map(([id, template]) =>
      describeTemplate(`builtin:${id}`, template.name, template.description, true, null, template.definition)
    )
    const custom = this.repository.listCustomTemplates().map((row) =>
      describeTemplate(
        row.id,
        row.name,
        row.description,
        false,
        row.source_project_id,
        JSON.parse(row.definition_json) as TemplateDefinition
      )
    )
    return [...builtIns, ...custom]
  }

  previewTemplate(input: PreviewTemplateInput): TemplatePreview {
    const { template, definition } = this.requireTemplate(input.templateId)
    return {
      template,
      projectName: input.projectName,
      milestones: definition.milestones.map((milestone) => ({
        title: milestone.title,
        tasks: milestone.tasks.map((task) => ({
          title: task.title,
          estimatedMinutes: task.estimatedMinutes
        }))
      }))
    }
  }

  applyTemplate(input: PreviewTemplateInput): AppliedTemplate {
    const { definition } = this.requireTemplate(input.templateId)
    const today = new Date().toISOString().slice(0, 10)
    const project = this.planningService.createProject({
      areaId: null,
      name: input.projectName,
      description: `由“${this.requireTemplate(input.templateId).template.name}”模板创建`,
      status: 'active',
      startDate: today,
      targetDate: null,
      successCriteria: '',
      progressMode: 'workload'
    })
    const milestoneIds: string[] = []
    const taskIds: string[] = []
    for (const milestoneDefinition of definition.milestones) {
      const milestone = this.planningService.createMilestone({
        projectId: project.id,
        goalId: null,
        title: milestoneDefinition.title,
        description: milestoneDefinition.description ?? '',
        plannedDate: null,
        estimatedMinutes: milestoneDefinition.estimatedMinutes ?? null,
        manualWeight: null,
        mastery: null,
        verificationCriteria: '',
        status: 'not_started',
        includeInProgress: true
      })
      milestoneIds.push(milestone.id)
      for (const taskDefinition of milestoneDefinition.tasks) {
        const task = this.planningService.createTask({
          parentTaskId: null,
          projectId: project.id,
          goalId: null,
          milestoneId: milestone.id,
          title: taskDefinition.title,
          description: '',
          status: 'ready',
          difficulty: taskDefinition.difficulty ?? null,
          priority: taskDefinition.priority ?? 'medium',
          estimatedMinutes: taskDefinition.estimatedMinutes,
          progressWeight: null,
          startDate: null,
          dueAt: null,
          verificationCriteria: '',
          includeInProgress: true,
          tagIds: []
        })
        taskIds.push(task.id)
      }
    }
    return { project, milestoneIds, taskIds }
  }

  saveProjectTemplate(input: SaveProjectTemplateInput): ProjectTemplate {
    const project = this.planningService.listProjects().find((item) => item.id === input.projectId)
    if (!project) throw notFound('项目')
    const milestones = this.planningService.listMilestones(project.id)
    const tasks = this.planningService.listTasks({
      projectId: project.id,
      statuses: [],
      tagIds: [],
      includeDeleted: false,
      limit: 500,
      offset: 0
    })
    const definition: TemplateDefinition = {
      milestones: milestones.map((milestone) => ({
        title: milestone.title,
        description: milestone.description,
        estimatedMinutes: milestone.estimatedMinutes,
        tasks: tasks
          .filter((task) => task.milestoneId === milestone.id)
          .map((task) => ({
            title: task.title,
            estimatedMinutes: task.estimatedMinutes,
            difficulty: task.difficulty,
            priority: task.priority
          }))
      }))
    }
    if (tasks.some((task) => task.milestoneId === null)) {
      definition.milestones.push({
        title: '未分组任务',
        estimatedMinutes: null,
        tasks: tasks
          .filter((task) => task.milestoneId === null)
          .map((task) => ({
            title: task.title,
            estimatedMinutes: task.estimatedMinutes,
            difficulty: task.difficulty,
            priority: task.priority
          }))
      })
    }
    const id = randomUUID()
    this.repository.insertCustomTemplate(
      id,
      input.name,
      input.description,
      project.id,
      definition,
      new Date().toISOString()
    )
    return this.requireTemplate(id).template
  }

  private requireReview(id: string): Review {
    const row = this.repository.getReview(id)
    if (!row) throw notFound('复盘')
    return mapReview(row)
  }

  private requireTemplate(id: string): { template: ProjectTemplate; definition: TemplateDefinition } {
    if (id.startsWith('builtin:')) {
      const value = builtInDefinitions[id.slice('builtin:'.length)]
      if (!value) throw notFound('模板')
      return {
        template: describeTemplate(id, value.name, value.description, true, null, value.definition),
        definition: value.definition
      }
    }
    const row = this.repository.getCustomTemplate(id)
    if (!row) throw notFound('模板')
    const definition = JSON.parse(row.definition_json) as TemplateDefinition
    return {
      template: describeTemplate(row.id, row.name, row.description, false, row.source_project_id, definition),
      definition
    }
  }
}

function describeTemplate(
  id: string,
  name: string,
  description: string,
  builtIn: boolean,
  sourceProjectId: string | null,
  definition: TemplateDefinition
): ProjectTemplate {
  return {
    id,
    name,
    description,
    builtIn,
    sourceProjectId,
    milestoneCount: definition.milestones.length,
    taskCount: definition.milestones.reduce((sum, milestone) => sum + milestone.tasks.length, 0)
  }
}

function notFound(label: string): YouTraceError {
  return new YouTraceError({ code: 'ENTITY_NOT_FOUND', message: `${label}不存在或已进入回收站。` })
}
