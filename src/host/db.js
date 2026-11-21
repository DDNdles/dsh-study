import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const schema = `
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = FULL;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER NOT NULL
);
INSERT INTO schema_version SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM schema_version);

CREATE TABLE IF NOT EXISTS sources (
  source_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  transport TEXT NOT NULL,
  location TEXT NOT NULL,
  ref TEXT,
  mirror_url TEXT,
  asset_base_url TEXT,
  manifest_json TEXT,
  data_version TEXT,
  last_synced_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS courses (
  source_id TEXT NOT NULL REFERENCES sources(source_id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  name_en TEXT NOT NULL,
  department TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  total_questions INTEGER NOT NULL,
  meta_json TEXT NOT NULL,
  meta_sha256 TEXT,
  taxonomy_sha256 TEXT,
  questions_sha256 TEXT,
  installed INTEGER NOT NULL DEFAULT 0,
  installed_at TEXT,
  PRIMARY KEY (source_id, code)
);

CREATE TABLE IF NOT EXISTS taxonomy (
  source_id TEXT NOT NULL,
  course_code TEXT NOT NULL,
  kp_id TEXT NOT NULL,
  parent_id TEXT,
  level INTEGER NOT NULL,
  name TEXT NOT NULL,
  chapter_ref TEXT,
  PRIMARY KEY (source_id, course_code, kp_id),
  FOREIGN KEY (source_id, course_code) REFERENCES courses(source_id, code) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS questions (
  source_id TEXT NOT NULL,
  id TEXT NOT NULL,
  course_code TEXT NOT NULL,
  type TEXT NOT NULL,
  stem_md TEXT NOT NULL,
  answer_md TEXT NOT NULL,
  answer_origin TEXT NOT NULL,
  answer_origin_detail TEXT NOT NULL,
  solution_md TEXT NOT NULL,
  difficulty INTEGER NOT NULL,
  source_kind TEXT NOT NULL,
  source_batch TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  source_year INTEGER,
  source_term TEXT,
  source_exam_kind TEXT,
  source_url TEXT,
  source_rights TEXT NOT NULL,
  quarantined INTEGER NOT NULL,
  quarantine_reason TEXT,
  confidence REAL,
  note TEXT,
  overlap_hint TEXT,
  has_figures INTEGER NOT NULL DEFAULT 0,
  raw_json TEXT NOT NULL,
  PRIMARY KEY (source_id, id),
  FOREIGN KEY (source_id, course_code) REFERENCES courses(source_id, code) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS questions_course ON questions(source_id, course_code, type, difficulty);

CREATE TABLE IF NOT EXISTS question_kp (
  source_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  course_code TEXT NOT NULL,
  kp_id TEXT NOT NULL,
  PRIMARY KEY (source_id, question_id, kp_id),
  FOREIGN KEY (source_id, question_id) REFERENCES questions(source_id, id) ON DELETE CASCADE
);

CREATE VIRTUAL TABLE IF NOT EXISTS questions_fts USING fts5(
  source_id UNINDEXED,
  id UNINDEXED,
  course_code UNINDEXED,
  stem_md,
  answer_md,
  solution_md,
  source_ref,
  keywords,
  tokenize='unicode61'
);

CREATE TABLE IF NOT EXISTS mistakes (
  mistake_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  course_code TEXT NOT NULL,
  question_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unmastered',
  wrong_count INTEGER NOT NULL DEFAULT 1,
  review_count INTEGER NOT NULL DEFAULT 0,
  ease_factor REAL NOT NULL DEFAULT 2.5,
  interval_days INTEGER NOT NULL DEFAULT 1,
  next_review_at TEXT NOT NULL,
  last_wrong_at TEXT NOT NULL,
  last_reviewed_at TEXT,
  error_tags_json TEXT NOT NULL DEFAULT '[]',
  wrong_attempt_md TEXT NOT NULL DEFAULT '',
  reflection_md TEXT NOT NULL DEFAULT '',
  question_snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (source_id, question_id)
);

CREATE TABLE IF NOT EXISTS mistake_reviews (
  review_id TEXT PRIMARY KEY,
  mistake_id TEXT NOT NULL REFERENCES mistakes(mistake_id) ON DELETE CASCADE,
  rating TEXT NOT NULL,
  note_md TEXT NOT NULL DEFAULT '',
  reviewed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mistake_drafts (
  draft_id TEXT PRIMARY KEY,
  question_json TEXT NOT NULL,
  error_tags_json TEXT NOT NULL,
  wrong_attempt_md TEXT NOT NULL,
  reflection_md TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS variant_drafts (
  draft_id TEXT PRIMARY KEY,
  paper_id TEXT NOT NULL,
  question_json TEXT NOT NULL,
  score REAL NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS papers (
  paper_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  mode TEXT NOT NULL,
  course_codes_json TEXT NOT NULL,
  header_meta_json TEXT NOT NULL,
  config_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS paper_items (
  paper_id TEXT NOT NULL REFERENCES papers(paper_id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  section_index INTEGER NOT NULL,
  section_title TEXT NOT NULL,
  sub_seq INTEGER NOT NULL,
  source_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  score REAL NOT NULL,
  is_original_redo INTEGER NOT NULL DEFAULT 0,
  is_ai_variant INTEGER NOT NULL DEFAULT 0,
  comment_md TEXT,
  question_snapshot_json TEXT NOT NULL,
  PRIMARY KEY (paper_id, seq)
);

CREATE TABLE IF NOT EXISTS exports (
  export_id TEXT PRIMARY KEY,
  paper_id TEXT NOT NULL REFERENCES papers(paper_id) ON DELETE CASCADE,
  format TEXT NOT NULL,
  template_id TEXT NOT NULL,
  export_mode TEXT NOT NULL,
  options_json TEXT NOT NULL,
  artifacts_json TEXT NOT NULL,
  status TEXT NOT NULL,
  degraded_reason TEXT,
  log_excerpt TEXT,
  created_at TEXT NOT NULL
);
`

