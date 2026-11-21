import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { assertMeta, assertQuestion } from './validation.js'
import { getQuestion, transaction, upsertQuestion } from './db.js'

const DAY_MS = 86_400_000
const ratings = new Set(['again', 'hard', 'good', 'easy'])

function nowIso() {
  return new Date().toISOString()
}

function addDays(date, days) {
  return new Date(new Date(date).getTime() + days * DAY_MS).toISOString()
}

function clampEase(value) {
  return Math.min(3, Math.max(1.3, value))
}

export class MistakeService {
  constructor({ db, dataDir }) {
    this.db = db
    this.dataDir = dataDir
    this.drafts = path.join(dataDir, 'personal', 'drafts')
  }

  mark({ source_id, question_id, error_tags = [], wrong_attempt_md = '', reflection_md = '' }) {
    const question = getQuestion(this.db, source_id, question_id)
    if (!question) throw new Error(`Question ${source_id}/${question_id} is not installed`)
    const now = nowIso()
    const prior = this.db.prepare('SELECT * FROM mistakes WHERE source_id=? AND question_id=?').get(source_id, question_id)
    if (!prior) {
      const mistakeId = randomUUID()
      this.db.prepare(`
        INSERT INTO mistakes(mistake_id,source_id,course_code,question_id,status,wrong_count,
          interval_days,next_review_at,last_wrong_at,error_tags_json,wrong_attempt_md,
          reflection_md,question_snapshot_json,created_at,updated_at)
        VALUES(?,?,?,?, 'unmastered',1,1,?,?,?,?,?,?,?,?)
      `).run(mistakeId, source_id, question.course_code, question_id, addDays(now, 1), now,
        JSON.stringify([...new Set(error_tags)]), wrong_attempt_md, reflection_md,
        JSON.stringify(question), now, now)
      return this.get(mistakeId)
    }
    this.db.prepare(`
      UPDATE mistakes SET status='unmastered', wrong_count=wrong_count+1, interval_days=1,
        next_review_at=?, last_wrong_at=?, error_tags_json=?, wrong_attempt_md=?,
        reflection_md=?, updated_at=? WHERE mistake_id=?
    `).run(addDays(now, 1), now, JSON.stringify([...new Set(error_tags)]),
      wrong_attempt_md, reflection_md, now, prior.mistake_id)
    return this.get(prior.mistake_id)
  }

  draft(input) {
    const question = structuredClone(input.question)
    assertCourseCode(question.course_code)
    const date = nowIso().slice(0, 10).replaceAll('-', '')
    question.id = `${question.course_code}-personal-${date}-${randomUUID().slice(0, 8)}`
    question.tags.kp_ids = [...new Set(question.tags.kp_ids?.length ? question.tags.kp_ids : ['personal-general'])]
    question.source.kind = 'notes'
    question.source.batch = 'personal_mistakes'
    question.source.ref ||= 'User-confirmed personal mistake'
    question.source.rights = 'original'
    assertQuestion(question)
    const now = nowIso()
    const draftId = randomUUID()
    const draft = {
      draft_id: draftId,
      question,
      error_tags: [...new Set(input.error_tags ?? [])],
      wrong_attempt_md: String(input.wrong_attempt_md ?? ''),
      reflection_md: String(input.reflection_md ?? ''),
      created_at: now,
    }
    this.db.prepare(`
      INSERT INTO mistake_drafts(draft_id,question_json,error_tags_json,wrong_attempt_md,reflection_md,created_at)
      VALUES(?,?,?,?,?,?)
    `).run(draftId, JSON.stringify(question), JSON.stringify(draft.error_tags),
      draft.wrong_attempt_md, draft.reflection_md, now)
    return draft
  }

  dismissDraft(draftId) {
    return this.db.prepare('DELETE FROM mistake_drafts WHERE draft_id=?').run(draftId).changes > 0
  }

  listDrafts() {
    return this.db.prepare('SELECT * FROM mistake_drafts ORDER BY created_at').all().map(row => ({
      draft_id: row.draft_id,
      question: JSON.parse(row.question_json),
      error_tags: JSON.parse(row.error_tags_json),
      wrong_attempt_md: row.wrong_attempt_md,
      reflection_md: row.reflection_md,
      created_at: row.created_at,
    }))
  }

