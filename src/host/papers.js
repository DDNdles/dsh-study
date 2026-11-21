import { randomUUID } from 'node:crypto'
import { transaction } from './db.js'
import { assertQuestion } from './validation.js'

const answerOrigins = new Set(['official', 'community', 'ai'])

export class PaperService {
  constructor({ db, allowAiVariants = false, excludeQuarantined = true }) {
    this.db = db
    this.allowAiVariants = allowAiVariants
    this.excludeQuarantined = excludeQuarantined
  }

  assemble(config = {}) {
    const mode = config.mode === 'topic' ? 'topic' : 'exam'
    const requested = Math.max(1, Math.min(500, Math.trunc(Number(config.count) || 10)))
    const rng = createRandom(config.seed ?? Date.now())
    const used = new Set()
    const defaultGrouped = !Array.isArray(config.sections) || !config.sections.length
    const sections = Array.isArray(config.sections) && config.sections.length
      ? config.sections.map((section, index) => ({
        title: String(section.title ?? `第 ${index + 1} 部分`),
        count: Math.max(0, Math.min(200, Math.trunc(Number(section.count) || 0))),
        score: Number(section.score) > 0 ? Number(section.score) : 10,
        filters: { ...config, ...section.filters },
      }))
      : [{ title: '', count: requested, score: Number(config.score) > 0 ? Number(config.score) : 10, filters: config }]
    const items = []
    const gaps = []

    for (const [sectionIndex, section] of sections.entries()) {
      const candidates = this.candidates(section.filters, config)
      shuffle(candidates, rng)
      const chosen = candidates.filter(item => !used.has(`${item.source_id}\0${item.question.id}`))
        .slice(0, section.count)
      if (defaultGrouped) {
        const order = { single: 1, multi: 2, blank: 3, solve: 4, proof: 5 }
        chosen.sort((a, b) => (order[a.question.type] ?? 9) - (order[b.question.type] ?? 9))
      }
      for (const item of chosen) {
        used.add(`${item.source_id}\0${item.question.id}`)
        items.push({
          ...item,
          section_index: defaultGrouped ? ({ single: 0, multi: 1, blank: 2, solve: 3, proof: 4 }[item.question.type] ?? 3) : sectionIndex,
          section_title: section.title || sectionTitleForType(item.question.type),
          score: section.score,
        })
      }
      if (chosen.length < section.count) {
        gaps.push({
          section: section.title || '全部题目',
          requested: section.count,
          available: candidates.length,
          missing: section.count - chosen.length,
          suggestions: relaxationSuggestions(section.filters),
        })
      }
    }

    const courseCodes = config.course_codes ?? []
    const courseLabel = this.courseNamesLabel(courseCodes)
    const fallbackTitle = courseLabel
      ? `《${courseLabel}》${mode === 'topic' ? '专题练习卷' : '模拟试卷'}`
      : (mode === 'topic' ? '专题练习卷' : '综合模拟试卷')
    const result = this.save({
      mode,
      title: String(config.title ?? '').trim() || fallbackTitle,
      courseCodes,
      config: {
        ...config,
        mode,
        seed: config.seed ?? null,
        gaps,
        allow_ai_variants: false,
      },
      items,
    })
    return { ...result, gaps }
  }

  assembleFromKeys({ title, mode = 'exam', items: requestedItems = [] } = {}) {
    if (!Array.isArray(requestedItems) || !requestedItems.length) {
      throw new Error('请至少选择一道题目')
    }
    const resolved = []
    const courseCodes = new Set()
    const order = { single: 1, multi: 2, blank: 3, solve: 4, proof: 5 }
    for (const entry of requestedItems) {
      const row = this.db.prepare('SELECT source_id, id, raw_json FROM questions WHERE source_id=? AND id=?')
        .get(entry.source_id, entry.question_id)
      if (!row) continue
      const question = JSON.parse(row.raw_json)
      courseCodes.add(question.course_code)
      resolved.push({
        source_id: row.source_id,
        question,
        score: Number(entry.score) > 0 ? Number(entry.score) : 10,
        section_index: ({ single: 0, multi: 1, blank: 2, solve: 3, proof: 4 }[question.type] ?? 3),
        section_title: entry.section_title || sectionTitleForType(question.type),
        comment_md: entry.comment_md ?? null,
        is_original_redo: Boolean(entry.is_original_redo),
        is_ai_variant: Boolean(entry.is_ai_variant),
      })
    }
    if (!resolved.length) throw new Error('所选题目不存在或已被移除')
    resolved.sort((a, b) => (order[a.question.type] ?? 9) - (order[b.question.type] ?? 9))
    const codes = [...courseCodes]
    const courseLabel = this.courseNamesLabel(codes)
    return this.save({
      mode,
      title: String(title ?? '').trim() || (courseLabel ? `《${courseLabel}》自选练习卷` : '自选练习卷'),
      courseCodes: codes,
      config: { mode, custom: true, allow_ai_variants: false },
      items: resolved,
    })
  }

