import type Database from 'better-sqlite3'
import type {
  Course,
  CreateLearningTestInput,
  CreateCourseInput,
  CreateHabitInput,
  CreateKnowledgeInput,
  CreateMetricInput,
  CreateMistakeInput,
  Habit,
  KnowledgeItem,
  LearningTest,
  Metric,
  MetricEntry,
  Mistake,
  RecordHabitInput,
  RecordMetricInput,
  RecordReviewResultInput,
  ReviewQueueItem,
  UpdateMetricEntryInput
} from '../../../shared/contracts'

interface HabitRow {
  id: string
  project_id: string | null
  name: string
  description: string
  frequency: Habit['frequency']
  target_count: number
  weekdays_json: string
  reminder_time: string | null
  start_date: string
  end_date: string | null
  today_status: Habit['todayStatus']
  total_completed: number
  created_at: string
  updated_at: string
}

interface MetricRow {
  id: string
  project_id: string | null
  name: string
  target_value: number
  unit: string
  direction: Metric['direction']
  period: Metric['period']
  current_value: number | null
  last_recorded_at: string | null
  entry_count: number
  created_at: string
  updated_at: string
}

interface CourseRow {
  id: string
  project_id: string
  course_name: string
  exam_date: string | null
  textbook_id: string | null
  textbook_title: string | null
  author: string | null
  edition: string | null
  isbn: string | null
  publisher: string | null
  knowledge_count: number
  mistake_count: number
  pending_review_count: number
  created_at: string
  updated_at: string
}

interface KnowledgeRow {
  id: string
  project_id: string
  milestone_id: string | null
  title: string
  content: string
  mastery: number | null
  last_reviewed_at: string | null
  next_review_date: string | null
  created_at: string
  updated_at: string
}

interface MistakeRow {
  id: string
  project_id: string
  knowledge_item_id: string | null
  question: string
  wrong_answer: string
  correct_answer: string
  analysis: string
  mastery: number | null
  next_review_date: string | null
  created_at: string
  updated_at: string
}

interface LearningTestRow {
  id: string
  project_id: string
  milestone_id: string | null
  title: string
  score: number | null
  max_score: number | null
  tested_at: string
  note: string
  created_at: string
  updated_at: string
}

interface ReviewQueueRow {
  id: string
  entity_type: ReviewQueueItem['entityType']
  entity_id: string
  title: string
  scheduled_date: string
  status: ReviewQueueItem['status']
  result: ReviewQueueItem['result']
  project_id: string
  created_at: string
  updated_at: string
}

export class PracticeRepository {
  constructor(private readonly database: () => Database.Database) {}

  listHabits(projectId: string | null, date: string): HabitRow[] {
    const condition = projectId === null ? 'h.project_id IS NULL' : 'h.project_id = ?'
    const params = projectId === null ? [date] : [date, projectId]
    return this.database()
      .prepare(
        `SELECT h.id, h.project_id, h.name, h.description, h.frequency, h.target_count,
                h.weekdays_json, h.reminder_time, h.start_date, h.end_date,
                hi.status AS today_status,
                (SELECT COUNT(*) FROM habit_instances total
                  WHERE total.habit_rule_id = h.id AND total.status = 'completed') AS total_completed,
                h.created_at, h.updated_at
           FROM habit_rules h
           LEFT JOIN habit_instances hi
             ON hi.habit_rule_id = h.id AND hi.scheduled_date = ?
          WHERE ${condition} AND h.deleted_at IS NULL AND h.archived_at IS NULL
          ORDER BY h.created_at`
      )
      .all(...params) as HabitRow[]
  }

  getHabit(id: string, date: string): HabitRow | null {
    return (
      (this.database()
        .prepare(
          `SELECT h.id, h.project_id, h.name, h.description, h.frequency, h.target_count,
                  h.weekdays_json, h.reminder_time, h.start_date, h.end_date,
                  hi.status AS today_status,
                  (SELECT COUNT(*) FROM habit_instances total
                    WHERE total.habit_rule_id = h.id AND total.status = 'completed') AS total_completed,
                  h.created_at, h.updated_at
             FROM habit_rules h
             LEFT JOIN habit_instances hi
               ON hi.habit_rule_id = h.id AND hi.scheduled_date = ?
            WHERE h.id = ? AND h.deleted_at IS NULL`
        )
        .get(date, id) as HabitRow | undefined) ?? null
    )
  }