  async commit(draftId, signal) {
    const row = this.db.prepare('SELECT * FROM mistake_drafts WHERE draft_id=?').get(draftId)
    if (!row) throw new Error(`Unknown or already committed draft ${draftId}`)
    const question = JSON.parse(row.question_json)
    assertQuestion(question)
    assertCourseCode(question.course_code)
    const dataDir = path.join(this.dataDir, 'personal', 'courses', question.course_code)
    await fs.mkdir(dataDir, { recursive: true })
    if (signal?.aborted) throw signal.reason ?? new Error('Commit was cancelled')
    const manifestPath = path.join(this.dataDir, 'personal', 'manifest.json')
    const coursePath = path.join(this.dataDir, 'personal', 'courses', question.course_code)
    const questionPath = path.join(coursePath, 'questions.jsonl')
    const taxonomyPath = path.join(coursePath, 'taxonomy.json')
    const metaPath = path.join(coursePath, 'meta.json')
    let manifest = await fs.readFile(manifestPath, 'utf8').then(JSON.parse, () => null)
    let meta = await fs.readFile(metaPath, 'utf8').then(JSON.parse, () => null)
    let taxonomy = await fs.readFile(taxonomyPath, 'utf8').then(JSON.parse, () => null)
    const existingQuestions = await fs.readFile(questionPath, 'utf8').then(content =>
      content.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)), () => [])
    const known = new Set(taxonomy?.nodes.map(node => node.id) ?? [])
    for (const kpId of question.tags.kp_ids) {
      if (known.has(kpId)) continue
      taxonomy ??= { schema_version: '1.0', course_code: question.course_code, nodes: [] }
      taxonomy.nodes.push({
        id: kpId, parent_id: null, level: 1, name: question.tags.keywords[0] ?? kpId, chapter_ref: null,
      })
      known.add(kpId)
    }
    existingQuestions.push(question)
    const now = nowIso()
    const questionText = `${existingQuestions.map(item => JSON.stringify(item)).join('\n')}\n`
    const nextTaxonomyText = `${JSON.stringify(taxonomy, null, 2)}\n`
    const nextMeta = buildCourseMeta(
      meta,
      question.course_code,
      taxonomy,
      existingQuestions,
      Buffer.from(questionText),
      Buffer.from(nextTaxonomyText),
    )
    assertMeta(nextMeta, question.course_code)
    const nextMetaText = `${JSON.stringify(nextMeta, null, 2)}\n`
    const nextManifest = updateManifest(manifest, question.course_code, nextMeta, taxonomy, existingQuestions,
      Buffer.from(nextMetaText), Buffer.from(nextTaxonomyText), Buffer.from(questionText), now)
    const nextManifestText = `${JSON.stringify(nextManifest, null, 2)}\n`
    const temporary = `.stage-${draftId}`
    const writes = [
      [path.join(coursePath, 'questions.jsonl'), `${questionPath}.${temporary}`, questionText],
      [taxonomyPath, `${taxonomyPath}.${temporary}`, nextTaxonomyText],
      [metaPath, `${metaPath}.${temporary}`, nextMetaText],
      [manifestPath, `${manifestPath}.${temporary}`, nextManifestText],
    ]
    try {
      await Promise.all(writes.map(([, temp, content]) => fs.writeFile(temp, content, 'utf8')))
      const restoreFiles = await replaceFiles(writes, draftId)
      try {
      transaction(this.db, () => {
        let source = this.db.prepare('SELECT source_id FROM sources WHERE source_id=?').get('local-personal')
        if (!source) {
          this.db.prepare(`INSERT INTO sources(source_id,name,transport,location,created_at) VALUES(?,?,?,?,?)`)
            .run('local-personal', 'Personal mistakes', 'personal', path.join(this.dataDir, 'personal'), now)
        }
        const courseRow = this.db.prepare('SELECT code FROM courses WHERE source_id=? AND code=?')
          .get('local-personal', question.course_code)
        if (!courseRow) {
          this.db.prepare(`
            INSERT INTO courses(source_id,code,name,name_en,department,category,description,total_questions,
              meta_json,installed,installed_at)
            VALUES('local-personal',?,?,?,?,?,?,?,?,1,?)
          `).run(question.course_code, nextMeta.name, nextMeta.name_en, nextMeta.department,
            nextMeta.category, nextMeta.description, existingQuestions.length, JSON.stringify(nextMeta), now)
        } else {
          this.db.prepare(`UPDATE courses SET total_questions=?,meta_json=?,installed=1,installed_at=?
            WHERE source_id='local-personal' AND code=?`)
            .run(existingQuestions.length, JSON.stringify(nextMeta), now, question.course_code)
        }
        this.db.prepare('DELETE FROM taxonomy WHERE source_id=? AND course_code=?')
          .run('local-personal', question.course_code)
        const addNode = this.db.prepare(`
          INSERT INTO taxonomy(source_id,course_code,kp_id,parent_id,level,name,chapter_ref) VALUES(?,?,?,?,?,?,?)
        `)
        for (const node of taxonomy.nodes) {
          addNode.run('local-personal', question.course_code, node.id, node.parent_id,
            node.level, node.name, node.chapter_ref)
        }
        upsertQuestion(this.db, 'local-personal', question)
        const mistakeId = randomUUID()
        this.db.prepare(`
          INSERT INTO mistakes(mistake_id,source_id,course_code,question_id,status,wrong_count,
            interval_days,next_review_at,last_wrong_at,error_tags_json,wrong_attempt_md,
            reflection_md,question_snapshot_json,created_at,updated_at)
          VALUES(?,?,?,?,'unmastered',1,1,?,?,?,?,?,?,?,?)
        `).run(mistakeId, 'local-personal', question.course_code, question.id, addDays(now, 1), now,
          row.error_tags_json, row.wrong_attempt_md, row.reflection_md, JSON.stringify(question), now, now)
        this.db.prepare('DELETE FROM mistake_drafts WHERE draft_id=?').run(draftId)
      })
      await restoreFiles(true)
      } catch (error) {
        await restoreFiles(false)
        throw error
      }
    } catch (error) {
      await Promise.all(writes.map(([, temp]) => fs.rm(temp, { force: true }).catch(() => {})))
      throw error
    }
    return { question_id: question.id, source_id: 'local-personal', mistake: this.list({ source_id: 'local-personal' }).find(item => item.question_id === question.id) }
  }

  list({ source_id, course_code, status, dueOnly = false, now = nowIso() } = {}) {
    const where = []
    const params = []
    if (source_id) { where.push('m.source_id=?'); params.push(source_id) }
    if (course_code) { where.push('m.course_code=?'); params.push(course_code) }
    if (status) { where.push('m.status=?'); params.push(status) }
    if (dueOnly) { where.push('m.next_review_at<=?'); params.push(now) }
    return this.db.prepare(`
      SELECT m.*, q.raw_json FROM mistakes m
      LEFT JOIN questions q ON q.source_id=m.source_id AND q.id=m.question_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY m.next_review_at, m.wrong_count DESC, m.last_wrong_at DESC
    `).all(...params).map(row => ({
      ...row,
      error_tags: JSON.parse(row.error_tags_json),
      question: row.raw_json ? JSON.parse(row.raw_json) : JSON.parse(row.question_snapshot_json),
      error_tags_json: undefined, question_snapshot_json: undefined, raw_json: undefined,
    }))
  }

  get(mistakeId) {
    return this.list().find(row => row.mistake_id === mistakeId) ?? null
  }

  delete(mistakeId) {
    return this.db.prepare('DELETE FROM mistakes WHERE mistake_id=?').run(mistakeId).changes > 0
  }

  update({ mistake_id, error_tags, wrong_attempt_md, reflection_md }) {
    const prior = this.db.prepare('SELECT * FROM mistakes WHERE mistake_id=?').get(mistake_id)
    if (!prior) throw new Error('未找到该错题记录')
    const now = nowIso()
    this.db.prepare(`
      UPDATE mistakes SET error_tags_json=?, wrong_attempt_md=?, reflection_md=?, updated_at=?
      WHERE mistake_id=?
    `).run(
      error_tags !== undefined ? JSON.stringify([...new Set(error_tags)]) : prior.error_tags_json,
      wrong_attempt_md !== undefined ? String(wrong_attempt_md) : prior.wrong_attempt_md,
      reflection_md !== undefined ? String(reflection_md) : prior.reflection_md,
      now, mistake_id,
    )
    return this.get(mistake_id)
  }

  review({ mistake_id, rating, note_md = '' }) {
    if (!ratings.has(rating)) throw new Error(`Rating must be one of ${[...ratings].join(', ')}`)
    const mistake = this.db.prepare('SELECT * FROM mistakes WHERE mistake_id=?').get(mistake_id)
    if (!mistake) throw new Error(`Unknown mistake: ${mistake_id}`)
    const next = scheduleReview(mistake, rating)
    const now = nowIso()
    transaction(this.db, () => {
      this.db.prepare(`
        UPDATE mistakes SET status=?, review_count=review_count+1, ease_factor=?, interval_days=?,
          next_review_at=?, last_reviewed_at=?, updated_at=? WHERE mistake_id=?
      `).run(next.status, next.ease_factor, next.interval_days, addDays(now, next.interval_days),
        now, now, mistake_id)
      this.db.prepare(`
        INSERT INTO mistake_reviews(review_id,mistake_id,rating,note_md,reviewed_at) VALUES(?,?,?,?,?)
      `).run(randomUUID(), mistake_id, rating, String(note_md), now)
    })
    return this.get(mistake_id)
  }

  assembleMistakes({ course_codes = [], count = 10, original_redo_ratio = 0.4, seed = Date.now(), ...options } = {}) {
    const now = nowIso()
    const mistakes = this.list({ dueOnly: false }).filter(row =>
      (!course_codes.length || course_codes.includes(row.course_code)) &&
      (!options.mistake_ids?.length || options.mistake_ids.includes(row.mistake_id)))
    const ranked = shuffle(mistakes, Number(seed)).sort((left, right) =>
      Number(Date.parse(right.next_review_at) <= Date.parse(now)) - Number(Date.parse(left.next_review_at) <= Date.parse(now)) ||
      Number(right.status === 'unmastered') - Number(left.status === 'unmastered') ||
      right.wrong_count - left.wrong_count ||
      right.last_wrong_at.localeCompare(left.last_wrong_at))
    const target = Math.max(1, Math.min(500, Math.trunc(Number(count) || 10)))
    const selected = ranked.slice(0, target)
    const originals = selected.slice(0, Math.round(target * Math.min(1, Math.max(0, original_redo_ratio))))
    const selectedKeys = new Set(selected.map(item => `${item.source_id}\0${item.question_id}`))
    const related = []
    for (const mistake of options.include_similar === false ? [] : selected) {
      for (const kpId of mistake.question.tags.kp_ids) {
        const rows = this.db.prepare(`
          SELECT DISTINCT q.source_id, q.id, q.raw_json
          FROM questions q JOIN question_kp kp ON kp.source_id=q.source_id AND kp.question_id=q.id
          WHERE kp.kp_id=? AND q.course_code=? AND NOT(q.source_id=? AND q.id=?)
            AND (?=0 OR q.quarantined=0)
          ORDER BY q.answer_origin='official' DESC, q.difficulty, q.id
          LIMIT 5
        `).all(kpId, mistake.course_code, mistake.source_id, mistake.question_id,
          options.exclude_quarantined === false ? 0 : 1)
        for (const row of rows) {
          const key = `${row.source_id}\0${row.id}`
          if (selectedKeys.has(key) || related.some(item => item.key === key)) continue
          related.push({ key, source_id: row.source_id, question: JSON.parse(row.raw_json), is_original_redo: false })
        }
      }
    }
    const items = [
      ...originals.map(item => ({
        source_id: item.source_id,
        question: item.question,
        mistake_id: item.mistake_id,
        is_original_redo: true,
        comment_md: [item.error_tags?.length ? `错因：${item.error_tags.join('、')}` : '', item.reflection_md].filter(Boolean).join('；') || null,
      })),
      ...related,
    ].slice(0, target)
    const courseNames = course_codes.map(code => {
      const row = this.db.prepare('SELECT name FROM courses WHERE code=? ORDER BY installed DESC LIMIT 1').get(code)
      return row?.name || code
    })
    const defaultTitle = courseNames.length ? `《${courseNames.join('、')}》错题巩固卷` : '错题巩固卷'
    const paper = this.savePaper({
      mode: 'mistake',
      title: String(options.title ?? '').trim() || defaultTitle,
      course_codes,
      items,
      config: { count: target, original_redo_ratio, seed, allow_ai_variants: false },
    })
    return {
      ...paper,
      gaps: paper.assembled < target ? [{ requested: target, assembled: paper.assembled, missing: target - paper.assembled }] : [],
    }
  }
}

