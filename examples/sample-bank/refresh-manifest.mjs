#!/usr/bin/env node
// 零依赖辅助脚本：修改 courses/<课号>/{questions.jsonl,taxonomy.json,meta.json} 后，
// 运行 `node refresh-manifest.mjs` 自动重算统计数据与 SHA-256，确保通过 dsh-study 导入校验。

import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const coursesDir = path.join(root, 'courses')

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

const entries = (await fs.readdir(coursesDir, { withFileTypes: true }))
  .filter(d => d.isDirectory())
  .map(d => d.name)
  .sort()

const manifestCourses = []
const totalOrigin = { official: 0, community: 0, ai: 0 }
let totalQuestions = 0
let totalQuarantined = 0

for (const code of entries) {
  const dir = path.join(coursesDir, code)
  const metaPath = path.join(dir, 'meta.json')
  const taxPath = path.join(dir, 'taxonomy.json')
  const qPath = path.join(dir, 'questions.jsonl')

  const [taxBuf, qBuf] = await Promise.all([fs.readFile(taxPath), fs.readFile(qPath)])
  const taxonomy = JSON.parse(taxBuf.toString('utf8'))
  const questions = qBuf.toString('utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line))

  let existingMeta = {}
  try { existingMeta = JSON.parse(await fs.readFile(metaPath, 'utf8')) } catch {}

  const byOrigin = { official: 0, community: 0, ai: 0 }
  const byType = {}
  const byDifficulty = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
  const years = new Set()
  const batchCounts = new Map()
  let quarantined = 0

  for (const q of questions) {
    const origin = q.answer?.origin
    if (origin in byOrigin) byOrigin[origin]++
    byType[q.type] = (byType[q.type] ?? 0) + 1
    const diff = String(q.tags?.difficulty ?? 3)
    if (diff in byDifficulty) byDifficulty[diff]++
    if (Number.isInteger(q.source?.year)) years.add(q.source.year)
    if (q.quality?.quarantined) quarantined++
    const batchId = q.source?.batch || 'default'
    batchCounts.set(batchId, {
      count: (batchCounts.get(batchId)?.count ?? 0) + 1,
      rights: q.source?.rights || 'original',
    })
  }

  const prevBatchDesc = new Map((existingMeta.batches ?? []).map(b => [b.id, b.description]))
  const batches = [...batchCounts.entries()].map(([id, info]) => ({
    id,
    count: info.count,
    rights: info.rights,
    description: prevBatchDesc.get(id) ?? '自定义题目批次',
  }))

  const examYears = [...years].sort((a, b) => a - b)
  const meta = {
    schema_version: '1.0',
    code,
    name: existingMeta.name ?? code,
    name_en: existingMeta.name_en ?? code,
    department: existingMeta.department ?? '自定义题库',
    category: existingMeta.category ?? '示例课程',
    description: existingMeta.description ?? '自建题库课程示例',
    stats: {
      total: questions.length,
      quarantined,
      taxonomy_nodes: (taxonomy.nodes ?? []).length,
      by_origin: byOrigin,
      by_type: byType,
      by_difficulty: byDifficulty,
      exam_years: examYears,
    },
    batches,
    known_notes: existingMeta.known_notes ?? [],
    files: { questions: 'questions.jsonl', taxonomy: 'taxonomy.json' },
    sha256: { questions: sha256(qBuf), taxonomy: sha256(taxBuf) },
  }

  const metaText = `${JSON.stringify(meta, null, 2)}\n`
  await fs.writeFile(metaPath, metaText, 'utf8')

  manifestCourses.push({
    code: meta.code,
    name: meta.name,
    name_en: meta.name_en,
    department: meta.department,
    category: meta.category,
    total: meta.stats.total,
    quarantined,
    by_origin: byOrigin,
    exam_years: examYears,
    paths: {
      meta: `courses/${code}/meta.json`,
      taxonomy: `courses/${code}/taxonomy.json`,
      questions: `courses/${code}/questions.jsonl`,
    },
    sha256: {
      meta: sha256(Buffer.from(metaText, 'utf8')),
      taxonomy: meta.sha256.taxonomy,
      questions: meta.sha256.questions,
    },
  })

  totalQuestions += questions.length
  totalQuarantined += quarantined
  for (const k of ['official', 'community', 'ai']) totalOrigin[k] += byOrigin[k]
}

const manifestPath = path.join(root, 'manifest.json')
let existingManifest = {}
try { existingManifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) } catch {}

const manifest = {
  name: existingManifest.name ?? 'dsh-study 示例题库模板',
  schema_version: '1.0',
  data_version: existingManifest.data_version ?? '1.0.0',
  updated_at: new Date().toISOString().slice(0, 10),
  repository: existingManifest.repository ?? 'local://sample-bank',
  asset_base_url: null,
  license: existingManifest.license ?? {
    code_and_schema: 'MIT',
    question_content: 'Original sample questions (MIT)',
  },
  stats: {
    courses: manifestCourses.length,
    questions: totalQuestions,
    quarantined: totalQuarantined,
    by_origin: totalOrigin,
  },
  courses: manifestCourses,
}

await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
console.log(`Updated manifest.json (${manifestCourses.length} course(s), ${totalQuestions} question(s))`)
