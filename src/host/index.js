import fs from 'node:fs/promises'
import path from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import Schema from '@deepseek-ai/schemastery'
import { createDatabase } from './db.js'
import { FeedbackService } from './feedback.js'
import { LatexEnvService } from './latex-env.js'
import { MistakeService } from './mistakes.js'
import { PaperService } from './papers.js'
import { RenderService } from './render.js'
import { SourceService } from './sources.js'
import { StudyRpcService } from './rpc.ts'
import { questionDetails, registerTools, searchQuestions } from './tools.js'

export const name = 'dsh-study'
export const inject = [
  'tools', 'connection', 'typertGateway', 'subprocess',
]

export const Config = Schema.object({
  dataDir: Schema.string().default('').volatile(),
  defaultSourceId: Schema.string().default('ustc-official').volatile(),
  mirrorBaseUrl: Schema.string().default('').volatile(),
  xelatexBin: Schema.string().default('xelatex').volatile(),
  defaultPdfTemplate: Schema.string().default('ustc-exam').volatile(),
  defaultPdfMode: Schema.string().default('inline-solution').volatile(),
  defaultPptTemplate: Schema.string().default('review-classic').volatile(),
  allowAiVariants: Schema.boolean().default(false).volatile(),
  excludeQuarantined: Schema.boolean().default(true).volatile(),
})

function configValue(value, fallback) {
  if (value && typeof value.get === 'function') return value.get() ?? fallback
  return value ?? fallback
}

function normalizeConfig(input = {}) {
  const dshHome = process.env.DSH_HOME || path.join(homedir(), '.dsh')
  const dataDir = configValue(input.dataDir, '')
  return {
    dataDir: dataDir ? path.resolve(dataDir) : path.join(dshHome, 'dsh-study'),
    defaultSourceId: configValue(input.defaultSourceId, 'ustc-official'),
    mirrorBaseUrl: configValue(input.mirrorBaseUrl, ''),
    xelatexBin: configValue(input.xelatexBin, 'xelatex'),
    defaultPdfTemplate: configValue(input.defaultPdfTemplate, 'ustc-exam'),
    defaultPdfMode: configValue(input.defaultPdfMode, 'inline-solution'),
    defaultPptTemplate: configValue(input.defaultPptTemplate, 'review-classic'),
    allowAiVariants: configValue(input.allowAiVariants, false),
    excludeQuarantined: configValue(input.excludeQuarantined, true),
  }
}