function scheduleReview(mistake, rating) {
  const nextCount = mistake.review_count + 1
  let ease = mistake.ease_factor
  let interval = mistake.interval_days
  let status = 'reviewing'
  if (rating === 'again') {
    interval = 1
    ease = clampEase(ease - 0.2)
    status = 'unmastered'
  } else if (rating === 'hard') {
    interval = Math.max(1, Math.round(interval * 1.2))
    ease = clampEase(ease - 0.15)
  } else if (rating === 'good') {
    interval = nextCount === 1 ? 1 : nextCount === 2 ? 3 : Math.round(interval * ease)
    status = nextCount >= 2 ? 'mastered' : 'reviewing'
  } else {
    interval = Math.max(4, Math.round(interval * ease * 1.3))
    ease = clampEase(ease + 0.15)
    status = 'mastered'
  }
  return { status, interval_days: interval, ease_factor: ease }
}

function updateManifest(manifest, code, meta, taxonomy, questions, metaBytes, taxonomyBytes, questionBytes, now) {
  const course = {
    code,
    name: meta.name,
    name_en: meta.name_en,
    department: meta.department,
    category: meta.category,
    total: questions.length,
    quarantined: questions.filter(question => question.quality.quarantined).length,
    by_origin: Object.fromEntries(['official', 'community', 'ai'].map(origin => [
      origin, questions.filter(question => question.answer.origin === origin).length,
    ])),
    exam_years: [...new Set(questions.map(question => question.source.year).filter(Number.isInteger))].sort(),
    paths: {
      meta: `courses/${code}/meta.json`,
      taxonomy: `courses/${code}/taxonomy.json`,
      questions: `courses/${code}/questions.jsonl`,
    },
    sha256: {
      meta: digest(metaBytes),
      taxonomy: digest(taxonomyBytes),
      questions: digest(questionBytes),
    },
  }
  const courses = (manifest?.courses ?? []).filter(item => item.code !== code)
  courses.push(course)
  const questionCount = courses.reduce((total, item) => total + item.total, 0)
  return {
    name: 'Local personal questions',
    schema_version: '1.0',
    data_version: now,
    updated_at: now,
    repository: 'local-personal',
    asset_base_url: null,
    license: { code_and_schema: 'MIT', question_content: 'original' },
    stats: {
      courses: courses.length,
      questions: questionCount,
      quarantined: courses.reduce((total, item) => total + item.quarantined, 0),
      by_origin: Object.fromEntries(['official', 'community', 'ai'].map(origin => [
        origin, courses.reduce((total, item) => total + item.by_origin[origin], 0),
      ])),
    },
    courses,
  }
}