  insertHabit(id: string, input: CreateHabitInput, now: string): void {
    const database = this.database()
    database
      .prepare(
        `INSERT INTO habit_rules(
           id, project_id, name, description, frequency, target_count, weekdays_json,
           reminder_time, start_date, end_date, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.projectId,
        input.name,
        input.description,
        input.frequency,
        input.targetCount,
        JSON.stringify(input.weekdays),
        input.reminderTime,
        input.startDate,
        input.endDate,
        now,
        now
      )
    this.insertAudit(database, 'habit', id, 'created', null, input, now)
  }

  updateHabit(id: string, input: CreateHabitInput, now: string): void {
    this.database().prepare(
      `UPDATE habit_rules SET project_id = ?, name = ?, description = ?, frequency = ?,
         target_count = ?, weekdays_json = ?, reminder_time = ?, start_date = ?, end_date = ?,
         updated_at = ? WHERE id = ? AND deleted_at IS NULL`
    ).run(input.projectId, input.name, input.description, input.frequency, input.targetCount,
      JSON.stringify(input.weekdays), input.reminderTime, input.startDate, input.endDate, now, id)
    this.insertAudit(this.database(), 'habit', id, 'updated', null, input, now)
  }

  trashHabit(id: string, now: string): boolean {
    return this.trashEntity('habit_rules', 'habit', id, now, false)
  }

  recordHabit(id: string, input: RecordHabitInput, now: string): void {
    const database = this.database()
    database
      .prepare(
        `INSERT INTO habit_instances(
           id, habit_rule_id, scheduled_date, status, completed_at, skip_reason,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(habit_rule_id, scheduled_date) DO UPDATE SET
           status = excluded.status,
           completed_at = excluded.completed_at,
           skip_reason = excluded.skip_reason,
           updated_at = excluded.updated_at`
      )
      .run(
        id,
        input.habitId,
        input.date,
        input.status,
        input.status === 'completed' ? now : null,
        input.skipReason,
        now,
        now
      )
    this.insertAudit(database, 'habit', input.habitId, 'instance_recorded', null, input, now)
  }

  clearHabitRecord(habitId: string, date: string, now: string): boolean {
    const result = this.database()
      .prepare('DELETE FROM habit_instances WHERE habit_rule_id = ? AND scheduled_date = ?')
      .run(habitId, date)
    if (result.changes > 0) {
      this.insertAudit(this.database(), 'habit', habitId, 'instance_cleared', null, { date }, now)
    }
    return result.changes > 0
  }

  getCompletedHabitDates(habitId: string): string[] {
    return (
      this.database()
        .prepare(
          `SELECT scheduled_date FROM habit_instances
            WHERE habit_rule_id = ? AND status = 'completed'
            ORDER BY scheduled_date DESC`
        )
        .all(habitId) as Array<{ scheduled_date: string }>
    ).map((row) => row.scheduled_date)
  }

  listMetrics(projectId: string | null): MetricRow[] {
    const condition = projectId === null ? 'm.project_id IS NULL' : 'm.project_id = ?'
    return this.database()
      .prepare(
        `SELECT m.id, m.project_id, m.name, m.target_value, m.unit, m.direction, m.period,
                CASE
                  WHEN m.period = 'total' THEN COALESCE(SUM(me.value), 0)
                  ELSE (
                    SELECT latest.value FROM metric_entries latest
                     WHERE latest.metric_id = m.id
                     ORDER BY latest.recorded_at DESC LIMIT 1
                  )
                END AS current_value,
                MAX(me.recorded_at) AS last_recorded_at,
                COUNT(me.id) AS entry_count,
                m.created_at, m.updated_at
           FROM metrics m
           LEFT JOIN metric_entries me ON me.metric_id = m.id
          WHERE ${condition} AND m.deleted_at IS NULL AND m.archived_at IS NULL
          GROUP BY m.id
          ORDER BY m.created_at`
      )
      .all(...(projectId === null ? [] : [projectId])) as MetricRow[]
  }

  getMetric(id: string): MetricRow | null {
    return (
      (this.database()
        .prepare(
          `SELECT m.id, m.project_id, m.name, m.target_value, m.unit, m.direction, m.period,
                  CASE
                    WHEN m.period = 'total' THEN COALESCE(SUM(me.value), 0)
                    ELSE (
                      SELECT latest.value FROM metric_entries latest
                       WHERE latest.metric_id = m.id
                       ORDER BY latest.recorded_at DESC LIMIT 1
                    )
                  END AS current_value,
                  MAX(me.recorded_at) AS last_recorded_at,
                  COUNT(me.id) AS entry_count,
                  m.created_at, m.updated_at
             FROM metrics m
             LEFT JOIN metric_entries me ON me.metric_id = m.id
            WHERE m.id = ? AND m.deleted_at IS NULL
            GROUP BY m.id`
        )
        .get(id) as MetricRow | undefined) ?? null
    )
  }

  insertMetric(id: string, input: CreateMetricInput, now: string): void {
    const database = this.database()
    database
      .prepare(
        `INSERT INTO metrics(
           id, project_id, name, target_value, unit, direction, period, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.projectId,
        input.name,
        input.targetValue,
        input.unit,
        input.direction,
        input.period,
        now,
        now
      )
    this.insertAudit(database, 'metric', id, 'created', null, input, now)
  }

  updateMetric(id: string, input: CreateMetricInput, now: string): void {
    this.database().prepare(
      `UPDATE metrics SET project_id = ?, name = ?, target_value = ?, unit = ?, direction = ?,
         period = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`
    ).run(input.projectId, input.name, input.targetValue, input.unit, input.direction, input.period, now, id)
    this.insertAudit(this.database(), 'metric', id, 'updated', null, input, now)
  }

  trashMetric(id: string, now: string): boolean {
    return this.trashEntity('metrics', 'metric', id, now, false)
  }

  recordMetric(id: string, input: RecordMetricInput, now: string): void {
    const database = this.database()
    database
      .prepare(
        `INSERT INTO metric_entries(id, metric_id, value, recorded_at, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(id, input.metricId, input.value, input.recordedAt, input.note, now)
    this.insertAudit(database, 'metric', input.metricId, 'value_recorded', null, input, now)
  }

  listMetricEntries(metricId: string): MetricEntry[] {
    return (this.database()
      .prepare(
        `SELECT id, metric_id, value, recorded_at, note, created_at
           FROM metric_entries WHERE metric_id = ? ORDER BY recorded_at DESC, created_at DESC`
      )
      .all(metricId) as Array<{
        id: string
        metric_id: string
        value: number
        recorded_at: string
        note: string
        created_at: string
      }>).map((row) => ({
        id: row.id,
        metricId: row.metric_id,
        value: row.value,
        recordedAt: row.recorded_at,
        note: row.note,
        createdAt: row.created_at
      }))
  }

  getMetricEntry(id: string): MetricEntry | null {
    const row = this.database()
      .prepare('SELECT metric_id FROM metric_entries WHERE id = ?')
      .get(id) as { metric_id: string } | undefined
    return row ? this.listMetricEntries(row.metric_id).find((entry) => entry.id === id) ?? null : null
  }

  updateMetricEntry(input: UpdateMetricEntryInput, now: string): boolean {
    const before = this.getMetricEntry(input.id)
    const result = this.database()
      .prepare('UPDATE metric_entries SET value = ?, recorded_at = ?, note = ? WHERE id = ?')
      .run(input.value, input.recordedAt, input.note, input.id)
    if (result.changes > 0 && before) {
      this.insertAudit(this.database(), 'metric', before.metricId, 'value_corrected', before, input, now)
    }
    return result.changes > 0
  }

  deleteMetricEntry(id: string, now: string): boolean {
    const before = this.getMetricEntry(id)
    if (!before) return false
    const result = this.database().prepare('DELETE FROM metric_entries WHERE id = ?').run(id)
    if (result.changes > 0) {
      this.insertAudit(this.database(), 'metric', before.metricId, 'value_removed', before, null, now)
    }
    return result.changes > 0
  }

  listCourses(): CourseRow[] {
    return this.database()
      .prepare(
        `SELECT c.id, c.project_id, c.course_name, c.exam_date,
                t.id AS textbook_id, t.title AS textbook_title, t.author, t.edition,
                t.isbn, t.publisher,
                (SELECT COUNT(*) FROM knowledge_items k
                  WHERE k.project_id = c.project_id AND k.deleted_at IS NULL) AS knowledge_count,
                (SELECT COUNT(*) FROM mistakes m
                  WHERE m.project_id = c.project_id AND m.deleted_at IS NULL) AS mistake_count,
                (SELECT COUNT(*) FROM review_queue r
                  WHERE r.status = 'pending'
                    AND ((r.entity_type = 'knowledge' AND r.entity_id IN (
                      SELECT id FROM knowledge_items WHERE project_id = c.project_id
                    )) OR (r.entity_type = 'mistake' AND r.entity_id IN (
                      SELECT id FROM mistakes WHERE project_id = c.project_id
                    )))) AS pending_review_count,
                c.created_at, c.updated_at
           FROM course_profiles c
           LEFT JOIN textbooks t ON t.course_profile_id = c.id
          WHERE c.deleted_at IS NULL AND c.archived_at IS NULL
          ORDER BY c.created_at`
      )
      .all() as CourseRow[]
  }

  getCourse(id: string): CourseRow | null {
    return this.listCourses().find((course) => course.id === id) ?? null
  }

  insertCourse(
    id: string,
    textbookId: string,
    input: CreateCourseInput,
    now: string
  ): void {
    const database = this.database()
    const transaction = database.transaction(() => {
      database
        .prepare(
          `INSERT INTO course_profiles(
             id, project_id, course_name, exam_date, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(id, input.projectId, input.courseName, input.examDate, now, now)
      database
        .prepare(
          `INSERT INTO textbooks(
             id, course_profile_id, title, author, edition, isbn, publisher, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          textbookId,
          id,
          input.textbook.title,
          input.textbook.author,
          input.textbook.edition,
          input.textbook.isbn,
          input.textbook.publisher,
          now,
          now
        )
      this.insertAudit(database, 'course', id, 'created', null, input, now)
    })
    transaction()
  }

  updateCourse(id: string, input: CreateCourseInput, now: string): void {
    const database = this.database()
    database.transaction(() => {
      database.prepare(
        `UPDATE course_profiles SET project_id = ?, course_name = ?, exam_date = ?, updated_at = ?
          WHERE id = ? AND deleted_at IS NULL`
      ).run(input.projectId, input.courseName, input.examDate, now, id)
      const textbook = database.prepare('SELECT id FROM textbooks WHERE course_profile_id = ?').get(id) as { id: string } | undefined
      if (textbook) {
        database.prepare(
          `UPDATE textbooks SET title = ?, author = ?, edition = ?, isbn = ?, publisher = ?, updated_at = ?
            WHERE id = ?`
        ).run(input.textbook.title, input.textbook.author, input.textbook.edition, input.textbook.isbn, input.textbook.publisher, now, textbook.id)
      } else {
        database.prepare(
          `INSERT INTO textbooks(id, course_profile_id, title, author, edition, isbn, publisher, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(crypto.randomUUID(), id, input.textbook.title, input.textbook.author, input.textbook.edition, input.textbook.isbn, input.textbook.publisher, now, now)
      }
      this.insertAudit(database, 'course', id, 'updated', null, input, now)
    })()
  }

  trashCourse(id: string, now: string): boolean {
    return this.trashEntity('course_profiles', 'course', id, now, false)
  }

  listKnowledge(projectId: string): KnowledgeItem[] {
    const rows = this.database()
      .prepare(
        `SELECT id, project_id, milestone_id, title, content, mastery,
                last_reviewed_at, next_review_date, created_at, updated_at
           FROM knowledge_items
          WHERE project_id = ? AND deleted_at IS NULL AND archived_at IS NULL
          ORDER BY COALESCE(next_review_date, '9999-12-31'), created_at DESC`
      )
      .all(projectId) as KnowledgeRow[]
    return rows.map(mapKnowledge)
  }

  getKnowledge(id: string): KnowledgeItem | null {
    const row = this.database()
      .prepare(
        `SELECT id, project_id, milestone_id, title, content, mastery,
                last_reviewed_at, next_review_date, created_at, updated_at
           FROM knowledge_items WHERE id = ? AND deleted_at IS NULL`
      )
      .get(id) as KnowledgeRow | undefined
    return row ? mapKnowledge(row) : null
  }

  insertKnowledge(id: string, input: CreateKnowledgeInput, now: string): void {
    const database = this.database()
    const transaction = database.transaction(() => {
      database
        .prepare(
          `INSERT INTO knowledge_items(
             id, project_id, milestone_id, title, content, mastery, next_review_date,
             created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          input.projectId,
          input.milestoneId,
          input.title,
          input.content,
          input.mastery,
          input.nextReviewDate,
          now,
          now
        )
      if (input.nextReviewDate) {
        database
          .prepare(
            `INSERT INTO review_queue(
               id, entity_type, entity_id, scheduled_date, created_at, updated_at
             ) VALUES (?, 'knowledge', ?, ?, ?, ?)`
          )
          .run(crypto.randomUUID(), id, input.nextReviewDate, now, now)
      }
      this.upsertSearch(database, 'knowledge', id, input.title, input.content)
      this.insertAudit(database, 'knowledge', id, 'created', null, input, now)
    })
    transaction()
  }

  updateKnowledge(id: string, input: CreateKnowledgeInput, now: string): void {
    const database = this.database()
    database.transaction(() => {
      database.prepare(
        `UPDATE knowledge_items SET project_id = ?, milestone_id = ?, title = ?, content = ?,
           mastery = ?, next_review_date = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`
      ).run(input.projectId, input.milestoneId, input.title, input.content, input.mastery, input.nextReviewDate, now, id)
      database.prepare("DELETE FROM review_queue WHERE entity_type = 'knowledge' AND entity_id = ? AND status = 'pending'").run(id)
      if (input.nextReviewDate) {
        database.prepare(
          `INSERT OR IGNORE INTO review_queue(id, entity_type, entity_id, scheduled_date, created_at, updated_at)
           VALUES (?, 'knowledge', ?, ?, ?, ?)`
        ).run(crypto.randomUUID(), id, input.nextReviewDate, now, now)
      }
      this.upsertSearch(database, 'knowledge', id, input.title, input.content)
      this.insertAudit(database, 'knowledge', id, 'updated', null, input, now)
    })()
  }

  trashKnowledge(id: string, now: string): boolean {
    return this.trashEntity('knowledge_items', 'knowledge', id, now)
  }

  listMistakes(projectId: string): Mistake[] {
    const rows = this.database()
      .prepare(
        `SELECT id, project_id, knowledge_item_id, question, wrong_answer,
                correct_answer, analysis, mastery, next_review_date, created_at, updated_at
           FROM mistakes
          WHERE project_id = ? AND deleted_at IS NULL AND archived_at IS NULL
          ORDER BY COALESCE(next_review_date, '9999-12-31'), created_at DESC`
      )
      .all(projectId) as MistakeRow[]
    return rows.map(mapMistake)
  }

  getMistake(id: string): Mistake | null {
    const row = this.database()
      .prepare(
        `SELECT id, project_id, knowledge_item_id, question, wrong_answer,
                correct_answer, analysis, mastery, next_review_date, created_at, updated_at
           FROM mistakes WHERE id = ? AND deleted_at IS NULL`
      )
      .get(id) as MistakeRow | undefined
    return row ? mapMistake(row) : null
  }

  insertMistake(id: string, input: CreateMistakeInput, now: string): void {
    const database = this.database()
    const transaction = database.transaction(() => {
      database
        .prepare(
          `INSERT INTO mistakes(
             id, project_id, knowledge_item_id, question, wrong_answer, correct_answer,
             analysis, mastery, next_review_date, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          input.projectId,
          input.knowledgeItemId,
          input.question,
          input.wrongAnswer,
          input.correctAnswer,
          input.analysis,
          input.mastery,
          input.nextReviewDate,
          now,
          now
        )
      if (input.nextReviewDate) {
        database
          .prepare(
            `INSERT INTO review_queue(
               id, entity_type, entity_id, scheduled_date, created_at, updated_at
             ) VALUES (?, 'mistake', ?, ?, ?, ?)`
          )
          .run(crypto.randomUUID(), id, input.nextReviewDate, now, now)
      }
      this.upsertSearch(database, 'mistake', id, input.question.slice(0, 160), input.analysis)
      this.insertAudit(database, 'mistake', id, 'created', null, input, now)
    })
    transaction()
  }

  updateMistake(id: string, input: CreateMistakeInput, now: string): void {
    const database = this.database()
    database.transaction(() => {
      database.prepare(
        `UPDATE mistakes SET project_id = ?, knowledge_item_id = ?, question = ?, wrong_answer = ?,
           correct_answer = ?, analysis = ?, mastery = ?, next_review_date = ?, updated_at = ?
          WHERE id = ? AND deleted_at IS NULL`
      ).run(input.projectId, input.knowledgeItemId, input.question, input.wrongAnswer, input.correctAnswer,
        input.analysis, input.mastery, input.nextReviewDate, now, id)
      database.prepare("DELETE FROM review_queue WHERE entity_type = 'mistake' AND entity_id = ? AND status = 'pending'").run(id)
      if (input.nextReviewDate) {
        database.prepare(
          `INSERT OR IGNORE INTO review_queue(id, entity_type, entity_id, scheduled_date, created_at, updated_at)
           VALUES (?, 'mistake', ?, ?, ?, ?)`
        ).run(crypto.randomUUID(), id, input.nextReviewDate, now, now)
      }
      this.upsertSearch(database, 'mistake', id, input.question.slice(0, 160), input.analysis)
      this.insertAudit(database, 'mistake', id, 'updated', null, input, now)
    })()
  }

  trashMistake(id: string, now: string): boolean {
    return this.trashEntity('mistakes', 'mistake', id, now)
  }

  listLearningTests(projectId: string): LearningTest[] {
    return (
      this.database()
        .prepare(
          `SELECT id, project_id, milestone_id, title, score, max_score,
                  tested_at, note, created_at, updated_at
             FROM learning_tests
            WHERE project_id = ? AND deleted_at IS NULL
            ORDER BY tested_at DESC`
        )
        .all(projectId) as LearningTestRow[]
    ).map(mapLearningTest)
  }

  getLearningTest(id: string): LearningTest | null {
    const row = this.database()
      .prepare(
        `SELECT id, project_id, milestone_id, title, score, max_score,
                tested_at, note, created_at, updated_at
           FROM learning_tests WHERE id = ? AND deleted_at IS NULL`
      )
      .get(id) as LearningTestRow | undefined
    return row ? mapLearningTest(row) : null
  }

  insertLearningTest(
    id: string,
    input: CreateLearningTestInput,
    now: string
  ): void {
    this.database()
      .prepare(
        `INSERT INTO learning_tests(
           id, project_id, milestone_id, title, score, max_score, tested_at,
           note, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.projectId,
        input.milestoneId,
        input.title,
        input.score,
        input.maxScore,
        input.testedAt,
        input.note,
        now,
        now
      )
    this.insertAudit(this.database(), 'learning_test', id, 'created', null, input, now)
  }

  updateLearningTest(id: string, input: CreateLearningTestInput, now: string): void {
    this.database().prepare(
      `UPDATE learning_tests SET project_id = ?, milestone_id = ?, title = ?, score = ?,
         max_score = ?, tested_at = ?, note = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`
    ).run(input.projectId, input.milestoneId, input.title, input.score, input.maxScore, input.testedAt, input.note, now, id)
    this.insertAudit(this.database(), 'learning_test', id, 'updated', null, input, now)
  }

  trashLearningTest(id: string, now: string): boolean {
    return this.trashEntity('learning_tests', 'learning_test', id, now, false)
  }

  listReviewQueue(projectId: string): ReviewQueueItem[] {
    const rows = this.database()
      .prepare(
        `SELECT r.id, r.entity_type, r.entity_id,
                CASE r.entity_type
                  WHEN 'knowledge' THEN k.title
                  WHEN 'mistake' THEN SUBSTR(m.question, 1, 160)
                END AS title,
                r.scheduled_date, r.status, r.result,
                COALESCE(k.project_id, m.project_id) AS project_id,
                r.created_at, r.updated_at
           FROM review_queue r
           LEFT JOIN knowledge_items k
             ON r.entity_type = 'knowledge' AND k.id = r.entity_id
           LEFT JOIN mistakes m
             ON r.entity_type = 'mistake' AND m.id = r.entity_id
          WHERE COALESCE(k.project_id, m.project_id) = ?
          ORDER BY r.status = 'completed', r.scheduled_date, r.created_at`
      )
      .all(projectId) as ReviewQueueRow[]
    return rows.map(mapReviewQueue)
  }

  getReviewQueueItem(id: string): ReviewQueueItem | null {
    const row = this.database()
      .prepare(
        `SELECT r.id, r.entity_type, r.entity_id,
                CASE r.entity_type
                  WHEN 'knowledge' THEN k.title
                  WHEN 'mistake' THEN SUBSTR(m.question, 1, 160)
                END AS title,
                r.scheduled_date, r.status, r.result,
                COALESCE(k.project_id, m.project_id) AS project_id,
                r.created_at, r.updated_at
           FROM review_queue r
           LEFT JOIN knowledge_items k
             ON r.entity_type = 'knowledge' AND k.id = r.entity_id
           LEFT JOIN mistakes m
             ON r.entity_type = 'mistake' AND m.id = r.entity_id
          WHERE r.id = ?`
      )
      .get(id) as ReviewQueueRow | undefined
    return row ? mapReviewQueue(row) : null
  }

  recordReviewResult(
    item: ReviewQueueItem,
    input: RecordReviewResultInput,
    nextDate: string,
    mastery: number,
    now: string
  ): void {
    const database = this.database()
    const transaction = database.transaction(() => {
      database
        .prepare(
          `UPDATE review_queue SET status = 'completed', result = ?, updated_at = ?
            WHERE id = ? AND status = 'pending'`
        )
        .run(input.result, now, item.id)
      const table = item.entityType === 'knowledge' ? 'knowledge_items' : 'mistakes'
      if (item.entityType === 'knowledge') {
        database
          .prepare(
            `UPDATE knowledge_items
                SET mastery = ?, last_reviewed_at = ?, next_review_date = ?, updated_at = ?
              WHERE id = ?`
          )
          .run(mastery, input.reviewedAt, nextDate, now, item.entityId)
      } else {
        database
          .prepare(
            `UPDATE ${table}
                SET mastery = ?, next_review_date = ?, updated_at = ?
              WHERE id = ?`
          )
          .run(mastery, nextDate, now, item.entityId)
      }
      database
        .prepare(
          `INSERT OR IGNORE INTO review_queue(
             id, entity_type, entity_id, scheduled_date, status, created_at, updated_at
           ) VALUES (?, ?, ?, ?, 'pending', ?, ?)`
        )
        .run(crypto.randomUUID(), item.entityType, item.entityId, nextDate, now, now)
      this.insertAudit(database, item.entityType, item.entityId, 'reviewed', item, {
        result: input.result,
        mastery,
        nextDate
      }, now)
    })
    transaction()
  }

  private trashEntity(
    table: 'habit_rules' | 'metrics' | 'course_profiles' | 'knowledge_items' | 'mistakes' | 'learning_tests',
    entityType: 'habit' | 'metric' | 'course' | 'knowledge' | 'mistake' | 'learning_test',
    id: string,
    now: string,
    searchable = true
  ): boolean {
    const database = this.database()
    return database.transaction(() => {
      const result = database.prepare(
        `UPDATE ${table} SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`
      ).run(now, now, id)
      if (result.changes === 0) return false
      database.prepare(
        `INSERT INTO trash_entries(id, entity_type, entity_id, deleted_at) VALUES (?, ?, ?, ?)`
      ).run(crypto.randomUUID(), entityType, id, now)
      if (searchable) {
        database.prepare('DELETE FROM searchable_content WHERE entity_type = ? AND entity_id = ?').run(entityType, id)
      }
      this.insertAudit(database, entityType, id, 'trashed', null, null, now)
      return true
    })()
  }

  private upsertSearch(
    database: Database.Database,
    entityType: string,
    entityId: string,
    title: string,
    body: string
  ): void {
    database
      .prepare('DELETE FROM searchable_content WHERE entity_type = ? AND entity_id = ?')
      .run(entityType, entityId)
    database
      .prepare(
        'INSERT INTO searchable_content(entity_type, entity_id, title, body) VALUES (?, ?, ?, ?)'
      )
      .run(entityType, entityId, title, body)
  }

  private insertAudit(
    database: Database.Database,
    entityType: string,
    entityId: string,
    action: string,
    before: unknown,
    after: unknown,
    now: string
  ): void {
    database
      .prepare(
        `INSERT INTO audit_events(
           id, entity_type, entity_id, action, before_json, after_json, occurred_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        crypto.randomUUID(),
        entityType,
        entityId,
        action,
        before === null ? null : JSON.stringify(before),
        after === null ? null : JSON.stringify(after),
        now
      )
  }
}

export function mapHabit(row: HabitRow, currentStreak: number): Habit {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    description: row.description,
    frequency: row.frequency,
    targetCount: row.target_count,
    weekdays: JSON.parse(row.weekdays_json) as number[],
    reminderTime: row.reminder_time,
    startDate: row.start_date,
    endDate: row.end_date,
    todayStatus: row.today_status,
    totalCompleted: row.total_completed,
    currentStreak,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export function mapMetric(row: MetricRow): Metric {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    targetValue: row.target_value,
    unit: row.unit,
    direction: row.direction,
    period: row.period,
    currentValue: row.current_value ?? 0,
    lastRecordedAt: row.last_recorded_at,
    entryCount: row.entry_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export function mapCourse(row: CourseRow): Course {
  return {
    id: row.id,
    projectId: row.project_id,
    courseName: row.course_name,
    examDate: row.exam_date,
    textbook: row.textbook_id
      ? {
          id: row.textbook_id,
          title: row.textbook_title ?? '',
          author: row.author ?? '',
          edition: row.edition ?? '',
          isbn: row.isbn ?? '',
          publisher: row.publisher ?? ''
        }
      : null,
    knowledgeCount: row.knowledge_count,
    mistakeCount: row.mistake_count,
    pendingReviewCount: row.pending_review_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function mapKnowledge(row: KnowledgeRow): KnowledgeItem {
  return {
    id: row.id,
    projectId: row.project_id,
    milestoneId: row.milestone_id,
    title: row.title,
    content: row.content,
    mastery: row.mastery,
    lastReviewedAt: row.last_reviewed_at,
    nextReviewDate: row.next_review_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function mapMistake(row: MistakeRow): Mistake {
  return {
    id: row.id,
    projectId: row.project_id,
    knowledgeItemId: row.knowledge_item_id,
    question: row.question,
    wrongAnswer: row.wrong_answer,
    correctAnswer: row.correct_answer,
    analysis: row.analysis,
    mastery: row.mastery,
    nextReviewDate: row.next_review_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function mapLearningTest(row: LearningTestRow): LearningTest {
  return {
    id: row.id,
    projectId: row.project_id,
    milestoneId: row.milestone_id,
    title: row.title,
    score: row.score,
    maxScore: row.max_score,
    testedAt: row.tested_at,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function mapReviewQueue(row: ReviewQueueRow): ReviewQueueItem {
  return {
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    title: row.title,
    scheduledDate: row.scheduled_date,
    status: row.status,
    result: row.result,
    projectId: row.project_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}
