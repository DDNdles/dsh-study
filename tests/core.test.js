import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createDatabase, getQuestion } from '../src/host/db.js'
import { LatexEnvService } from '../src/host/latex-env.js'
import { MistakeService, scheduleReview } from '../src/host/mistakes.js'
import { PaperService } from '../src/host/papers.js'
import { RenderService } from '../src/host/render.js'
import { SourceService } from '../src/host/sources.js'
import { questionDetails, searchQuestions } from '../src/host/tools.js'
import { assertManifest, assertQuestion } from '../src/host/validation.js'

const projectRoot = path.resolve(import.meta.dirname, '..')

function hash(value) {
  return createHash('sha256').update(value).digest('hex')
}

function question(id, stem = 'Compute the limit.') {
  return {
    id,
    course_code: 'MATH1006',
    schema_version: '1.0',
    type: 'solve',
    stem: {
      md: `${stem} $\\lim_{x\\to 0} x^2$`,
      figures: [{ id: `${id}-fig`, path: 'assets/diagram.png', alt: 'A simple diagram', sha256: hash(Buffer.from('study-image')) }],
    },
    options: [],
    answer: { md: '$0$', figures: [], origin: 'official', origin_detail: 'Official key' },
    solution: { md: 'By continuity, the limit is $0$.', steps: ['Substitute $x=0$.'], figures: [] },
    tags: { kp_ids: ['limit'], keywords: ['limit', 'calculus'], difficulty: 2 },
    source: {
      kind: 'exam_paper', batch: 'final-2024', ref: '2024 final', year: 2024,
      term: 'fall', exam_kind: 'final', url: null, rights: 'original',
    },
    quality: {
      quarantined: false, quarantine_reason: null, confidence: 0.95, note: null, overlap_hint: null,
    },
  }
}

async function makeBank(root, { sourceId = 'bank-a', questions = [question('MATH1006-q1')] } = {}) {
  const courseRoot = path.join(root, 'courses', 'MATH1006')
  await fs.mkdir(path.join(courseRoot, 'assets'), { recursive: true })
  const taxonomy = {
    schema_version: '1.0',
    course_code: 'MATH1006',
    nodes: [
      { id: 'calculus', parent_id: null, level: 1, name: 'Calculus', chapter_ref: null },
      { id: 'limit', parent_id: 'calculus', level: 2, name: 'Limits', chapter_ref: null },
    ],
  }
  const taxonomyBytes = Buffer.from(JSON.stringify(taxonomy))
  const questionBytes = Buffer.from(`${questions.map(item => JSON.stringify(item)).join('\n')}\n`)
  const byOrigin = { official: 0, community: 0, ai: 0 }
  const byType = {}
  const byDifficulty = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
  const batches = new Map()
  for (const item of questions) {
    byOrigin[item.answer.origin] += 1
    byType[item.type] = (byType[item.type] ?? 0) + 1
    byDifficulty[item.tags.difficulty] += 1
    const batch = batches.get(item.source.batch) ?? {
      id: item.source.batch,
      count: 0,
      rights: item.source.rights,
      description: item.source.ref,
    }
    batch.count += 1
    batches.set(item.source.batch, batch)
  }
  const meta = {
    schema_version: '1.0',
    code: 'MATH1006',
    name: 'Calculus',
    name_en: 'Calculus',
    department: 'Math',
    category: 'undergraduate',
    description: 'Calculus course',
    stats: {
      total: questions.length,
      quarantined: questions.filter(item => item.quality.quarantined).length,
      taxonomy_nodes: taxonomy.nodes.length,
      by_origin: byOrigin,
      by_type: byType,
      by_difficulty: byDifficulty,
      exam_years: [...new Set(questions.map(item => item.source.year).filter(Number.isInteger))].sort(),
    },
    batches: [...batches.values()],
    known_notes: [],
    files: { questions: 'courses/MATH1006/questions.jsonl', taxonomy: 'courses/MATH1006/taxonomy.json' },
    sha256: { questions: hash(questionBytes), taxonomy: hash(taxonomyBytes) },
  }
  const metaBytes = Buffer.from(JSON.stringify(meta))
  const imageBytes = Buffer.from('study-image')
  await Promise.all([
    fs.writeFile(path.join(courseRoot, 'meta.json'), metaBytes),
    fs.writeFile(path.join(courseRoot, 'taxonomy.json'), taxonomyBytes),
    fs.writeFile(path.join(courseRoot, 'questions.jsonl'), questionBytes),
    fs.writeFile(path.join(courseRoot, 'assets', 'diagram.png'), imageBytes),
  ])
  const manifest = {
    name: sourceId,
    schema_version: '1.0',
    data_version: '2026-11-21',
    updated_at: '2026-11-21',
    repository: sourceId,
    asset_base_url: null,
    license: { code_and_schema: 'MIT', question_content: 'original' },
    stats: {
      courses: 1, questions: questions.length, quarantined: 0,
      by_origin: { official: questions.length, community: 0, ai: 0 },
    },
    courses: [{
      code: 'MATH1006', name: 'Calculus', name_en: 'Calculus',
      department: 'Math', category: 'undergraduate',
      total: questions.length, quarantined: 0,
      by_origin: { official: questions.length, community: 0, ai: 0 },
      exam_years: [2024],
      paths: {
        meta: 'courses/MATH1006/meta.json',
        taxonomy: 'courses/MATH1006/taxonomy.json',
        questions: 'courses/MATH1006/questions.jsonl',
      },
      sha256: { meta: hash(metaBytes), taxonomy: hash(taxonomyBytes), questions: hash(questionBytes) },
    }],
  }
  await fs.writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest))
  return manifest
}