  courseNamesLabel(courseCodes = []) {
    if (!courseCodes.length) return ''
    const names = courseCodes.map(code => {
      const row = this.db.prepare('SELECT name FROM courses WHERE code=? ORDER BY installed DESC LIMIT 1').get(code)
      return row?.name || code
    })
    return names.join('、')
  }

  taxonomyList(courseCodes = []) {
    const filter = courseCodes.length
      ? `WHERE course_code IN (${courseCodes.map(() => '?').join(',')})`
      : ''
    const rows = this.db.prepare(`
      SELECT DISTINCT course_code, kp_id, parent_id, level, name, chapter_ref
      FROM taxonomy ${filter}
      ORDER BY course_code, level, kp_id
    `).all(...courseCodes)
    const countFilter = courseCodes.length
      ? `WHERE q.course_code IN (${courseCodes.map(() => '?').join(',')}) AND q.quarantined=0`
      : 'WHERE q.quarantined=0'
    const directRows = this.db.prepare(`
      SELECT q.course_code, kp.kp_id, COUNT(DISTINCT q.source_id || char(0) || q.id) AS cnt
      FROM question_kp kp
      JOIN questions q ON q.source_id=kp.source_id AND q.id=kp.question_id
      ${countFilter}
      GROUP BY q.course_code, kp.kp_id
    `).all(...courseCodes)
    const directMap = new Map(directRows.map(r => [`${r.course_code}\0${r.kp_id}`, Number(r.cnt || 0)]))
    const childrenMap = new Map()
    for (const row of rows) {
      const parentKey = `${row.course_code}\0${row.parent_id ?? ''}`
      const list = childrenMap.get(parentKey) ?? []
      list.push(row)
      childrenMap.set(parentKey, list)
    }
    const totalCache = new Map()
    const computeTotal = row => {
      const key = `${row.course_code}\0${row.kp_id}`
      if (totalCache.has(key)) return totalCache.get(key)
      let sum = directMap.get(key) ?? 0
      for (const child of childrenMap.get(key) ?? []) sum += computeTotal(child)
      totalCache.set(key, sum)
      return sum
    }
    return rows.map(row => ({
      ...row,
      question_count: computeTotal(row),
    }))
  }

  updateComments(paperId, comments = []) {
    const paper = this.db.prepare('SELECT paper_id FROM papers WHERE paper_id=?').get(paperId)
    if (!paper) throw new Error('未找到指定试卷')
    const stmt = this.db.prepare('UPDATE paper_items SET comment_md=? WHERE paper_id=? AND seq=?')
    transaction(this.db, () => {
      for (const entry of comments) {
        stmt.run(String(entry.comment_md ?? '').trim() || null, paperId, Number(entry.seq))
      }
      this.db.prepare('UPDATE papers SET updated_at=? WHERE paper_id=?').run(new Date().toISOString(), paperId)
    })
    return this.get(paperId)
  }

  deletePaper(paperId) {
    return this.db.prepare('DELETE FROM papers WHERE paper_id=?').run(paperId).changes > 0
  }

  candidates(filters = {}, config = {}) {
    const where = []
    const params = []
    const addIn = (column, values) => {
      if (values?.length) {
        where.push(`${column} IN (${values.map(() => '?').join(',')})`)
        params.push(...values)
      }
    }
    addIn('q.source_id', filters.source_ids ?? config.source_ids)
    addIn('q.course_code', filters.course_codes ?? config.course_codes)
    addIn('q.type', filters.types)
    addIn('q.answer_origin', filters.answer_origins)
    addIn('q.source_kind', filters.source_kinds)
    addIn('q.source_exam_kind', filters.exam_kinds)
    if ((filters.exclude_quarantined ?? config.exclude_quarantined ?? this.excludeQuarantined) !== false) {
      where.push('q.quarantined=0')
    }
    if (Array.isArray(filters.exclude_batches) && filters.exclude_batches.length) {
      where.push(`q.source_batch NOT IN (${filters.exclude_batches.map(() => '?').join(',')})`)
      params.push(...filters.exclude_batches)
    }
    if (Number.isInteger(filters.difficulty_min)) {
      where.push('q.difficulty>=?')
      params.push(filters.difficulty_min)
    }
    if (Number.isInteger(filters.difficulty_max)) {
      where.push('q.difficulty<=?')
      params.push(filters.difficulty_max)
    }
    if (Number.isInteger(filters.year_from)) {
      where.push('q.source_year>=?')
      params.push(filters.year_from)
    }
    if (Number.isInteger(filters.year_to)) {
      where.push('q.source_year<=?')
      params.push(filters.year_to)
    }
    const allowedKps = this.expandTaxonomy(filters.course_codes ?? config.course_codes ?? [], filters.kp_ids ?? config.kp_ids ?? [])
    if (allowedKps.length) {
      where.push(`EXISTS (SELECT 1 FROM question_kp kp WHERE kp.source_id=q.source_id AND kp.question_id=q.id
        AND kp.kp_id IN (${allowedKps.map(() => '?').join(',')}))`)
      params.push(...allowedKps)
    }
    const rows = this.db.prepare(`
      SELECT q.source_id, q.id, q.raw_json
      FROM questions q
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    `).all(...params)
    return rows.map(row => ({
      source_id: row.source_id,
      question: JSON.parse(row.raw_json),
      is_original_redo: false,
      is_ai_variant: false,
    }))
  }