export async function apply(ctx, input = {}) {
  const config = normalizeConfig(input)
  await fs.mkdir(config.dataDir, { recursive: true })
  const db = createDatabase(config.dataDir)
  const sources = new SourceService({
    db, dataDir: config.dataDir, mirrorBaseUrl: config.mirrorBaseUrl, subprocess: ctx.subprocess,
  })
  const mistakes = new MistakeService({ db, dataDir: config.dataDir })
  const feedback = new FeedbackService({ db })
  const papers = new PaperService({
    db, allowAiVariants: config.allowAiVariants, excludeQuarantined: config.excludeQuarantined,
  })
  const base = fileURLToPath(new URL('../../', import.meta.url))
  const latexEnv = new LatexEnvService({
    dataDir: config.dataDir, subprocess: ctx.subprocess,
    xelatexBin: config.xelatexBin, mirrorBaseUrl: config.mirrorBaseUrl,
  })
  const render = new RenderService({
    db, dataDir: config.dataDir, xelatexBin: config.xelatexBin,
    subprocess: ctx.subprocess, bundleRoot: base, latexEnv,
  })
  await sources.initialize()
  const services = { db, sources, mistakes, feedback, papers, render, latexEnv, config }

  ctx.effect(() => () => db.close())
  registerTools(ctx, services)

  // 通道二：静默注入学习与出卷协作指令到系统提示（不在 / 菜单的「技能」区新增冗余条目）
  const skillPath = path.join(base, 'skills', 'dsh-study', 'SKILL.md')
  const skill = await fs.readFile(skillPath, 'utf8')
  const body = skill.replace(/^---[\s\S]+?---\s*/, '')
  ctx.inject(['systemPrompt'], scope => {
    if (typeof scope.systemPrompt?.section === 'function') {
      scope.effect(() => scope.systemPrompt.section({
        name: 'dsh-study',
        order: 9200,
        interpolate: false,
        text: () => body,
      }))
    }
  })

  // 静态只读路由 1：为前端与可打印网页提供 KaTeX 样式与数学字体（精确路径匹配）
  ctx.inject(['connection'], scope => scope.connection.fetch.register({
    path: '/api/dsh-study/katex',
    methods: ['GET', 'HEAD'],
    requestBody: 'buffered',
    async fetch(request) {
      const reqUrl = new URL(request.url)
      const fileParam = reqUrl.searchParams.get('file') ?? ''
      const filePath = await resolveKatexFile(base, fileParam)
      if (!filePath) return new Response('Not found', { status: 404 })
      try {
        const stat = await fs.stat(filePath)
        if (!stat.isFile()) return new Response('Not found', { status: 404 })
        let content = await fs.readFile(filePath)
        if (path.basename(filePath).endsWith('.css')) {
          const rewritten = content.toString('utf8').replace(/url\(fonts\//g, 'url(/api/dsh-study/katex?file=fonts/')
          content = Buffer.from(rewritten, 'utf8')
        }
        return new Response(request.method === 'HEAD' ? null : content, {
          headers: {
            'content-type': mimeType(filePath),
            'content-length': String(content.length),
            'cache-control': 'public, max-age=86400',
            'x-content-type-options': 'nosniff',
          },
        })
      } catch {
        return new Response('Not found', { status: 404 })
      }
    },
  }))

  // 静态只读路由 2：导出产物（PDF / HTML / PPTX / 预览图）与题库配图（精确路径匹配）
  ctx.inject(['connection'], scope => scope.connection.fetch.register({
    path: '/api/dsh-study/file',
    methods: ['GET', 'HEAD'],
    requestBody: 'buffered',
    async fetch(request) {
      const reqUrl = new URL(request.url)
      const pathParam = reqUrl.searchParams.get('path') ?? ''
      const filePath = await resolvePreviewFile(config.dataDir, pathParam)
      if (!filePath) return new Response('Not found', { status: 404 })
      try {
        const stat = await fs.stat(filePath)
        if (!stat.isFile()) return new Response('Not found', { status: 404 })
        const content = await fs.readFile(filePath)
        const ext = path.extname(filePath).toLowerCase()
        const isDownload = reqUrl.searchParams.get('download') === '1'
        const fileName = path.basename(filePath)
        const headers = {
          'content-type': mimeType(filePath),
          'content-length': String(stat.size),
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
          'content-disposition': `${isDownload ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        }
        if (ext === '.html') {
          headers['content-security-policy'] = "default-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data:; object-src 'none'; frame-ancestors 'self'"
        }
        return new Response(request.method === 'HEAD' ? null : content, { headers })
      } catch {
        return new Response('Not found', { status: 404 })
      }
    },
  }))

  // 通道一：零模型直出与工作台 RPC（大模型完全不参与）
  new StudyRpcService(ctx, async (endpoint, payload = {}, signal, peer) => {
    if (isMutation(endpoint) && (peer?.principal?.kind !== 'owner' || peer?.interactions !== 'answer')) {
      return { ok: false, error: { code: 'study/unauthorized', message: '该操作需要在当前登录会话中执行' } }
    }
    try {
      switch (endpoint) {
        case 'sourceList':
          return { ok: true, data: sources.list() }
        case 'sourceInspect':
          return { ok: true, data: await sources.inspect(payload.source_id, signal) }
        case 'sourceAdd':
          return { ok: true, data: await sources.add(payload, signal) }
        case 'sourceRemove':
          return { ok: true, data: sources.remove(payload.source_id) }
        case 'sourceSync':
          return { ok: true, data: await sources.sync(payload.source_id, payload.course_codes, signal) }
        case 'taxonomyList':
          return { ok: true, data: papers.taxonomyList(payload.course_codes ?? []) }
        case 'questionSearch':
          return { ok: true, data: executeReadTool(services, 'study_question_search', payload) }
        case 'questionGet':
          return { ok: true, data: executeReadTool(services, 'study_question_get', payload) }
        case 'mistakeMark':
          return { ok: true, data: mistakes.mark(payload) }
        case 'mistakeUpdate':
          return { ok: true, data: mistakes.update(payload) }
        case 'mistakeDelete':
          return { ok: true, data: mistakes.delete(payload.mistake_id) }
        case 'mistakeDraft':
          return { ok: true, data: mistakes.draft(payload) }
        case 'mistakeDraftList':
          return { ok: true, data: mistakes.listDrafts() }
        case 'mistakeDraftDismiss':
          return { ok: true, data: mistakes.dismissDraft(payload.draft_id) }
        case 'mistakeCommit':
          assertRpcConfirmation(payload.confirmed)
          return { ok: true, data: await mistakes.commit(payload.draft_id, signal) }
        case 'mistakeList':
          return { ok: true, data: mistakes.list(payload) }
        case 'mistakeReview':
          return { ok: true, data: mistakes.review(payload) }
        case 'paperAssembleMistakes':
          return { ok: true, data: mistakes.assembleMistakes(payload) }
        case 'paperAssemble':
          return { ok: true, data: papers.assemble(payload) }
        case 'paperAssembleCustom':
          return { ok: true, data: papers.assembleFromKeys(payload) }
        case 'paperGet':
          return { ok: true, data: papers.get(payload.paper_id) }
        case 'paperItemsUpdate':
          return { ok: true, data: papers.updateItems(payload.paper_id, payload.items) }
        case 'paperCommentUpdate':
          return { ok: true, data: papers.updateComments(payload.paper_id, payload.comments) }
        case 'paperDelete':
          return { ok: true, data: papers.deletePaper(payload.paper_id) }
        case 'paperList':
          return { ok: true, data: papers.list() }
        case 'variantPropose':
          return { ok: true, data: papers.proposeVariant(payload, payload) }
        case 'variantCommit':
          assertRpcConfirmation(payload.confirmed)
          return { ok: true, data: papers.confirmVariant(payload.draft_id) }
        case 'templateList':
          return { ok: true, data: await render.templates() }
        case 'envCheck':
          return { ok: true, data: await latexEnv.detect(config.xelatexBin, signal) }
        case 'envInstallLatex': {
          const current = await latexEnv.detect(config.xelatexBin, signal)
          if (current.available) return { ok: true, data: current }
          // 异步后台安装，立即返回进度状态，避免长下载触发 RPC 超时
          latexEnv.install({ mirrorBaseUrl: payload.mirrorBaseUrl || config.mirrorBaseUrl }).catch(() => {})
          return { ok: true, data: await latexEnv.detect(config.xelatexBin, signal) }
        }
        case 'feedbackList':
          return { ok: true, data: feedback.list(payload) }
        case 'feedbackSubmit':
          return { ok: true, data: await feedback.submit(payload, signal) }
        case 'exportRender':
          return { ok: true, data: await render.render(payload, signal) }
        case 'quickExport': {
          // 零模型一键直出：直接组卷（或复用已有试卷）+ 渲染 PDF/PPT
          let paperResult
          if (payload.paper_id) {
            paperResult = papers.get(payload.paper_id)
            if (!paperResult) throw new Error('所选试卷不存在')
          } else if (payload.mode === 'custom' && payload.custom_items?.length) {
            paperResult = papers.assembleFromKeys({
              title: payload.title,
              mode: 'exam',
              items: payload.custom_items,
            })
          } else if (payload.mode === 'mistake') {
            paperResult = mistakes.assembleMistakes({
              course_codes: payload.course_codes ?? [],
              mistake_ids: payload.mistake_ids ?? [],
              count: payload.count ?? 8,
              original_redo_ratio: payload.original_redo_ratio ?? 0.5,
              include_similar: payload.include_similar !== false,
              title: payload.title,
              seed: payload.seed ?? Date.now(),
            })
          } else {
            paperResult = papers.assemble({
              mode: payload.mode === 'topic' ? 'topic' : 'exam',
              title: payload.title,
              course_codes: payload.course_codes ?? [],
              kp_ids: payload.kp_ids ?? [],
              types: payload.types ?? [],
              answer_origins: payload.answer_origins ?? [],
              difficulty_min: payload.difficulty_min,
              difficulty_max: payload.difficulty_max,
              year_from: payload.year_from,
              year_to: payload.year_to,
              count: payload.count ?? 8,
              score: payload.score ?? 10,
              seed: payload.seed ?? Date.now(),
            })
          }
          const assembledCount = paperResult.items?.length ?? paperResult.assembled ?? 0
          if (assembledCount === 0) {
            throw new Error(payload.mode === 'mistake' ? '当前筛选下暂无错题，请先在「题库与错题」中标记错题' : '当前筛选条件下未匹配到题目，请先下载课程或放宽筛选条件')
          }
          const format = payload.format === 'ppt' ? 'ppt' : 'pdf'
          const template_id = payload.template_id || (format === 'ppt' ? config.defaultPptTemplate : config.defaultPdfTemplate)
          const pdfMode = payload.pdf_mode || config.defaultPdfMode
          const rendered = await render.render({
            paper_id: paperResult.paper_id,
            format,
            template_id,
            mode: pdfMode,
            options: payload.options ?? {},
          }, signal)
          return {
            ok: true,
            data: {
              paper: papers.get(paperResult.paper_id),
              gaps: paperResult.gaps ?? [],
              export: rendered,
            },
          }
        }
        case 'exportList': {
          const rows = db.prepare(`
            SELECT e.*, p.title AS paper_title
            FROM exports e
            LEFT JOIN papers p ON p.paper_id = e.paper_id
            ORDER BY e.created_at DESC LIMIT 60
          `).all()
          return { ok: true, data: rows }
        }
        default:
          return { ok: false, error: { code: 'study/not-found', message: `不支持的操作：${endpoint}` } }
      }
    } catch (error) {
      return {
        ok: false,
        error: {
          code: error.code ?? 'study/error',
          message: error instanceof Error ? error.message : String(error),
          details: {},
        },
      }
    }
  })
}

function executeReadTool(services, name, payload) {
  if (name === 'study_question_search') {
    return searchQuestions(services.db, services.papers, payload)
  }
  return questionDetails(services.db, services.config, payload)
}

function isMutation(endpoint) {
  return new Set([
    'sourceAdd', 'sourceRemove', 'sourceSync', 'mistakeMark', 'mistakeUpdate', 'mistakeDelete',
    'mistakeDraft', 'mistakeDraftDismiss', 'mistakeCommit', 'mistakeReview',
    'paperAssembleMistakes', 'paperAssemble', 'paperAssembleCustom', 'paperDelete',
    'paperCommentUpdate', 'variantPropose', 'variantCommit',
    'exportRender', 'quickExport', 'paperItemsUpdate', 'envInstallLatex', 'feedbackSubmit',
  ]).has(endpoint)
}

function assertRpcConfirmation(confirmed) {
  if (confirmed !== true) {
    throw new Error('保存草稿需要明确确认')
  }
}

async function resolveKatexFile(bundleRoot, relPath) {
  const parts = String(relPath ?? '').split('/').filter(Boolean)
  if (!parts.length || parts.some(part => part === '.' || part === '..' || part.includes('\\') || part.includes('\0'))) {
    return null
  }
  const candidates = [
    path.join(bundleRoot, 'dist', 'katex'),
    path.join(bundleRoot, 'node_modules', 'katex', 'dist'),
  ]
  for (const root of candidates) {
    const resolvedRoot = path.resolve(root)
    const target = path.resolve(resolvedRoot, ...parts)
    if (!target.startsWith(resolvedRoot + path.sep)) continue
    try {
      const [realRoot, realTarget] = await Promise.all([fs.realpath(resolvedRoot), fs.realpath(target)])
      if (realTarget.startsWith(realRoot + path.sep)) return realTarget
    } catch {}
  }
  return null
}

async function resolvePreviewFile(dataDir, relPath) {
  const parts = String(relPath ?? '').split('/').filter(Boolean)
  if (!parts.length || parts.some(part => part === '.' || part === '..' || part.includes('\\') || part.includes('\0'))) {
    return null
  }
  let relative
  if (parts[0] === 'exports' && parts.length >= 4) {
    relative = path.join('exports', ...parts.slice(1))
  } else if (parts[0] === 'cache' && parts.length >= 5 && parts[3] === 'assets') {
    relative = path.join('cache', parts[1], 'courses', parts[2], ...parts.slice(3))
  } else if (parts[0] === 'personal' && parts.length >= 4 && parts[3] === 'assets') {
    relative = path.join('personal', 'courses', parts[2], ...parts.slice(3))
  } else {
    return null
  }
  const root = path.resolve(dataDir)
  const file = path.resolve(root, relative)
  if (!file.startsWith(root + path.sep)) return null
  try {
    const [realRoot, realFile] = await Promise.all([fs.realpath(root), fs.realpath(file)])
    return realFile.startsWith(realRoot + path.sep) ? realFile : null
  } catch {
    return null
  }
}

function mimeType(filePath) {
  return ({
    '.pdf': 'application/pdf',
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.woff2': 'font/woff2',
    '.woff': 'font/woff',
    '.ttf': 'font/ttf',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.tex': 'text/plain; charset=utf-8',
  })[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream'
}