async function setup(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-study-test-'))
  const db = createDatabase(directory)
  const sources = new SourceService({ db, dataDir: directory })
  await sources.initialize()
  t.after(async () => {
    db.close()
    await fs.rm(directory, { recursive: true, force: true })
  })
  return { directory, db, sources }
}

test('local source sync verifies schemas, hashes, FTS, assets, and source namespaces', async t => {
  const { directory, db, sources } = await setup(t)
  const firstRoot = path.join(directory, 'source-a')
  await makeBank(firstRoot, { questions: [question('MATH1006-q1'), question('MATH1006-q2', 'Evaluate this limit.')] })
  await sources.add({ source_id: 'bank-a', transport: 'local-dir', location: firstRoot })
  const installed = await sources.sync('bank-a', ['MATH1006'])
  assert.equal(installed[0].sha256_verified, true)
  assert.equal(db.prepare('SELECT count(*) AS value FROM questions WHERE source_id=?').get('bank-a').value, 2)
  assert.equal(db.prepare('SELECT count(*) AS value FROM questions_fts WHERE source_id=?').get('bank-a').value, 2)
  assert.equal(await fs.readFile(path.join(directory, 'cache', 'bank-a', 'courses', 'MATH1006', 'assets', 'diagram.png'), 'utf8'), 'study-image')

  const secondRoot = path.join(directory, 'source-b')
  await makeBank(secondRoot, { sourceId: 'bank-b', questions: [question('MATH1006-q1', 'A second source.') ] })
  await sources.add({ source_id: 'bank-b', transport: 'local-dir', location: secondRoot })
  await sources.sync('bank-b', ['MATH1006'])
  assert.equal(db.prepare('SELECT count(*) AS value FROM questions WHERE id=?').get('MATH1006-q1').value, 2)

  const papers = new PaperService({ db })
  const matches = searchQuestions(db, papers, { query: 'limit', source_ids: ['bank-a'], limit: 10 })
  assert.equal(matches.length, 2)
  assert.equal(questionDetails(db, { dataDir: directory }, { source_id: 'bank-a', question_id: 'MATH1006-q1' })
    .figure_urls[0].url, `/api/dsh-study/file?path=${encodeURIComponent('cache/bank-a/MATH1006/assets/diagram.png')}`)
  assert.deepEqual(assertQuestion(getQuestion(db, 'bank-a', 'MATH1006-q1')).tags.kp_ids, ['limit'])
})

