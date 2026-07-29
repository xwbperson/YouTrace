export const CURRENT_SCHEMA_VERSION = 4

export const INITIAL_SCHEMA_SQL = `
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS workspace_settings (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS areas (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT,
    icon TEXT,
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    archived_at TEXT,
    deleted_at TEXT
  );

  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    area_id TEXT REFERENCES areas(id),
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL,
    start_date TEXT,
    target_date TEXT,
    success_criteria TEXT NOT NULL DEFAULT '',
    progress_mode TEXT NOT NULL DEFAULT 'equal',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    archived_at TEXT,
    deleted_at TEXT
  );

  CREATE TABLE IF NOT EXISTS goals (
    id TEXT PRIMARY KEY,
    project_id TEXT REFERENCES projects(id),
    title TEXT NOT NULL,
    success_criteria TEXT NOT NULL DEFAULT '',
    target_date TEXT,
    measure_type TEXT NOT NULL DEFAULT 'milestone',
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    archived_at TEXT,
    deleted_at TEXT
  );

  CREATE TABLE IF NOT EXISTS milestones (
    id TEXT PRIMARY KEY,
    project_id TEXT REFERENCES projects(id),
    goal_id TEXT REFERENCES goals(id),
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    planned_date TEXT,
    completed_date TEXT,
    estimated_minutes INTEGER,
    manual_weight REAL,
    mastery INTEGER CHECK (mastery IS NULL OR (mastery >= 0 AND mastery <= 100)),
    verification_criteria TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL,
    include_in_progress INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    archived_at TEXT,
    deleted_at TEXT
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    parent_task_id TEXT REFERENCES tasks(id),
    project_id TEXT REFERENCES projects(id),
    goal_id TEXT REFERENCES goals(id),
    milestone_id TEXT REFERENCES milestones(id),
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL,
    difficulty INTEGER CHECK (difficulty IS NULL OR (difficulty BETWEEN 1 AND 5)),
    priority TEXT NOT NULL DEFAULT 'medium',
    estimated_minutes INTEGER,
    progress_weight REAL,
    start_date TEXT,
    due_at TEXT,
    verification_criteria TEXT NOT NULL DEFAULT '',
    include_in_progress INTEGER NOT NULL DEFAULT 1,
    completed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    archived_at TEXT,
    deleted_at TEXT
  );

  CREATE TABLE IF NOT EXISTS task_dependencies (
    task_id TEXT NOT NULL REFERENCES tasks(id),
    prerequisite_task_id TEXT NOT NULL REFERENCES tasks(id),
    override_reason TEXT,
    created_at TEXT NOT NULL,
    PRIMARY KEY (task_id, prerequisite_task_id),
    CHECK (task_id <> prerequisite_task_id)
  );

  CREATE TABLE IF NOT EXISTS tags (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL COLLATE NOCASE,
    color TEXT,
    icon TEXT,
    description TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    favorite INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    archived_at TEXT,
    deleted_at TEXT
  );

  CREATE UNIQUE INDEX IF NOT EXISTS tags_active_name_unique
    ON tags(name)
    WHERE archived_at IS NULL AND deleted_at IS NULL;

  CREATE TABLE IF NOT EXISTS tag_assignments (
    tag_id TEXT NOT NULL REFERENCES tags(id),
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (tag_id, entity_type, entity_id)
  );

  CREATE TABLE IF NOT EXISTS effort_entries (
    id TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL,
    entity_id TEXT,
    source TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    effective_minutes INTEGER NOT NULL DEFAULT 0,
    energy INTEGER,
    perceived_difficulty INTEGER,
    result TEXT NOT NULL DEFAULT '',
    interruptions TEXT NOT NULL DEFAULT '',
    obstacles TEXT NOT NULL DEFAULT '',
    next_step TEXT NOT NULL DEFAULT '',
    entity_title_snapshot TEXT,
    project_id_snapshot TEXT,
    voided_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  );

  CREATE TABLE IF NOT EXISTS habit_rules (
    id TEXT PRIMARY KEY,
    project_id TEXT REFERENCES projects(id),
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    frequency TEXT NOT NULL,
    target_count INTEGER NOT NULL DEFAULT 1,
    weekdays_json TEXT NOT NULL DEFAULT '[]',
    reminder_time TEXT,
    start_date TEXT NOT NULL,
    end_date TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    archived_at TEXT,
    deleted_at TEXT
  );

  CREATE TABLE IF NOT EXISTS habit_instances (
    id TEXT PRIMARY KEY,
    habit_rule_id TEXT NOT NULL REFERENCES habit_rules(id),
    scheduled_date TEXT NOT NULL,
    status TEXT NOT NULL,
    completed_at TEXT,
    skip_reason TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(habit_rule_id, scheduled_date)
  );

  CREATE TABLE IF NOT EXISTS metrics (
    id TEXT PRIMARY KEY,
    project_id TEXT REFERENCES projects(id),
    name TEXT NOT NULL,
    target_value REAL NOT NULL,
    unit TEXT NOT NULL,
    direction TEXT NOT NULL,
    period TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    archived_at TEXT,
    deleted_at TEXT
  );

  CREATE TABLE IF NOT EXISTS metric_entries (
    id TEXT PRIMARY KEY,
    metric_id TEXT NOT NULL REFERENCES metrics(id),
    value REAL NOT NULL,
    recorded_at TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS evidence (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    source TEXT,
    verification_status TEXT NOT NULL DEFAULT 'prepared',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  );

  CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY,
    relative_path TEXT NOT NULL UNIQUE,
    original_name TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    mime_type TEXT,
    created_at TEXT NOT NULL,
    pending_cleanup_at TEXT
  );

  CREATE TABLE IF NOT EXISTS entity_attachments (
    attachment_id TEXT NOT NULL REFERENCES attachments(id),
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (attachment_id, entity_type, entity_id)
  );

  CREATE TABLE IF NOT EXISTS entity_evidence (
    evidence_id TEXT NOT NULL REFERENCES evidence(id),
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (evidence_id, entity_type, entity_id)
  );

  CREATE TABLE IF NOT EXISTS memos (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL DEFAULT 'memo',
    title TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL,
    inbox INTEGER NOT NULL DEFAULT 1,
    processed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    archived_at TEXT,
    deleted_at TEXT
  );

  CREATE TABLE IF NOT EXISTS entity_relations (
    source_type TEXT NOT NULL,
    source_id TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    relation_type TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (source_type, source_id, target_type, target_id, relation_type)
  );

  CREATE TABLE IF NOT EXISTS countdowns (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    target_at TEXT NOT NULL,
    timezone TEXT NOT NULL,
    workday_rule_json TEXT NOT NULL DEFAULT '{}',
    buffer_days INTEGER NOT NULL DEFAULT 0,
    importance TEXT NOT NULL DEFAULT 'normal',
    entity_type TEXT,
    entity_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    archived_at TEXT,
    deleted_at TEXT
  );

  CREATE TABLE IF NOT EXISTS countdown_workload (
    countdown_id TEXT PRIMARY KEY REFERENCES countdowns(id),
    remaining_minutes INTEGER,
    recent_window_days INTEGER NOT NULL DEFAULT 28,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS plan_periods (
    id TEXT PRIMARY KEY,
    period_type TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    title TEXT NOT NULL,
    focus_result TEXT NOT NULL DEFAULT '',
    capacity_minutes INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    archived_at TEXT,
    deleted_at TEXT
  );

  CREATE TABLE IF NOT EXISTS plan_items (
    id TEXT PRIMARY KEY,
    plan_id TEXT NOT NULL REFERENCES plan_periods(id),
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    title_snapshot TEXT NOT NULL,
    committed INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    UNIQUE(plan_id, entity_type, entity_id)
  );

  CREATE TABLE IF NOT EXISTS time_blocks (
    id TEXT PRIMARY KEY,
    task_id TEXT REFERENCES tasks(id),
    title TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    starts_at TEXT NOT NULL,
    ends_at TEXT NOT NULL,
    timezone TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    CHECK (ends_at > starts_at)
  );

  CREATE INDEX IF NOT EXISTS time_blocks_range_index
    ON time_blocks(starts_at, ends_at)
    WHERE deleted_at IS NULL;

  CREATE TABLE IF NOT EXISTS reminder_rules (
    id TEXT PRIMARY KEY,
    source_type TEXT NOT NULL,
    source_id TEXT NOT NULL,
    trigger_at TEXT NOT NULL,
    timezone TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    quiet_policy TEXT NOT NULL DEFAULT 'defer',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(source_type, source_id, trigger_at)
  );

  CREATE TABLE IF NOT EXISTS reminder_events (
    id TEXT PRIMARY KEY,
    rule_id TEXT NOT NULL REFERENCES reminder_rules(id),
    scheduled_at TEXT NOT NULL,
    fired_at TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    dedupe_key TEXT NOT NULL UNIQUE,
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS course_profiles (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL UNIQUE REFERENCES projects(id),
    course_name TEXT NOT NULL,
    exam_date TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS textbooks (
    id TEXT PRIMARY KEY,
    course_profile_id TEXT NOT NULL REFERENCES course_profiles(id),
    title TEXT NOT NULL,
    author TEXT NOT NULL DEFAULT '',
    edition TEXT NOT NULL DEFAULT '',
    isbn TEXT NOT NULL DEFAULT '',
    publisher TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS knowledge_items (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    milestone_id TEXT REFERENCES milestones(id),
    title TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    mastery INTEGER CHECK (mastery IS NULL OR (mastery BETWEEN 0 AND 100)),
    last_reviewed_at TEXT,
    next_review_date TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    archived_at TEXT,
    deleted_at TEXT
  );

  CREATE TABLE IF NOT EXISTS mistakes (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    knowledge_item_id TEXT REFERENCES knowledge_items(id),
    question TEXT NOT NULL,
    wrong_answer TEXT NOT NULL DEFAULT '',
    correct_answer TEXT NOT NULL DEFAULT '',
    analysis TEXT NOT NULL DEFAULT '',
    mastery INTEGER CHECK (mastery IS NULL OR (mastery BETWEEN 0 AND 100)),
    next_review_date TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    archived_at TEXT,
    deleted_at TEXT
  );

  CREATE TABLE IF NOT EXISTS learning_tests (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    milestone_id TEXT REFERENCES milestones(id),
    title TEXT NOT NULL,
    score REAL,
    max_score REAL,
    tested_at TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  );

  CREATE TABLE IF NOT EXISTS review_queue (
    id TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    scheduled_date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    result TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(entity_type, entity_id, scheduled_date)
  );

  CREATE TABLE IF NOT EXISTS audit_events (
    id TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL,
    entity_id TEXT,
    action TEXT NOT NULL,
    before_json TEXT,
    after_json TEXT,
    reason TEXT,
    occurred_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS trash_entries (
    id TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    parent_snapshot_json TEXT,
    deleted_at TEXT NOT NULL,
    purged_at TEXT
  );

  CREATE VIRTUAL TABLE IF NOT EXISTS searchable_content USING fts5(
    entity_type UNINDEXED,
    entity_id UNINDEXED,
    title,
    body,
    tokenize='trigram'
  );
`