export function createDatabase(dataDir) {
  const dbDir = path.join(dataDir, 'db')
  fs.mkdirSync(dbDir, { recursive: true })
  const db = new DatabaseSync(path.join(dbDir, 'study.sqlite'))
  db.exec(schema)
  const version = db.prepare('SELECT version FROM schema_version').get()?.version
  if (version !== 1) throw new Error(`Unsupported dsh-study database schema ${version}`)
  return db
}

export function transaction(db, operation) {
  db.exec('BEGIN IMMEDIATE')
  try {
    const value = operation()
    db.exec('COMMIT')
    return value
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export function upsertQuestion(db, sourceId, question) {
  const { source, tags, stem, answer, solution, quality } = question
  const statement = db.prepare(`
    INSERT INTO questions (
      source_id, id, course_code, type, stem_md, answer_md, answer_origin,
      answer_origin_detail, solution_md, difficulty, source_kind, source_batch,
      source_ref, source_year, source_term, source_exam_kind, source_url,
      source_rights, quarantined, quarantine_reason, confidence, note, overlap_hint,
      has_figures, raw_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_id, id) DO UPDATE SET
      course_code=excluded.course_code, type=excluded.type, stem_md=excluded.stem_md,
      answer_md=excluded.answer_md, answer_origin=excluded.answer_origin,
      answer_origin_detail=excluded.answer_origin_detail, solution_md=excluded.solution_md,
      difficulty=excluded.difficulty, source_kind=excluded.source_kind,
      source_batch=excluded.source_batch, source_ref=excluded.source_ref,
      source_year=excluded.source_year, source_term=excluded.source_term,
      source_exam_kind=excluded.source_exam_kind, source_url=excluded.source_url,
      source_rights=excluded.source_rights, quarantined=excluded.quarantined,
      quarantine_reason=excluded.quarantine_reason, confidence=excluded.confidence,
      note=excluded.note, overlap_hint=excluded.overlap_hint,
      has_figures=excluded.has_figures, raw_json=excluded.raw_json
  `)
  statement.run(
    sourceId, question.id, question.course_code, question.type, stem.md, answer.md,
    answer.origin, answer.origin_detail, solution.md, tags.difficulty, source.kind,
    source.batch, source.ref, source.year, source.term, source.exam_kind, source.url,
    source.rights, quality.quarantined ? 1 : 0, quality.quarantine_reason,
    quality.confidence, quality.note, quality.overlap_hint,
    stem.figures.length || answer.figures.length || solution.figures.length ? 1 : 0,
    JSON.stringify(question)
  )
  db.prepare('DELETE FROM question_kp WHERE source_id=? AND question_id=?').run(sourceId, question.id)
  const addKp = db.prepare('INSERT INTO question_kp(source_id, question_id, course_code, kp_id) VALUES(?,?,?,?)')
  for (const kpId of tags.kp_ids) addKp.run(sourceId, question.id, question.course_code, kpId)

  db.prepare('DELETE FROM questions_fts WHERE source_id=? AND id=?').run(sourceId, question.id)
  db.prepare(`
    INSERT INTO questions_fts(source_id, id, course_code, stem_md, answer_md, solution_md, source_ref, keywords)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(sourceId, question.id, question.course_code, stem.md, answer.md, solution.md,
    source.ref, tags.keywords.join(' '))
}

export function getQuestion(db, sourceId, questionId) {
  const row = db.prepare('SELECT raw_json FROM questions WHERE source_id=? AND id=?').get(sourceId, questionId)
  return row ? JSON.parse(row.raw_json) : null
}