test('a hash mismatch rejects a course before replacing installed data', async t => {
  const { directory, db, sources } = await setup(t)
  const sourceRoot = path.join(directory, 'tampered')
  const manifest = await makeBank(sourceRoot)
  await sources.add({ source_id: 'tampered', transport: 'local-dir', location: sourceRoot })
  await sources.sync('tampered', ['MATH1006'])
  const prior = getQuestion(db, 'tampered', 'MATH1006-q1')
  const changed = question('MATH1006-q2')
  await fs.writeFile(path.join(sourceRoot, 'courses', 'MATH1006', 'questions.jsonl'), `${JSON.stringify(changed)}\n`)
  await fs.writeFile(path.join(sourceRoot, 'manifest.json'), JSON.stringify(manifest))
  await assert.rejects(sources.sync('tampered', ['MATH1006']), /SHA-256 mismatch/)
  assert.deepEqual(getQuestion(db, 'tampered', 'MATH1006-q1'), prior)
  assert.equal(getQuestion(db, 'tampered', 'MATH1006-q2'), null)
})

test('mistake drafts stay staged until commit and produce a hashed personal manifest', async t => {
  const { directory, db, sources } = await setup(t)
  const sourceRoot = path.join(directory, 'bank')
  await makeBank(sourceRoot)
  await sources.add({ source_id: 'bank-a', transport: 'local-dir', location: sourceRoot })
  await sources.sync('bank-a', ['MATH1006'])
  const mistakes = new MistakeService({ db, dataDir: directory })
  const draft = mistakes.draft({
    question: question('MATH1006-draft'),
    error_tags: ['计算'],
    wrong_attempt_md: 'Wrong sign',
    reflection_md: 'Check the sign before substituting.',
  })
  const personalRoot = path.join(directory, 'personal')
  await assert.rejects(fs.stat(path.join(personalRoot, 'manifest.json')), { code: 'ENOENT' })
  await assert.rejects(fs.stat(path.join(personalRoot, 'courses', 'MATH1006')), { code: 'ENOENT' })
  assert.equal(mistakes.listDrafts().length, 1)

  const committed = await mistakes.commit(draft.draft_id)
  const personalManifest = JSON.parse(await fs.readFile(path.join(personalRoot, 'manifest.json'), 'utf8'))
  assertManifest(personalManifest)
  const course = personalManifest.courses[0]
  const personalMeta = JSON.parse(await fs.readFile(path.join(personalRoot, course.paths.meta), 'utf8'))
  assert.equal(personalMeta.schema_version, '1.0')
  assert.equal(personalMeta.stats.total, 1)
  assert.equal(personalMeta.stats.taxonomy_nodes, 1)
  assert.deepEqual(personalMeta.files, {
    questions: course.paths.questions,
    taxonomy: course.paths.taxonomy,
  })
  for (const field of ['meta', 'taxonomy', 'questions']) {
    const bytes = await fs.readFile(path.join(personalRoot, course.paths[field]))
    assert.equal(hash(bytes), course.sha256[field])
  }
  assert.equal(personalMeta.sha256.questions,
    hash(await fs.readFile(path.join(personalRoot, personalMeta.files.questions))))
  assert.equal(personalMeta.sha256.taxonomy,
    hash(await fs.readFile(path.join(personalRoot, personalMeta.files.taxonomy))))
  assert.equal(committed.source_id, 'local-personal')
  assert.equal(getQuestion(db, 'local-personal', committed.question_id).source.batch, 'personal_mistakes')
  assert.equal(mistakes.list({ source_id: 'local-personal' }).length, 1)
  assert.equal(mistakes.dismissDraft(draft.draft_id), false)
})

test('marking repeats increments counts; SM-2 transitions and snapshots persist', async t => {
  const { directory, db, sources } = await setup(t)
  const sourceRoot = path.join(directory, 'bank')
  await makeBank(sourceRoot)
  await sources.add({ source_id: 'bank-a', transport: 'local-dir', location: sourceRoot })
  await sources.sync('bank-a', ['MATH1006'])
  const mistakes = new MistakeService({ db, dataDir: directory })
  const first = mistakes.mark({ source_id: 'bank-a', question_id: 'MATH1006-q1', error_tags: ['粗心'] })
  const second = mistakes.mark({ source_id: 'bank-a', question_id: 'MATH1006-q1', error_tags: ['概念'] })
  assert.equal(second.mistake_id, first.mistake_id)
  assert.equal(second.wrong_count, 2)
  assert.equal(second.interval_days, 1)
  assert.deepEqual(scheduleReview({ review_count: 1, ease_factor: 2.5, interval_days: 1 }, 'good'),
    { status: 'mastered', ease_factor: 2.5, interval_days: 3 })
  mistakes.review({ mistake_id: first.mistake_id, rating: 'again' })
  db.prepare('DELETE FROM questions WHERE source_id=? AND id=?').run('bank-a', 'MATH1006-q1')
  const snapshot = mistakes.list()[0]
  assert.equal(snapshot.question.id, 'MATH1006-q1')
  assert.equal(snapshot.status, 'unmastered')
})