  expandTaxonomy(courseCodes, requestedKps) {
    if (!requestedKps.length) return []
    const courseFilter = courseCodes.length
      ? `AND course_code IN (${courseCodes.map(() => '?').join(',')})`
      : ''
    const rows = this.db.prepare(`SELECT course_code,kp_id,parent_id FROM taxonomy WHERE 1=1 ${courseFilter}`)
      .all(...courseCodes)
    const children = new Map()
    for (const row of rows) {
      const key = `${row.course_code}\0${row.parent_id ?? ''}`
      const list = children.get(key) ?? []
      list.push(row.kp_id)
      children.set(key, list)
    }
    const selected = new Set()
    for (const requested of requestedKps) {
      for (const row of rows.filter(item => item.kp_id === requested)) {
        const pending = [row.kp_id]
        while (pending.length) {
          const id = pending.pop()
          const key = `${row.course_code}\0${id}`
          if (selected.has(key)) continue
          selected.add(key)
          for (const child of children.get(key) ?? []) pending.push(child)
        }
      }
    }
    return [...selected].map(key => key.slice(key.indexOf('\0') + 1))
  }

  proposeVariant({ paper_id, question, score = 10 }, request = {}) {
    if (!this.allowAiVariants || request.allow_ai_variants !== true) {
      throw new Error('AI variants require both the global setting and explicit per-paper opt-in')
    }
    const paper = this.db.prepare('SELECT paper_id FROM papers WHERE paper_id=?').get(paper_id)
    if (!paper) throw new Error(`Unknown paper: ${paper_id}`)
    const variant = structuredClone(question)
    variant.answer.origin = 'ai'
    variant.answer.origin_detail = String(variant.answer.origin_detail || 'AI-generated variant')
    variant.source.batch = 'ai_variant'
    variant.quality.note = 'AI-generated variant'
    assertQuestion(variant)
    const draftId = randomUUID()
    this.db.prepare(`
      INSERT INTO variant_drafts(draft_id,paper_id,question_json,score,created_at)
      VALUES(?,?,?,?,?)
    `).run(draftId, paper_id, JSON.stringify(variant), Number(score) || 10, new Date().toISOString())
    return { draft_id: draftId, paper_id, question: variant, requires_confirmation: true }
  }

  confirmVariant(draftId) {
    const draft = this.db.prepare('SELECT * FROM variant_drafts WHERE draft_id=?').get(draftId)
    if (!draft) throw new Error(`Unknown or already confirmed variant: ${draftId}`)
    const question = JSON.parse(draft.question_json)
    if (question.answer.origin !== 'ai' || question.source.batch !== 'ai_variant') {
      throw new Error('AI variant markers are missing')
    }
    let seq
    transaction(this.db, () => {
      const row = this.db.prepare('SELECT max(seq) AS value FROM paper_items WHERE paper_id=?').get(draft.paper_id)
      seq = (row.value ?? 0) + 1
      this.db.prepare(`
        INSERT INTO paper_items(paper_id,seq,section_index,section_title,sub_seq,source_id,question_id,
          score,is_original_redo,is_ai_variant,question_snapshot_json)
        VALUES(?,?,0,'AI 变式',?,?,?, ?,0,1,?)
      `).run(draft.paper_id, seq, seq, 'local-ai-variant', question.id, draft.score, JSON.stringify(question))
      this.db.prepare('DELETE FROM variant_drafts WHERE draft_id=?').run(draftId)
    })
    return { paper_id: draft.paper_id, seq, question }
  }

