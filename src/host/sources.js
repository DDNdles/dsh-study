import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { getQuestion, transaction, upsertQuestion } from './db.js'
import { runProcess } from './process.js'
import {
  assertManifest,
  assertMeta,
  assertQuestion,
  assertSafeRelative,
  assertTaxonomy,
  safeChild,
} from './validation.js'

const OFFICIAL_SOURCE = {
  source_id: 'ustc-official',
  name: '中科大公开题库（GitHub）',
  transport: 'github-raw',
  location: 'DDNdles/USTC-Question-Bank',
  ref: 'main',
}

const USTC_GITLAB_SOURCE = {
  source_id: 'ustc-gitlab',
  name: '中科大公开题库（USTC Git 镜像）',
  transport: 'http-manifest',
  location: 'https://git.ustc.edu.cn/zzl_stella05/USTC-Question-Bank/-/raw/main/',
  ref: null,
}

function hash(content) {
  return createHash('sha256').update(content).digest('hex')
}

function json(content, label) {
  try {
    return JSON.parse(content.toString('utf8'))
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`)
  }
}

function assertSourceId(sourceId) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(sourceId)) {
    throw new Error('source_id must be 1-64 URL-safe characters')
  }
}

function normalizeTransport(input) {
  const aliases = { github: 'github-raw', http: 'http-manifest', local: 'local-dir' }
  const transport = aliases[input.transport] ?? input.transport
  if (!['github-raw', 'http-manifest', 'local-dir', 'git'].includes(transport)) {
    throw new Error(`Unsupported source transport: ${input.transport}`)
  }
  return transport
}

export class SourceService {
  constructor({ db, dataDir, mirrorBaseUrl = '', subprocess }) {
    this.db = db
    this.dataDir = dataDir
    this.mirrorBaseUrl = mirrorBaseUrl
    this.subprocess = subprocess
  }

  async initialize() {
    const now = new Date().toISOString()
    const statement = this.db.prepare(`
      INSERT INTO sources(source_id,name,transport,location,ref,created_at)
      VALUES(?,?,?,?,?,?)
      ON CONFLICT(source_id) DO NOTHING
    `)
    statement.run(USTC_GITLAB_SOURCE.source_id, USTC_GITLAB_SOURCE.name, USTC_GITLAB_SOURCE.transport,
      USTC_GITLAB_SOURCE.location, USTC_GITLAB_SOURCE.ref, now)
    statement.run(OFFICIAL_SOURCE.source_id, OFFICIAL_SOURCE.name, OFFICIAL_SOURCE.transport,
      OFFICIAL_SOURCE.location, OFFICIAL_SOURCE.ref, now)
    statement.run('local-personal', '个人错题库', 'personal',
      path.join(this.dataDir, 'personal'), null, now)
    this.db.prepare(`UPDATE sources SET name='中科大公开题库（GitHub）' WHERE source_id='ustc-official' AND name IN ('USTC-Question-Bank','中科大公开题库')`).run()
    this.db.prepare(`UPDATE sources SET name='个人错题库' WHERE source_id='local-personal' AND name='Personal mistakes'`).run()
    await fs.mkdir(path.join(this.dataDir, 'personal', 'courses'), { recursive: true })
    return this.list()
  }

  remove(sourceId) {
    assertSourceId(sourceId)
    if (sourceId === 'ustc-official' || sourceId === 'ustc-gitlab' || sourceId === 'local-personal') {
      throw new Error('内置题库源不可删除')
    }
    const changes = this.db.prepare('DELETE FROM sources WHERE source_id=?').run(sourceId).changes
    this.db.prepare('DELETE FROM questions_fts WHERE source_id=?').run(sourceId)
    return changes > 0
  }

  list() {
    return this.db.prepare(`
      SELECT s.source_id, s.name, s.transport, s.location, s.data_version, s.last_synced_at,
        c.code AS course_code, c.name AS course_name, c.total_questions, c.installed, c.installed_at
      FROM sources s LEFT JOIN courses c USING(source_id)
      ORDER BY s.source_id, c.code
    `).all()
  }

  async add(input, signal) {
    const rawId = String(input.source_id ?? '').trim() || `src-${randomUUID().slice(0, 8)}`
    assertSourceId(rawId)
    if (rawId === 'local-personal') throw new Error('该标识为系统保留名称')
    const transport = normalizeTransport(input)
    const source = {
      source_id: rawId,
      name: String(input.name ?? '').trim() || rawId,
      transport,
      location: String(input.location ?? '').trim(),
      ref: input.ref || (transport === 'github-raw' || transport === 'git' ? 'main' : null),
      mirror_url: input.mirror_url ?? null,
      created_at: new Date().toISOString(),
    }
    if (!source.location) throw new Error('请填写题库地址或本机目录路径')
    const manifest = await this.loadManifest(source, signal)
    this.db.prepare(`
      INSERT INTO sources(source_id,name,transport,location,ref,mirror_url,asset_base_url,
        manifest_json,data_version,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(source_id) DO UPDATE SET name=excluded.name, transport=excluded.transport,
        location=excluded.location, ref=excluded.ref, mirror_url=excluded.mirror_url,
        asset_base_url=excluded.asset_base_url, manifest_json=excluded.manifest_json,
        data_version=excluded.data_version
    `).run(source.source_id, source.name, source.transport, source.location, source.ref,
      source.mirror_url, manifest.asset_base_url, JSON.stringify(manifest),
      manifest.data_version, source.created_at)
    transaction(this.db, () => this.cacheManifestCourses(source.source_id, manifest))
    return { source_id: source.source_id, name: source.name, courses: manifest.courses }
  }

  async inspect(sourceId, signal) {
    assertSourceId(sourceId)
    const source = this.db.prepare('SELECT * FROM sources WHERE source_id=?').get(sourceId)
    if (!source) throw new Error(`Unknown source: ${sourceId}`)
    if (source.transport === 'personal') throw new Error('Personal source does not have a remote manifest')
    const manifest = assertManifest(await this.loadManifest(source, signal))
    this.db.prepare('UPDATE sources SET manifest_json=?,data_version=?,asset_base_url=? WHERE source_id=?')
      .run(JSON.stringify(manifest), manifest.data_version, manifest.asset_base_url, sourceId)
    transaction(this.db, () => this.cacheManifestCourses(sourceId, manifest))
    return { source_id: sourceId, courses: manifest.courses }
  }

  cacheManifestCourses(sourceId, manifest) {
    const insert = this.db.prepare(`
      INSERT INTO courses(source_id,code,name,name_en,department,category,description,total_questions,
        meta_json,meta_sha256,taxonomy_sha256,questions_sha256,installed)
      VALUES(?,?,?,?,?,?,?,?,'{}',?,?,?,0)
      ON CONFLICT(source_id,code) DO UPDATE SET
        name=excluded.name,name_en=excluded.name_en,department=excluded.department,category=excluded.category,
        total_questions=excluded.total_questions,meta_sha256=excluded.meta_sha256,
        taxonomy_sha256=excluded.taxonomy_sha256,questions_sha256=excluded.questions_sha256
    `)
    for (const course of manifest.courses) {
      insert.run(sourceId, course.code, course.name, course.name_en, course.department,
        course.category, '', course.total, course.sha256.meta, course.sha256.taxonomy,
        course.sha256.questions)
    }
  }

  async sync(sourceId, courseCodes, signal) {
    assertSourceId(sourceId)
    const source = this.db.prepare('SELECT * FROM sources WHERE source_id=?').get(sourceId)
    if (!source) throw new Error(`Unknown source: ${sourceId}`)
    if (source.transport === 'personal') throw new Error('Personal source is written through mistake confirmation')
    const manifest = assertManifest(await this.loadManifest(source, signal))
    const selected = courseCodes?.length
      ? manifest.courses.filter(course => courseCodes.includes(course.code))
      : []
    const missing = (courseCodes ?? []).filter(code => !manifest.courses.some(course => course.code === code))
    if (missing.length) throw new Error(`Unknown course(s) in source ${sourceId}: ${missing.join(', ')}`)
    if (!selected.length) throw new Error('Select at least one course to sync')

    const root = path.join(this.dataDir, 'cache', sourceId)
    const updates = []
    for (const course of selected) {
      if (signal?.aborted) throw signal.reason ?? new Error('Sync was cancelled')
      if (source.transport === 'git') await this.materializeGit(source, signal, course.paths)
      const [metaBytes, taxonomyBytes, questionBytes] = await Promise.all([
        this.readFile(source, course.paths.meta, signal),
        this.readFile(source, course.paths.taxonomy, signal),
        this.readFile(source, course.paths.questions, signal),
      ])
      for (const field of ['meta', 'taxonomy', 'questions']) {
        const bytes = { meta: metaBytes, taxonomy: taxonomyBytes, questions: questionBytes }[field]
        if (hash(bytes) !== course.sha256[field]) {
          throw new Error(`SHA-256 mismatch for ${course.code}/${field}; nothing was installed`)
        }
      }

      const meta = assertMeta(json(metaBytes, `${course.code} meta.json`), course.code)
      const taxonomy = assertTaxonomy(json(taxonomyBytes, `${course.code} taxonomy.json`), course.code)
      const questions = []
      for (const [index, line] of questionBytes.toString('utf8').split(/\r?\n/).entries()) {
        if (!line.trim()) continue
        let question
        try {
          question = JSON.parse(line)
        } catch (error) {
          throw new Error(`${course.code} questions.jsonl line ${index + 1} is invalid JSON: ${error.message}`)
        }
        assertQuestion(question, course.code)
        const knownKps = new Set(taxonomy.nodes.map(node => node.id))
        const invalidKp = question.tags.kp_ids.find(id => !knownKps.has(id))
        if (invalidKp) throw new Error(`${course.code} question ${question.id} references unknown taxonomy node ${invalidKp}`)
        questions.push(question)
      }
      if (questions.length !== course.total) {
        throw new Error(`${course.code} expected ${course.total} questions, found ${questions.length}`)
      }
      const assets = await this.loadAssets(source, manifest, course, questions, signal)
      updates.push({ course, meta, taxonomy, questions, metaBytes, taxonomyBytes, questionBytes, assets })
    }

    const cacheRoot = path.join(root, 'courses')
    const tempRoot = path.join(root, `.sync-${randomUUID()}`)
    await fs.mkdir(tempRoot, { recursive: true })
    const backupRoot = path.join(root, `.backup-${randomUUID()}`)
    const swaps = []
    try {
      for (const update of updates) {
        const dir = path.join(tempRoot, update.course.code)
        await fs.mkdir(dir, { recursive: true })
        await fs.writeFile(path.join(dir, 'meta.json'), update.metaBytes)
        await fs.writeFile(path.join(dir, 'taxonomy.json'), update.taxonomyBytes)
        await fs.writeFile(path.join(dir, 'questions.jsonl'), update.questionBytes)
        for (const asset of update.assets) {
          const target = path.join(dir, ...asset.relative.split('/'))
          await fs.mkdir(path.dirname(target), { recursive: true })
          await fs.writeFile(target, asset.bytes)
        }
      }
      await fs.mkdir(cacheRoot, { recursive: true })
      await fs.mkdir(backupRoot, { recursive: true })
      for (const update of updates) {
        const finalDir = path.join(cacheRoot, update.course.code)
        const stagedDir = path.join(tempRoot, update.course.code)
        const backupDir = path.join(backupRoot, update.course.code)
        const existed = await fs.stat(finalDir).then(() => true, () => false)
        if (existed) await fs.rename(finalDir, backupDir)
        const swap = { finalDir, backupDir, existed }
        swaps.push(swap)
        await fs.rename(stagedDir, finalDir)
      }
      const manifestPath = path.join(root, 'manifest.json')
      const stagedManifest = path.join(tempRoot, 'manifest.json')
      const backupManifest = path.join(backupRoot, 'manifest.json')
      await fs.writeFile(stagedManifest, JSON.stringify(manifest, null, 2))
      const manifestExisted = await fs.stat(manifestPath).then(() => true, () => false)
      if (manifestExisted) await fs.rename(manifestPath, backupManifest)
      swaps.push({ finalDir: manifestPath, backupDir: backupManifest, existed: manifestExisted })
      await fs.rename(stagedManifest, manifestPath)
      transaction(this.db, () => {
        for (const update of updates) {
          this.replaceCourse(sourceId, update)
        }
        this.db.prepare('UPDATE sources SET manifest_json=?, data_version=?, asset_base_url=?, last_synced_at=? WHERE source_id=?')
          .run(JSON.stringify(manifest), manifest.data_version, manifest.asset_base_url,
            new Date().toISOString(), sourceId)
      })
      await fs.rm(backupRoot, { recursive: true, force: true }).catch(() => {})
    } catch (error) {
      for (const swap of [...swaps].reverse()) {
        await fs.rm(swap.finalDir, { recursive: true, force: true }).catch(() => {})
        if (swap.existed) await fs.rename(swap.backupDir, swap.finalDir).catch(() => {})
      }
      await fs.rm(tempRoot, { recursive: true, force: true })
      await fs.rm(backupRoot, { recursive: true, force: true })
      throw error
    }
    return updates.map(({ course, questions }) => ({
      source_id: sourceId, course_code: course.code, question_count: questions.length,
      sha256_verified: true,
    }))
  }

  replaceCourse(sourceId, update) {
    const { course, meta, taxonomy, questions } = update
    this.db.prepare('DELETE FROM questions_fts WHERE source_id=? AND course_code=?').run(sourceId, course.code)
    this.db.prepare('DELETE FROM courses WHERE source_id=? AND code=?').run(sourceId, course.code)
    this.db.prepare(`
      INSERT INTO courses(source_id,code,name,name_en,department,category,description,total_questions,
        meta_json,meta_sha256,taxonomy_sha256,questions_sha256,installed,installed_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,1,?)
    `).run(sourceId, course.code, course.name, course.name_en, course.department, course.category,
      meta.description ?? '', questions.length, JSON.stringify(meta), course.sha256.meta,
      course.sha256.taxonomy, course.sha256.questions, new Date().toISOString())
    const addNode = this.db.prepare(`
      INSERT INTO taxonomy(source_id,course_code,kp_id,parent_id,level,name,chapter_ref)
      VALUES(?,?,?,?,?,?,?)
    `)
    for (const node of taxonomy.nodes) {
      addNode.run(sourceId, course.code, node.id, node.parent_id, node.level, node.name, node.chapter_ref)
    }
    for (const question of questions) upsertQuestion(this.db, sourceId, question)
  }

  async loadManifest(source, signal) {
    if (source.transport === 'local-dir') {
      const location = path.resolve(source.location)
      return assertManifest(json(await fs.readFile(path.join(location, 'manifest.json')), 'manifest.json'))
    }
    if (source.transport === 'http-manifest') {
      return assertManifest(json(await this.fetchUrl(new URL('manifest.json', ensureSlash(source.location)), signal), 'manifest.json'))
    }
    if (source.transport === 'github-raw') {
      const base = `https://raw.githubusercontent.com/${source.location}/${encodeURIComponent(source.ref || 'main')}/`
      const url = new URL('manifest.json', base)
      const manifestBytes = await this.fetchUrl(this.mirror(source.mirror_url || this.mirrorBaseUrl, url), signal)
      return assertManifest(json(manifestBytes, 'manifest.json'))
    }
    if (source.transport === 'git') {
      const dir = await this.materializeGit(source, signal)
      return assertManifest(json(await fs.readFile(path.join(dir, 'manifest.json')), 'manifest.json'))
    }
    throw new Error(`Unsupported transport: ${source.transport}`)
  }

  async readFile(source, relative, signal) {
    assertSafeRelative(relative)
    if (source.transport === 'local-dir') {
      return fs.readFile(safeChild(source.location, relative))
    }
    if (source.transport === 'http-manifest') {
      return this.fetchUrl(new URL(relative.split('/').map(encodeURIComponent).join('/'),
        ensureSlash(source.location)), signal)
    }
    if (source.transport === 'github-raw') {
      const base = `https://raw.githubusercontent.com/${source.location}/${encodeURIComponent(source.ref || 'main')}/`
      const target = new URL(relative.split('/').map(encodeURIComponent).join('/'), base)
      return this.fetchUrl(this.mirror(source.mirror_url || this.mirrorBaseUrl, target), signal)
    }
    if (source.transport === 'git') {
      return fs.readFile(safeChild(await this.materializeGit(source, signal), relative))
    }
    throw new Error(`Unsupported transport: ${source.transport}`)
  }

  async loadAssets(source, manifest, course, questions, signal) {
    const references = new Map()
    for (const question of questions) {
      for (const figure of allFigures(question)) {
        assertSafeRelative(figure.path)
        if (!figure.path.startsWith('assets/')) throw new Error(`Figure path must be under assets/: ${figure.path}`)
        references.set(figure.path, figure)
      }
    }
    return Promise.all([...references].map(async ([relative, figure]) => {
      let bytes
      if (source.transport === 'local-dir') {
        bytes = await fs.readFile(safeChild(source.location, `${course.paths.meta.split('/').slice(0, -1).join('/')}/${relative}`))
      } else if (source.transport === 'git') {
        const gitRoot = await this.materializeGit(source, signal, course.paths)
        bytes = await fs.readFile(safeChild(gitRoot, `${course.paths.meta.split('/').slice(0, -1).join('/')}/${relative}`))
      } else if (manifest.asset_base_url) {
        const assetRoot = ensureSlash(manifest.asset_base_url)
        const assetUrl = new URL(`${encodeURIComponent(course.code)}/${relative.split('/').map(encodeURIComponent).join('/')}`, assetRoot)
        bytes = await this.fetchUrl(assetUrl, signal)
      } else {
        bytes = await this.readFile(source,
          `${course.paths.meta.split('/').slice(0, -1).join('/')}/${relative}`, signal)
      }
      if (figure.sha256 && hash(bytes) !== figure.sha256) {
        throw new Error(`SHA-256 mismatch for ${course.code}/${relative}`)
      }
      return { relative, bytes }
    }))
  }

  async materializeGit(source, signal, paths = {}) {
    if (path.isAbsolute(source.location) || /^[A-Za-z]:[\\/]/.test(source.location)) {
      const target = path.resolve(source.location)
      if (!await fs.stat(path.join(target, '.git')).then(() => true, () => false)) {
        throw new Error(`Git source is not a repository: ${target}`)
      }
      return target
    }
    if (!this.subprocess) throw new Error('Git source transport requires the DSH subprocess service')
    const target = path.join(this.dataDir, 'cache', '.git-sources', source.source_id)
    await fs.mkdir(path.dirname(target), { recursive: true })
    const ref = source.ref || 'main'
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$/.test(ref) || ref.includes('..')) {
      throw new Error('Git ref must be a valid branch, tag, or commit identifier')
    }
    const git = await this.subprocess.resolveExecutable('git', undefined, signal)
    const exists = await fs.stat(path.join(target, '.git')).then(() => true, () => false)
    if (!exists) {
      await runProcess(this.subprocess, [
        git, 'clone', '--filter=blob:none', '--sparse', '--no-checkout', '--depth=1',
        source.location, target,
      ], { signal, timeoutMs: 120_000 })
    }
    await runProcess(this.subprocess, [git, '-C', target, 'fetch', '--depth=1', 'origin', ref],
      { signal, timeoutMs: 120_000 })
    await runProcess(this.subprocess, [git, '-C', target, 'checkout', '--force', 'FETCH_HEAD'],
      { signal, timeoutMs: 30_000 })
    const sparse = ['manifest.json']
    if (paths.meta) sparse.push(paths.meta.split('/').slice(0, 2).join('/'))
    if (sparse.length > 1) {
      await runProcess(this.subprocess, [git, '-C', target, 'sparse-checkout', 'set', ...sparse],
        { signal, timeoutMs: 30_000 })
    }
    return target
  }

  mirror(prefix, url) {
    if (!prefix) return url
    const base = prefix.endsWith('/') ? prefix : `${prefix}/`
    return new URL(encodeURI(url.href), base)
  }

  async fetchUrl(url, signal) {
    let lastError
    for (let attempt = 0; attempt < 3; attempt++) {
      if (signal?.aborted) throw signal.reason ?? new Error('Fetch was cancelled')
      try {
        const response = await fetch(url, { signal, redirect: 'error' })
        if (response.ok) return Buffer.from(await response.arrayBuffer())
        if (response.status < 500) throw new Error(`Fetch failed (${response.status}) for ${url}`)
        lastError = new Error(`Fetch failed (${response.status}) for ${url}`)
      } catch (error) {
        if (signal?.aborted || error?.name === 'AbortError') throw error
        lastError = error
      }
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)))
    }
    throw lastError ?? new Error(`Fetch failed for ${url}`)
  }
}

function ensureSlash(value) {
  const url = new URL(value)
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Source URL must use HTTP or HTTPS')
  if (url.pathname.endsWith('/manifest.json')) {
    url.pathname = url.pathname.slice(0, -'manifest.json'.length)
  }
  if (!url.pathname.endsWith('/')) url.pathname += '/'
  return url
}

function allFigures(question) {
  return [
    ...question.stem.figures,
    ...question.answer.figures,
    ...question.solution.figures,
    ...question.options.flatMap(option => option.figures ?? []),
  ]
}