test('paper assembly honors filters, deterministic seeds, edits, gaps, and AI gates', async t => {
  const { directory, db, sources } = await setup(t)
  const sourceRoot = path.join(directory, 'bank')
  await makeBank(sourceRoot, { questions: [
    question('MATH1006-q1', 'Compute one limit.'),
    question('MATH1006-q2', 'Compute another limit.'),
  ] })
  await sources.add({ source_id: 'bank-a', transport: 'local-dir', location: sourceRoot })
  await sources.sync('bank-a', ['MATH1006'])
  const papers = new PaperService({ db })
  const request = {
    mode: 'exam', title: 'Practice', source_ids: ['bank-a'], course_codes: ['MATH1006'],
    kp_ids: ['calculus'], count: 3, seed: 42,
  }
  const first = papers.assemble(request)
  const second = papers.assemble(request)
  assert.deepEqual(first.items.map(item => item.question.id), second.items.map(item => item.question.id))
  assert.equal(first.gaps[0].missing, 1)
  const before = papers.get(first.paper_id)
  const edited = papers.updateItems(first.paper_id, [
    { seq: before.items[1].seq, score: 12 },
    { seq: before.items[0].seq, score: 8 },
  ])
  assert.equal(edited.items[0].score, 12)
  const variant = structuredClone(first.items[0].question)
  assert.throws(() => papers.proposeVariant({ paper_id: first.paper_id, question: variant }, {
    allow_ai_variants: true,
  }), /both the global setting/)
  const allowed = new PaperService({ db, allowAiVariants: true })
  const draft = allowed.proposeVariant({ paper_id: first.paper_id, question: variant }, { allow_ai_variants: true })
  assert.equal(draft.question.answer.origin, 'ai')
  assert.equal(draft.question.source.batch, 'ai_variant')
  assert.equal(allowed.confirmVariant(draft.draft_id).question.id, variant.id)
})

function createSubprocessService() {
  return {
    async resolveExecutable(command) {
      return command
    },
    spawn(spec) {
      const [command, ...args] = spec.argv
      const child = spawn(command, args, {
        cwd: spec.cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        signal: spec.signal,
      })
      const done = new Promise((resolve, reject) => {
        child.once('error', reject)
        child.once('close', (exitCode, signal) => resolve({ exitCode, signal }))
      })
      return { stdout: child.stdout, stderr: child.stderr, done, terminate: () => child.kill() }
    },
  }
}