function buildCourseMeta(previous, code, taxonomy, questions, questionBytes, taxonomyBytes) {
  const byOrigin = Object.fromEntries(['official', 'community', 'ai'].map(origin => [
    origin, questions.filter(item => item.answer.origin === origin).length,
  ]))
  const byType = Object.fromEntries([...new Set(questions.map(item => item.type))]
    .map(type => [type, questions.filter(item => item.type === type).length]))
  const byDifficulty = Object.fromEntries([1, 2, 3, 4, 5].map(level => [
    String(level), questions.filter(item => item.tags.difficulty === level).length,
  ]))
  const batches = [...new Map(questions.map(item => [item.source.batch, item])).entries()]
    .map(([id, item]) => ({
      id,
      count: questions.filter(question => question.source.batch === id).length,
      rights: item.source.rights,
      description: item.source.ref,
    }))
  return {
    schema_version: '1.0',
    code,
    name: previous?.name ?? code,
    name_en: previous?.name_en ?? code,
    department: previous?.department ?? '',
    category: previous?.category ?? 'personal',
    description: previous?.description ?? 'User-confirmed personal mistakes',
    stats: {
      total: questions.length,
      quarantined: questions.filter(item => item.quality.quarantined).length,
      taxonomy_nodes: taxonomy.nodes.length,
      by_origin: byOrigin,
      by_type: byType,
      by_difficulty: byDifficulty,
      exam_years: [...new Set(questions.map(item => item.source.year).filter(Number.isInteger))].sort(),
    },
    batches,
    known_notes: previous?.known_notes ?? [],
    files: {
      questions: `courses/${code}/questions.jsonl`,
      taxonomy: `courses/${code}/taxonomy.json`,
    },
    sha256: {
      questions: digest(questionBytes),
      taxonomy: digest(taxonomyBytes),
    },
  }
}