  save({ mode, title, courseCodes, config, items }) {
    const now = new Date().toISOString()
    const paperId = randomUUID()
    transaction(this.db, () => {
      this.db.prepare(`
        INSERT INTO papers(paper_id,title,mode,course_codes_json,header_meta_json,config_json,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?)
      `).run(paperId, title, mode, JSON.stringify(courseCodes), JSON.stringify(config.header ?? {}),
        JSON.stringify(config), now, now)
      const add = this.db.prepare(`
        INSERT INTO paper_items(paper_id,seq,section_index,section_title,sub_seq,source_id,
          question_id,score,is_original_redo,is_ai_variant,comment_md,question_snapshot_json)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
      `)
      items.forEach((item, index) => add.run(
        paperId, index + 1, item.section_index ?? 0, item.section_title ?? '题目', index + 1,
        item.source_id, item.question.id, item.score ?? 10, item.is_original_redo ? 1 : 0,
        item.is_ai_variant ? 1 : 0, item.comment_md ?? null, JSON.stringify(item.question),
      ))
    })
    return {
      paper_id: paperId,
      title,
      mode,
      assembled: items.length,
      items,
      config,
    }
  }

  updateItems(paperId, updates) {
    if (!Array.isArray(updates) || updates.length === 0) throw new Error('Paper items are required')
    const existing = this.db.prepare('SELECT seq,source_id,question_id FROM paper_items WHERE paper_id=? ORDER BY seq')
      .all(paperId)
    if (existing.length !== updates.length) throw new Error('The paper item list changed; refresh before editing')
    const bySeq = new Map(existing.map(item => [item.seq, item]))
    const seen = new Set()
    const normalized = updates.map(item => {
      const source = bySeq.get(item.seq)
      const score = Number(item.score)
      if (!source || seen.has(item.seq)) throw new Error('Paper item order contains an unknown or duplicate item')
      if (!Number.isFinite(score) || score < 0 || score > 1000) throw new Error('Item score must be between 0 and 1000')
      seen.add(item.seq)
      return { ...source, score }
    })
    transaction(this.db, () => {
      const offset = existing.length + 1
      const move = this.db.prepare('UPDATE paper_items SET seq=? WHERE paper_id=? AND seq=?')
      for (const [index, item] of normalized.entries()) move.run(offset + index, paperId, item.seq)
      const save = this.db.prepare('UPDATE paper_items SET seq=?,sub_seq=?,score=? WHERE paper_id=? AND seq=?')
      for (const [index, item] of normalized.entries()) {
        save.run(index + 1, index + 1, item.score, paperId, offset + index)
      }
      this.db.prepare('UPDATE papers SET updated_at=? WHERE paper_id=?').run(new Date().toISOString(), paperId)
    })
    return this.get(paperId)
  }

  get(paperId) {
    const paper = this.db.prepare('SELECT * FROM papers WHERE paper_id=?').get(paperId)
    if (!paper) return null
    const items = this.db.prepare('SELECT * FROM paper_items WHERE paper_id=? ORDER BY seq').all(paperId)
      .map(item => ({ ...item, question: JSON.parse(item.question_snapshot_json) }))
    return {
      ...paper,
      course_codes: JSON.parse(paper.course_codes_json),
      config: JSON.parse(paper.config_json),
      header_meta: JSON.parse(paper.header_meta_json),
      items,
    }
  }

  list() {
    return this.db.prepare('SELECT * FROM papers ORDER BY updated_at DESC')
      .all().map(paper => ({
        ...paper,
        course_codes: JSON.parse(paper.course_codes_json),
        item_count: this.db.prepare('SELECT count(*) AS value FROM paper_items WHERE paper_id=?').get(paper.paper_id).value,
      }))
  }
}

function relaxationSuggestions(filters) {
  const suggestions = []
  if (filters.year_from || filters.year_to) suggestions.push('放宽年份范围')
  if (filters.answer_origins?.length) suggestions.push('允许更多答案来源')
  if (filters.exclude_batches?.length) suggestions.push('检查排除批次')
  if (filters.difficulty_min || filters.difficulty_max) suggestions.push('放宽难度区间')
  if (filters.kp_ids?.length) suggestions.push('选择父级或相邻知识点')
  return suggestions
}

function createRandom(seed) {
  let state = typeof seed === 'number' ? seed >>> 0 : hashSeed(String(seed))
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

function hashSeed(value) {
  let hash = 2166136261
  for (const char of value) {
    hash ^= char.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function shuffle(values, random) {
  for (let index = values.length - 1; index > 0; index--) {
    const target = Math.floor(random() * (index + 1))
    ;[values[index], values[target]] = [values[target], values[index]]
  }
}

function sectionTitleForType(type) {
  return ({
    single: '单项选择题',
    multi: '多项选择题',
    blank: '填空题',
    solve: '计算与解答题',
    proof: '证明题',
  })[type] ?? '解答题'
}

export { answerOrigins, sectionTitleForType }