test('PDF templates compile both styles and PPTX exports rasterized slides', async t => {
  const { directory, db, sources } = await setup(t)
  const sourceRoot = path.join(directory, 'bank')
  await makeBank(sourceRoot)
  await sources.add({ source_id: 'bank-a', transport: 'local-dir', location: sourceRoot })
  await sources.sync('bank-a', ['MATH1006'])
  const papers = new PaperService({ db })
  const paper = papers.assemble({
    title: 'Calculus review', mode: 'exam', source_ids: ['bank-a'],
    course_codes: ['MATH1006'], count: 1, seed: 1,
  })
  const render = new RenderService({
    db, dataDir: directory, subprocess: createSubprocessService(), bundleRoot: projectRoot,
  })
  const inline = await render.render({
    paper_id: paper.paper_id, format: 'pdf', template_id: 'ustc-exam', mode: 'inline-solution',
    options: { schoolTerm: '2026-2027 第一学期', examDate: '2026-11-21', examForm: '闭卷' },
  })
  assert.equal(inline.status, 'ok', inline.log)
  assert.ok((await fs.stat(path.join(directory, inline.artifacts.inlinePdf))).size > 1000)
  const ustcSplit = await render.render({
    paper_id: paper.paper_id, format: 'pdf', template_id: 'ustc-exam', mode: 'split',
  })
  assert.equal(ustcSplit.status, 'ok', ustcSplit.log)
  assert.ok((await fs.stat(path.join(directory, ustcSplit.artifacts.questionPdf))).size > 1000)
  assert.ok((await fs.stat(path.join(directory, ustcSplit.artifacts.answerPdf))).size > 1000)
  const gaokao = await render.render({
    paper_id: paper.paper_id, format: 'pdf', template_id: 'gaokao', mode: 'split',
  })
  assert.equal(gaokao.status, 'ok', gaokao.log)
  assert.ok((await fs.stat(path.join(directory, gaokao.artifacts.questionPdf))).size > 1000)
  assert.ok((await fs.stat(path.join(directory, gaokao.artifacts.answerPdf))).size > 1000)
  const gaokaoInline = await render.render({
    paper_id: paper.paper_id, format: 'pdf', template_id: 'gaokao', mode: 'inline-solution',
  })
  assert.equal(gaokaoInline.status, 'ok', gaokaoInline.log)
  assert.ok((await fs.stat(path.join(directory, gaokaoInline.artifacts.inlinePdf))).size > 1000)

  const customRoot = path.join(directory, 'templates', 'pdf', 'custom-review')
  await fs.mkdir(customRoot, { recursive: true })
  await fs.writeFile(path.join(customRoot, 'template.json'), JSON.stringify({
    id: 'custom-review', kind: 'pdf', name: 'Custom Review', engine: 'xelatex',
    entry: './template.tex', supportsModes: ['inline-solution', 'split'],
  }))
  await fs.writeFile(path.join(customRoot, 'template.tex'), '{{document}}')
  assert.ok((await render.templates()).some(template => template.id === 'custom-review' && template.source === 'custom'))
  const custom = await render.render({
    paper_id: paper.paper_id, format: 'pdf', template_id: 'custom-review', mode: 'inline-solution',
  })
  assert.equal(custom.status, 'ok', custom.log)
  assert.ok((await fs.stat(path.join(directory, custom.artifacts.inlinePdf))).size > 1000)

  const fallback = new RenderService({
    db, dataDir: directory, xelatexBin: 'dsh-study-missing-xelatex',
    subprocess: createSubprocessService(), bundleRoot: projectRoot,
  })
  const degraded = await fallback.render({
    paper_id: paper.paper_id, format: 'pdf', template_id: 'ustc-exam', mode: 'inline-solution',
  })
  assert.equal(degraded.status, 'degraded')
  assert.ok(degraded.artifacts.inlineTexPath)
  assert.ok((await fs.stat(path.join(directory, degraded.artifacts.html))).size > 1000)

  const ppt = await render.render({
    paper_id: paper.paper_id, format: 'ppt', template_id: 'review-classic',
  })
  assert.equal(ppt.status, 'ok')
  const manifest = JSON.parse(await fs.readFile(path.join(directory, ppt.artifacts.slidesManifest), 'utf8'))
  assert.equal(manifest.slides.length, 3)
  for (const slide of manifest.slides) {
    const image = await fs.readFile(path.join(directory, slide.thumbnail_path))
    assert.deepEqual([...image.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
  }
})

test('dual-channel helpers: taxonomy list, custom basket paper, comments, and combined split PDF', async t => {
  const { directory, db, sources } = await setup(t)
  const sourceRoot = path.join(directory, 'bank')
  await makeBank(sourceRoot, {
    questions: [
      question('MATH1006-q1', '求极限并验证 $|f(x)| > \\dfrac{\\pi}{4}$ 且 $4M \\geqslant \\pi$。'),
      question('MATH1006-q2', '求积分并判断 $n \\leqslant 10$ 时的收敛性。'),
    ],
  })
  await sources.add({ name: '本地测试源', transport: 'local-dir', location: sourceRoot })
  const added = sources.list().find(item => item.transport === 'local-dir')
  assert.ok(added?.source_id)
  await sources.sync(added.source_id, ['MATH1006'])

  const papers = new PaperService({ db })
  const tax = papers.taxonomyList(['MATH1006'])
  assert.equal(tax.length, 2)
  assert.ok(tax.some(node => node.kp_id === 'limit'))

  const custom = papers.assembleFromKeys({
    title: '《数学分析》自选测试卷',
    items: [
      { source_id: added.source_id, question_id: 'MATH1006-q1', score: 12 },
      { source_id: added.source_id, question_id: 'MATH1006-q2', score: 8 },
    ],
  })
  const commented = papers.updateComments(custom.paper_id, [
    { seq: 1, comment_md: '注意分母等价无穷小替换条件。' },
  ])
  assert.equal(commented.items[0].comment_md, '注意分母等价无穷小替换条件。')

  const render = new RenderService({
    db, dataDir: directory, subprocess: createSubprocessService(), bundleRoot: projectRoot,
  })
  const combined = await render.render({
    paper_id: custom.paper_id, format: 'pdf', template_id: 'ustc-exam', mode: 'split',
    options: { splitLayout: 'combined' },
  })
  assert.equal(combined.status, 'ok', combined.log)
  assert.ok((await fs.stat(path.join(directory, combined.artifacts.inlinePdf))).size > 1000)

  const ppt = await render.render({
    paper_id: custom.paper_id, format: 'ppt', template_id: 'review-classic',
  })
  assert.equal(ppt.status, 'ok')
  const manifest = JSON.parse(await fs.readFile(path.join(directory, ppt.artifacts.slidesManifest), 'utf8'))
  assert.ok(manifest.slides.length >= 5)
})

test('bundled examples/sample-bank imports cleanly with schema and SHA-256 verification', async t => {
  const { db, sources } = await setup(t)
  const sampleDir = path.join(projectRoot, 'examples', 'sample-bank')
  await sources.add({ source_id: 'sample-bank', transport: 'local-dir', location: sampleDir })
  const installed = await sources.sync('sample-bank', ['DEMO101'])
  assert.equal(installed.length, 1)
  assert.equal(installed[0].sha256_verified, true)
  assert.equal(db.prepare('SELECT count(*) AS value FROM questions WHERE source_id=?').get('sample-bank').value, 3)

  const papers = new PaperService({ db })
  const tax = papers.taxonomyList(['DEMO101'])
  assert.equal(tax.length, 5)
  const found = searchQuestions(db, papers, { source_ids: ['sample-bank'], course_codes: ['DEMO101'], limit: 10 })
  assert.equal(found.length, 3)
})

test('LatexEnvService detects managed TinyTeX when PATH lacks xelatex and respects custom missing bin', async t => {
  const { directory } = await setup(t)
  const noPathSubprocess = {
    async resolveExecutable() {
      throw new Error('not found in PATH')
    },
  }
  const envSvc = new LatexEnvService({ dataDir: directory, subprocess: noPathSubprocess })

  // Custom missing binary must stay unavailable (preserves degraded fallback)
  const missingCustom = await envSvc.detect('dsh-study-missing-xelatex')
  assert.equal(missingCustom.available, false)

  // Simulated managed TinyTeX binary inside <dataDir>/runtime/TinyTeX/bin/<arch>/
  const exeName = process.platform === 'win32' ? 'xelatex.exe' : 'xelatex'
  const archDir = process.platform === 'win32' ? 'windows' : 'x86_64-linux'
  const managedBin = path.join(directory, 'runtime', 'TinyTeX', 'bin', archDir, exeName)
  await fs.mkdir(path.dirname(managedBin), { recursive: true })
  await fs.writeFile(managedBin, 'stub')
  if (process.platform !== 'win32') await fs.chmod(managedBin, 0o755)

  const foundManaged = await envSvc.detect('xelatex')
  assert.equal(foundManaged.available, true)
  assert.equal(foundManaged.source, 'managed')
  assert.equal(foundManaged.executable, managedBin)

  // Explicit absolute path detection
  const foundExplicit = await envSvc.detect(managedBin)
  assert.equal(foundExplicit.available, true)
  assert.equal(foundExplicit.source, 'configured')
  assert.equal(foundExplicit.executable, managedBin)
})