async function replaceFiles(writes, token) {
  const backups = []
  try {
    for (const [target, temporary] of writes) {
      const backup = `${target}.${token}.bak`
      const existed = await fs.stat(target).then(() => true, () => false)
      if (existed) await fs.rename(target, backup)
      backups.push({ target, backup, existed, temporary })
      await fs.rename(temporary, target)
    }
  } catch (error) {
    await restore(backups, false)
    throw error
  }
  return committed => restore(backups, committed)
}

async function restore(backups, committed) {
  for (const entry of [...backups].reverse()) {
    if (committed) {
      if (entry.existed) await fs.rm(entry.backup, { force: true })
      continue
    }
    await fs.rm(entry.target, { force: true })
    if (entry.existed) await fs.rename(entry.backup, entry.target)
  }
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex')
}

function assertCourseCode(code) {
  if (typeof code !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(code)) {
    throw new Error('course_code must be 1-64 URL-safe characters')
  }
}

function shuffle(values, seed) {
  const result = [...values]
  let state = seed >>> 0
  const random = () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
  for (let index = result.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1))
    ;[result[index], result[swap]] = [result[swap], result[index]]
  }
  return result
}

MistakeService.prototype.savePaper = function savePaper({ mode, title, course_codes, items, config }) {
  const now = nowIso()
  const paperId = randomUUID()
  transaction(this.db, () => {
    this.db.prepare(`
      INSERT INTO papers(paper_id,title,mode,course_codes_json,header_meta_json,config_json,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?)
    `).run(paperId, title, mode, JSON.stringify(course_codes), JSON.stringify({}),
      JSON.stringify(config), now, now)
    const add = this.db.prepare(`
      INSERT INTO paper_items(paper_id,seq,section_index,section_title,sub_seq,source_id,
        question_id,score,is_original_redo,is_ai_variant,comment_md,question_snapshot_json)
      VALUES(?,?,?,?,?,?,?,?,?,0,?,?)
    `)
    const typeName = type => ({ single: '单项选择题', multi: '多项选择题', blank: '填空题', solve: '计算与解答题', proof: '证明题' })[type] ?? '解答题'
    const typeOrder = { single: 0, multi: 1, blank: 2, solve: 3, proof: 4 }
    const ordered = [...items].sort((a, b) => (typeOrder[a.question.type] ?? 3) - (typeOrder[b.question.type] ?? 3))
    ordered.forEach((item, index) => add.run(
      paperId, index + 1, typeOrder[item.question.type] ?? 3, typeName(item.question.type), index + 1,
      item.source_id, item.question.id, 10, item.is_original_redo ? 1 : 0,
      item.comment_md ?? null, JSON.stringify(item.question),
    ))
  })
  return { paper_id: paperId, title, mode, requested: config.count, assembled: items.length, items }
}

export { scheduleReview }
