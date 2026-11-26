import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import katex from 'katex'
import PptxGenJS from 'pptxgenjs'
import { Resvg } from '@resvg/resvg-js'
import { mathjax } from 'mathjax-full/js/mathjax.js'
import { TeX } from 'mathjax-full/js/input/tex.js'
import { AllPackages } from 'mathjax-full/js/input/tex/AllPackages.js'
import { SVG } from 'mathjax-full/js/output/svg.js'
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js'
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js'
import { createStageError, formatErrorMessage } from './errors.js'
import { runProcess } from './process.js'
import { LatexEnvService } from './latex-env.js'

const adaptor = liteAdaptor()
RegisterHTMLHandler(adaptor)
const mathDocument = mathjax.document('', {
  InputJax: new TeX({ packages: AllPackages }),
  OutputJax: new SVG({ fontCache: 'none' }),
})

const templateDefaults = [
  {
    id: 'ustc-exam',
    kind: 'pdf',
    name: '中科大标准考试卷',
    description: '奇数页装订线、动态得分表、黑体解/证明、红色点评',
    engine: 'xelatex',
    supportsModes: ['inline-solution', 'split'],
    entry: './template.tex',
  },
  {
    id: 'gaokao',
    kind: 'pdf',
    name: '高考标准考试卷',
    description: '全国标准考试卷版式（卷头注意事项、大题赋分、连续编号）',
    engine: 'xelatex',
    supportsModes: ['inline-solution', 'split'],
    entry: './template.tex',
  },
  {
    id: 'review-classic',
    kind: 'ppt',
    name: '经典讲评 PPT',
    description: '16:9 宽屏封面 + 每题双页（作答页与解析讲评页）',
    engine: 'pptxgenjs',
  },
]

const MATH_SPLIT_RE = /(\$\$[\s\S]+?\$\$|\$[^$\n]+\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\))/g

export class RenderService {
  constructor({ db, dataDir, xelatexBin = 'xelatex', subprocess, bundleRoot, latexEnv }) {
    this.db = db
    this.dataDir = dataDir
    this.xelatexBin = xelatexBin
    this.subprocess = subprocess
    this.bundleRoot = bundleRoot
    this.latexEnv = latexEnv ?? new LatexEnvService({ dataDir, subprocess, xelatexBin })
    this.exportsRoot = path.join(dataDir, 'exports')
  }

  async templates() {
    const result = templateDefaults.map(template => ({ ...template, source: 'builtin' }))
    for (const kind of ['pdf', 'ppt']) {
      const directory = path.join(this.dataDir, 'templates', kind)
      const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => [])
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const file = path.join(directory, entry.name, 'template.json')
        const template = await fs.readFile(file, 'utf8').then(JSON.parse, () => null)
        if (!template || template.kind !== kind || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(template.id)) continue
        const index = result.findIndex(item => item.kind === kind && item.id === template.id)
        const discovered = { ...template, source: 'custom' }
        if (index >= 0) result[index] = discovered
        else result.push(discovered)
      }
    }
    return result
  }

  async render({ paper_id, format, template_id, mode = 'inline-solution', options = {} }, signal) {
    const paper = this.loadPaper(paper_id)
    const templates = await this.templates()
    const targetKind = format === 'ppt' ? 'ppt' : 'pdf'
    const resolvedTemplateId = template_id || (targetKind === 'ppt' ? 'review-classic' : 'ustc-exam')
    const template = templates.find(item => item.id === resolvedTemplateId && item.kind === targetKind)
    if (!template) throw new Error(`未找到模板：${resolvedTemplateId}`)
    const exportId = randomUUID()
    const outputDir = path.join(this.exportsRoot, paper_id, exportId)
    await fs.mkdir(outputDir, { recursive: true })
    let result
    if (format === 'ppt') {
      result = await this.renderPpt(paper, template, outputDir, options, signal)
    } else if (format === 'pdf') {
      if (!['inline-solution', 'split'].includes(mode)) throw new Error('PDF 版式仅支持「题目后附解析」或「原题与答案分开」')
      result = await this.renderPdf(paper, template, mode, options, outputDir, signal)
    } else {
      throw new Error('导出格式仅支持 PDF 或 PPT')
    }
    const status = result.degraded_reason ? 'degraded' : 'ok'
    this.db.prepare(`
      INSERT INTO exports(export_id,paper_id,format,template_id,export_mode,options_json,
        artifacts_json,status,degraded_reason,log_excerpt,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)
    `).run(exportId, paper_id, format, template.id, format === 'ppt' ? 'slides' : mode,
      JSON.stringify(options), JSON.stringify(result.artifacts), status,
      result.degraded_reason ?? null, result.log?.slice(-4000) ?? null, new Date().toISOString())
    return { export_id: exportId, paper_id, format, template_id: template.id, export_mode: format === 'ppt' ? 'slides' : mode, status, ...result }
  }

  loadPaper(paperId) {
    const paper = this.db.prepare('SELECT * FROM papers WHERE paper_id=?').get(paperId)
    if (!paper) throw new Error(`未找到指定试卷`)
    const items = this.db.prepare('SELECT * FROM paper_items WHERE paper_id=? ORDER BY seq').all(paperId)
      .map(item => ({ ...item, question: JSON.parse(item.question_snapshot_json) }))
    const courseCodes = JSON.parse(paper.course_codes_json)
    const courseNames = courseCodes.map(code => {
      const row = this.db.prepare('SELECT name FROM courses WHERE code=? ORDER BY installed DESC LIMIT 1').get(code)
      return row?.name || code
    })
    return {
      ...paper,
      header_meta: JSON.parse(paper.header_meta_json),
      course_codes: courseCodes,
      course_names: courseNames,
      items,
    }
  }

  async resolveQuestionFigures(item) {
    const resolved = new Map()
    const question = item.question
    const figs = [
      ...(question.stem?.figures ?? []),
      ...(question.answer?.figures ?? []),
      ...(question.solution?.figures ?? []),
      ...(question.options ?? []).flatMap(o => o.figures ?? []),
    ]
    const baseDir = item.source_id === 'local-personal'
      ? path.join(this.dataDir, 'personal', 'courses', question.course_code)
      : path.join(this.dataDir, 'cache', item.source_id, 'courses', question.course_code)
    for (const fig of figs) {
      if (!fig?.path) continue
      const full = path.resolve(baseDir, ...fig.path.split('/'))
      try {
        const fh = await fs.open(full, 'r')
        try {
          const head = Buffer.alloc(8)
          const { bytesRead } = await fh.read(head, 0, 8, 0)
          if (bytesRead >= 4 && isValidLatexImageHeader(head)) {
            resolved.set(fig.path, full)
          }
        } finally {
          await fh.close()
        }
      } catch {}
    }
    return resolved
  }

  async renderPdf(paper, template, mode, options, outputDir, signal) {
    const fields = buildPdfFields(paper, mode, options)
    const figureMaps = new Map()
    for (const item of paper.items) {
      figureMaps.set(`${item.source_id}\0${item.question_id}`, await this.resolveQuestionFigures(item))
    }

    const artifacts = {}
    const texPaths = []
    const logPaths = []
    let log = ''
    let degradedReason = null
    let errorExcerpt = null
    const splitLayout = options.splitLayout === 'combined' ? 'combined' : 'two-files'

    const outputs = mode === 'split'
      ? (splitLayout === 'combined'
        ? [{ name: 'inline', combinedSplit: true, items: paper.items, showSolutions: false, answerOnly: false }]
        : [
          { name: 'paper', items: paper.items, showSolutions: false, answerOnly: false },
          { name: 'answers', items: paper.items, showSolutions: true, answerOnly: true },
        ])
      : [{ name: 'inline', items: paper.items, showSolutions: true, answerOnly: false }]

    for (const output of outputs) {
      const custom = template.source === 'custom'
      const entry = String(template.entry ?? 'template.tex.hbs').replace(/^\.\//, '')
      const templatePath = custom
        ? safeTemplatePath(path.join(this.dataDir, 'templates', 'pdf', template.id), entry)
        : path.join(this.bundleRoot, 'templates', 'pdf', template.id, 'template.tex')
      const templateSource = await fs.readFile(templatePath, 'utf8').catch(() => null)

      const generateTex = (safeFallback = false) => {
        if (custom) {
          return this.buildCustomTex(paper, output, fields, options, templateSource, figureMaps, safeFallback)
        }
        return Promise.resolve(buildTex(template.id, paper, output, fields, options, templateSource, figureMaps, safeFallback))
      }

      let tex = await generateTex(false)
      const texPath = path.join(outputDir, `${output.name}.tex`)
      await fs.writeFile(texPath, tex, 'utf8')
      artifacts[`${output.name}Tex`] = this.publicPath(texPath)
      texPaths.push(texPath)

      let compiled = await this.compileTex(texPath, outputDir, signal)
      log += compiled.log
      const firstCompiled = compiled
      if (!compiled.ok && !/未检测到本机 xelatex|不可用|unavailable/i.test(compiled.reason ?? '')) {
        // 保留首次失败的 .tex 与 .log 现场，避免安全降级重试覆盖定位线索
        const firstTexPath = path.join(outputDir, `${output.name}.first-attempt.tex`)
        const firstLogPath = path.join(outputDir, `${output.name}.first-attempt.log`)
        await fs.writeFile(firstTexPath, tex, 'utf8').catch(() => {})
        await fs.writeFile(firstLogPath, compiled.log || '', 'utf8').catch(() => {})
        texPaths.push(firstTexPath)
        logPaths.push(firstLogPath)

        // Retry once with ultra-safe LaTeX fallback sanitization
        tex = await generateTex(true)
        await fs.writeFile(texPath, tex, 'utf8')
        const retried = await this.compileTex(texPath, outputDir, signal)
        log += `\n--- 安全降级重试 ---\n${retried.log}`
        compiled = retried
      }

      if (compiled.logPath) {
        artifacts[`${output.name}Log`] = this.publicPath(compiled.logPath)
        logPaths.push(compiled.logPath)
      }

      const artifactName = output.name === 'paper' ? 'questionPdf'
        : output.name === 'answers' ? 'answerPdf' : 'inlinePdf'
      if (compiled.ok) {
        artifacts[artifactName] = this.publicPath(path.join(outputDir, `${output.name}.pdf`))
      } else {
        degradedReason = compiled.reason
        errorExcerpt = firstCompiled.errorExcerpt || compiled.errorExcerpt || null
      }
      artifacts[`${output.name}TexPath`] = this.publicPath(texPath)
    }

    const htmlOutputs = mode === 'split'
      ? [
        { name: 'paper', items: paper.items, showSolutions: false, answerOnly: false },
        { name: 'answers', items: paper.items, showSolutions: true, answerOnly: true },
      ]
      : [{ name: 'inline', items: paper.items, showSolutions: true, answerOnly: false }]

    const htmlPath = path.join(outputDir, 'preview.html')
    const katexRoot = await firstExistingPath([
      path.join(this.bundleRoot, 'dist', 'katex'),
      path.join(this.bundleRoot, 'node_modules', 'katex', 'dist'),
    ])
    await fs.copyFile(path.join(katexRoot, 'katex.min.css'), path.join(outputDir, 'katex.min.css'))
    await fs.cp(path.join(katexRoot, 'fonts'), path.join(outputDir, 'fonts'), { recursive: true })
    await fs.writeFile(htmlPath, buildPrintableHtml(paper, htmlOutputs, fields, mode), 'utf8')
    artifacts.html = this.publicPath(htmlPath)

    return {
      artifacts,
      degraded_reason: degradedReason,
      error_excerpt: errorExcerpt,
      log,
      tex_paths: [...new Set(texPaths)],
      log_paths: [...new Set(logPaths)],
      preview_url: artifacts.inlinePdf || artifacts.questionPdf || artifacts.html,
      output_dir: this.publicPath(outputDir),
      output_dir_abs: outputDir,
    }
  }

  async buildCustomTex(paper, output, fields, options, templateSource, figureMaps, safeFallback) {
    const baseSource = await fs.readFile(path.join(this.bundleRoot, 'templates', 'pdf', 'ustc-exam', 'template.tex'), 'utf8')
    const standard = buildTex('ustc-exam', paper, output, fields, options, baseSource, figureMaps, safeFallback)
    const begin = standard.indexOf('\\begin{document}')
    const end = standard.lastIndexOf('\\end{document}')
    const content = standard.slice(begin + '\\begin{document}'.length, end).trim()
    return interpolateTemplate(templateSource, {
      document: standard,
      body: content,
      title: latexText(fields.courseTitle),
      schoolTerm: latexText(fields.schoolTerm),
      examDate: latexText(fields.examDate),
      mode: fields.mode,
    })
  }

  async compileTex(texPath, cwd, signal) {
    if (!this.subprocess) return { ok: false, reason: '本地排版进程服务不可用，已切换为可打印网页版', log: '' }
    const detected = await this.latexEnv.detect(this.xelatexBin, signal)
    if (!detected.available || !detected.executable) {
      return { ok: false, reason: '未检测到本机 xelatex，可点击「一键安装」部署轻量 LaTeX 环境，当前已提供可打印网页版', log: '' }
    }
    const executable = detected.executable
    const binDir = path.dirname(executable)
    const env = (binDir && binDir !== '.')
      ? { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}` }
      : undefined
    const texBaseName = path.basename(texPath)
    const stemName = texBaseName.replace(/\.tex$/i, '')
    const compileLogPath = path.join(cwd, `${stemName}.compile.log`)
    const texLogPath = path.join(cwd, `${stemName}.log`)
    let log = ''
    try {
      for (let pass = 0; pass < 2; pass++) {
        if (signal?.aborted) throw signal.reason ?? new Error('导出已取消')
        const result = await runProcess(this.subprocess, [
          executable, '-no-shell-escape', '-halt-on-error', '-interaction=nonstopmode',
          '-file-line-error', texBaseName,
        ], { cwd, env, signal, timeoutMs: 90_000, check: false })
        log += `=== XeLaTeX Pass ${pass + 1} (exit=${result.exitCode}) ===\n${result.stdout}\n${result.stderr}\n`
        if (result.exitCode !== 0) {
          await fs.writeFile(compileLogPath, log, 'utf8').catch(() => {})
          const nativeLog = await fs.readFile(texLogPath, 'utf8').catch(() => '')
          const excerpt = extractLatexErrorSummary(log, nativeLog, texBaseName)
          const preferredLogPath = nativeLog ? texLogPath : compileLogPath
          const summary = excerpt ? `：${excerpt}` : ''
          return {
            ok: false,
            reason: `LaTeX 编译未通过（第 ${pass + 1} 遍）${summary}；已提供可打印网页版（日志：${preferredLogPath}）`,
            errorExcerpt: excerpt,
            logPath: preferredLogPath,
            log,
          }
        }
      }
      await fs.writeFile(compileLogPath, log, 'utf8').catch(() => {})
      return { ok: true, log, logPath: compileLogPath }
    } catch (error) {
      const msg = formatErrorMessage(error, '未知编译异常')
      log += `\n=== Exception ===\n${msg}\n`
      await fs.writeFile(compileLogPath, log, 'utf8').catch(() => {})
      return {
        ok: false,
        reason: `LaTeX 编译异常：${msg}（日志：${compileLogPath}）`,
        errorExcerpt: msg,
        logPath: compileLogPath,
        log,
      }
    }
  }

  async loadPptAssets() {
    const candidates = [
      path.join(this.bundleRoot, 'templates', 'ppt', 'review-classic', 'assets'),
      path.join(this.bundleRoot, 'dist', 'templates', 'ppt', 'review-classic', 'assets'),
    ]
    let assetDir = null
    for (const dir of candidates) {
      try {
        await fs.access(dir)
        assetDir = dir
        break
      } catch {}
    }
    if (!assetDir) return { fontFiles: [] }
    const readDataUri = async (file, mime) => {
      try {
        const buf = await fs.readFile(path.join(assetDir, file))
        return `data:${mime};base64,${buf.toString('base64')}`
      } catch {
        return null
      }
    }
    const fontFiles = []
    for (const fontName of [
      'SpaceGrotesk-Bold.ttf',
      'SpaceGrotesk-SemiBold.ttf',
      'JetBrainsMono-Medium.ttf',
      'NotoSansSC-Bold.ttf',
      'NotoSansSC-Regular.ttf',
    ]) {
      const fp = path.join(assetDir, 'fonts', fontName)
      try {
        await fs.access(fp)
        fontFiles.push(fp)
      } catch {}
    }
    return {
      bgContent: await readDataUri('bg-content.jpg', 'image/jpeg'),
      iconQuestion: await readDataUri('icon-question.png', 'image/png'),
      iconSolution: await readDataUri('icon-solution.png', 'image/png'),
      fontFiles,
    }
  }

  async renderPpt(paper, template, outputDir, options = {}, signal) {
    let stage = 'ppt-init'
    const errorLogPath = path.join(outputDir, 'export-error.log')
    try {
      if (signal?.aborted) throw signal.reason ?? new Error('导出已取消')
      const rasterizeText = Boolean(options?.rasterizeText)
      const maxThumbnails = Number.isInteger(options?.maxThumbnails) ? Math.max(0, options.maxThumbnails) : 40
      const assets = await this.loadPptAssets()
      const pptx = new PptxGenJS()
      pptx.layout = 'LAYOUT_WIDE'
      pptx.author = 'dsh-study'
      pptx.subject = '课程讲评与错题复盘'
      pptx.title = paper.title
      pptx.company = 'dsh-study'
      const theme = {
        background: stripHash(template.theme?.background ?? 'FAF9F5'),
        text: stripHash(template.theme?.text ?? '15181E'),
        body: stripHash(template.theme?.body ?? '2B2F36'),
        accent: stripHash(template.theme?.accent ?? '1F5FC9'),
        highlight: stripHash(template.theme?.highlight ?? 'B45309'),
        muted: stripHash(template.theme?.muted ?? '6B6F76'),
        border: stripHash(template.theme?.border ?? 'DAD7CE'),
        railMuted: stripHash(template.theme?.railMuted ?? 'B9B6AC'),
      }
      pptx.theme = { headFontFace: PPTX_TITLE_FONT, bodyFontFace: PPTX_TITLE_FONT, lang: 'zh-CN' }

      const modeLabel = ({ mistake: '错题巩固', exam: '模拟测试', topic: '专题练习' })[paper.mode] ?? '练习讲评'
      const totalQuestions = paper.items.length

      // 使用母版复用内容页底图，避免多页重复写入导致 .pptx 体积膨胀
      if (assets.bgContent) {
        pptx.defineSlideMaster({
          title: 'DSH_CONTENT',
          background: { data: assets.bgContent },
        })
      }

      const thumbnailRoot = path.join(outputDir, 'slides')
      await fs.mkdir(thumbnailRoot, { recursive: true })
      const slides = []
      const emit = async (items, meta, notes) => {
        const slideNo = slides.length + 1
        stage = `ppt-slide-${slideNo}`
        const useContentMaster = Boolean(assets.bgContent && items.some(it => it.type === 'bg-image'))
        const slide = useContentMaster ? pptx.addSlide({ masterName: 'DSH_CONTENT' }) : pptx.addSlide()
        if (!useContentMaster) slide.background = { color: theme.background }
        drawScenePptx(pptx, slide, items, assets.fontFiles, { skipBgImage: useContentMaster, rasterizeText })
        if (notes) slide.addNotes(notes)
        let thumbnailPath = null
        if (slideNo <= maxThumbnails) {
          stage = `ppt-thumb-${slideNo}`
          const file = path.join(thumbnailRoot, `slide-${String(slideNo).padStart(3, '0')}.png`)
          await fs.writeFile(file, renderSvgToPng(sceneToSvg(items, theme), SLIDE_W, assets.fontFiles))
          thumbnailPath = this.publicPath(file)
        }
        slides.push({ ...meta, thumbnail_path: thumbnailPath })
      }

      // --- 封面页 ---
      stage = 'ppt-cover'
      await emit(coverScene(theme, {
        kicker: modeLabel,
        title: paper.title,
        assets,
      }), { title: paper.title, type: 'cover', question_id: null })

      for (const [index, item] of paper.items.entries()) {
        if (signal?.aborted) throw signal.reason ?? new Error('导出已取消')
        stage = `ppt-question-${index + 1}`
        const question = item.question
        const refShort = truncateText(question.source?.ref ?? '', 34)
        const badge = item.is_ai_variant ? 'AI 变式' : item.is_original_redo ? '错题重做' : ''
        const qType = typeLabel(question.type)

        // --- 作答页 ---
        const qBlocks = [{ text: question.stem.md, color: theme.body }]
        if (question.options?.length) {
          for (const opt of question.options) {
            qBlocks.push({ label: `${opt.key}. `, labelColor: theme.accent, text: opt.md, color: theme.body, indent: 18 })
          }
        }
        const qPages = composeRichPages(qBlocks, {
          maxWidth: BODY_W,
          maxHeight: 540,
          preferredFontSize: 25,
          minFontSize: 18,
          defaultColor: theme.body,
        })

        for (const [pageIdx, page] of qPages.entries()) {
          const pageSuffix = qPages.length > 1 ? `（${pageIdx + 1}/${qPages.length}）` : ''
          await emit(contentScene(theme, {
            number: index + 1,
            total: totalQuestions,
            tone: 'question',
            heading: `${qType} · ${item.score} 分${pageSuffix}`,
            aside: [badge, refShort].filter(Boolean).join('　·　'),
            page,
            assets,
          }), { title: `第 ${index + 1} 题 · 作答${pageSuffix}`, type: 'question', question_id: question.id })
        }

        // --- 解析页（长解析自动分页，不截断）---
        stage = `ppt-solution-${index + 1}`
        const solBlocks = []
        if (shouldShowAnswerLine(question)) {
          solBlocks.push({
            label: '【答案】',
            labelColor: theme.highlight,
            text: question.answer.md,
            color: theme.body,
          })
        }
        const solBody = resolveSolutionText(question)
        if (solBody) {
          solBlocks.push({
            label: question.type === 'proof' ? '【证明】' : '【详解】',
            labelColor: theme.highlight,
            text: solBody,
            color: theme.body,
          })
        }
        const reviewNote = [item.comment_md, question.quality?.note].filter(Boolean).join('；')
        if (reviewNote) {
          solBlocks.push({ label: '【点评与易错】', labelColor: 'C01C28', text: reviewNote, color: 'C01C28' })
        }

        const solPages = composeRichPages(solBlocks, {
          maxWidth: BODY_W,
          maxHeight: 545,
          preferredFontSize: 22,
          minFontSize: 16,
          defaultColor: theme.body,
        })

        const notesText = [
          `题目出处：${question.source?.ref || '未标注'}`,
          `知识点：${(question.tags?.kp_ids ?? []).join('、')}`,
          `难度：${question.tags?.difficulty ?? 3} / 5`,
          `答案来源：${originLabel(question.answer.origin)}（${question.answer.origin_detail || '无'}）`,
          `完整解析：\n${question.solution.md || question.answer.md}`,
        ].join('\n')

        for (const [pageIdx, page] of solPages.entries()) {
          const pageSuffix = pageIdx > 0 ? `（续 ${pageIdx + 1}/${solPages.length}）` : ''
          await emit(contentScene(theme, {
            number: index + 1,
            total: totalQuestions,
            tone: 'solution',
            heading: `解析 · ${qType}${pageSuffix}`,
            aside: refShort,
            page,
            assets,
          }), {
            title: `第 ${index + 1} 题 · 解析${pageIdx > 0 ? ` (${pageIdx + 1})` : ''}`,
            type: 'solution',
            question_id: question.id,
          }, pageIdx === 0 ? notesText : null)
        }
      }

      stage = 'ppt-write-file'
      const file = path.join(outputDir, 'review.pptx')
      await pptx.writeFile({ fileName: file })
      const manifest = {
        paper_id: paper.paper_id,
        template_id: template.id,
        title: paper.title,
        text_layer: !rasterizeText,
        total_slides: slides.length,
        thumbnails_generated: slides.filter(s => Boolean(s.thumbnail_path)).length,
        slides,
      }
      const manifestPath = path.join(outputDir, 'slides-manifest.json')
      await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')
      return {
        artifacts: {
          pptx: this.publicPath(file),
          slidesManifest: this.publicPath(manifestPath),
        },
        preview_url: this.publicPath(manifestPath),
        output_dir: this.publicPath(outputDir),
        output_dir_abs: outputDir,
        tex_paths: [],
        log_paths: [],
      }
    } catch (error) {
      const detail = error instanceof Error ? (error.stack || error.message) : formatErrorMessage(error)
      await fs.writeFile(errorLogPath, `stage: ${stage}\nerror: ${detail}\n`, 'utf8').catch(() => {})
      throw createStageError(stage, error, { output_dir: outputDir, log_path: errorLogPath })
    }
  }

  publicPath(filePath) {
    return path.relative(this.dataDir, filePath).split(path.sep).join('/')
  }
}

// ============================================================================
// PDF 模板拼装与 LaTeX 消毒
// ============================================================================

function currentAcademicTerm() {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  if (month >= 8) return `${year}--${year + 1}学年第一学期`
  if (month <= 1) return `${year - 1}--${year}学年第一学期`
  return `${year - 1}--${year}学年第二学期`
}

function formatDateDots(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}.${m}.${d}`
}

function buildPdfFields(paper, mode, options = {}) {
  const term = currentAcademicTerm()
  const defaultSchoolTerm = `中国科学技术大学${term}`
  return {
    schoolTerm: String(options.schoolTerm || paper.header_meta?.schoolTerm || defaultSchoolTerm),
    courseTitle: String(options.courseTitle || paper.header_meta?.courseTitle || paper.title),
    examDate: String(options.examDate || paper.header_meta?.examDate || formatDateDots(new Date())),
    examForm: String(options.examForm || paper.header_meta?.examForm || '闭卷'),
    footerTerm: String(options.footerTerm || paper.header_meta?.footerTerm || term),
    subject: String(options.subject || paper.course_names?.[0] || '数学'),
    showBindingLine: options.showBindingLine !== false,
    writeSpace: { compact: '3cm', standard: '5.5cm', spacious: '7cm' }[options.writeSpace] ?? '5.5cm',
    mode,
  }
}

function buildTex(templateId, paper, output, fields, options, source, figureMaps, safeFallback = false) {
  const isGaokao = templateId === 'gaokao'
  if (!source) throw new Error(`缺少模板文件：${templateId}`)

  if (output.combinedSplit) {
    const qOut = { ...output, combinedSplit: false, showSolutions: false, answerOnly: false }
    const aOut = { ...output, combinedSplit: false, showSolutions: true, answerOnly: true }
    const preamble = buildPreamble(isGaokao, source, fields, { showSolutions: false, answerOnly: false })
    const qBody = buildDocumentSection(isGaokao, paper, qOut, fields, figureMaps, safeFallback, true)
    const aBody = buildDocumentSection(isGaokao, paper, aOut, fields, figureMaps, safeFallback, true)
    const switchCmd = isGaokao
      ? '\\GaokaoAnswerOnlytrue\\GaokaoShowAnswertrue\n'
      : '\\ShowBindingLinefalse\\AnswerSheetOnlytrue\\ShowInlineSolutiontrue\n'
    return `${preamble}\n\\begin{document}\n${qBody}\n\\clearpage\n${switchCmd}${aBody}\n\\end{document}\n`
  }

  const preamble = buildPreamble(isGaokao, source, fields, output)
  const docBody = buildDocumentSection(isGaokao, paper, output, fields, figureMaps, safeFallback, false)
  return `${preamble}\n\\begin{document}\n${docBody}\n\\end{document}\n`
}

function buildPreamble(isGaokao, source, fields, output) {
  const marker = source.indexOf('% Dynamic question and answer content')
  const base = marker >= 0 ? source.slice(0, marker) : source
  if (isGaokao) {
    return base
      .replace('__DSH_SHOW_ANSWER__', output.showSolutions ? 'true' : 'false')
      .replace('__DSH_ANSWER_ONLY__', output.answerOnly ? 'true' : 'false')
      .replace('__DSH_SOLUTION_MODE__', output.showSolutions ? 'show-stay' : 'hide')
      .replace('__DSH_TITLE__', latexText(fields.courseTitle))
      .replace('__DSH_SUBJECT__', latexText(fields.subject))
  }
  return base
    .replace('__DSH_EXAM_SCHOOL_TERM__', latexText(fields.schoolTerm))
    .replace('__DSH_EXAM_COURSE_TITLE__', latexText(fields.courseTitle))
    .replace('__DSH_EXAM_DATE__', latexText(fields.examDate))
    .replace('__DSH_EXAM_FORM__', latexText(fields.examForm))
    .replace('__DSH_EXAM_FOOTER_TERM__', latexText(fields.footerTerm))
    .replace('\\ShowBindingLinetrue', `\\ShowBindingLine${fields.showBindingLine && !output.answerOnly ? 'true' : 'false'}`)
    .replace('\\ShowInlineSolutiontrue', `\\ShowInlineSolution${output.showSolutions ? 'true' : 'false'}`)
    .replace('\\AnswerSheetOnlyfalse', `\\AnswerSheetOnly${output.answerOnly ? 'true' : 'false'}`)
}

function buildDocumentSection(isGaokao, paper, output, fields, figureMaps, safeFallback, isCombined) {
  const lines = []
  const totalScore = paper.items.reduce((sum, item) => sum + Number(item.score || 0), 0)

  if (isGaokao) {
    if (isCombined && !output.answerOnly) {
      lines.push('\\GaokaoAnswerOnlyfalse')
      lines.push('\\GaokaoShowAnswerfalse')
    }
    lines.push('\\GaokaoHeader')
    if (!output.answerOnly) {
      lines.push('\\begin{GaokaoNotice}')
      lines.push('  \\item 答卷前，考生务必将自己的姓名、学号或准考证号填写清楚。')
      lines.push('  \\item 客观题请在括号内填涂正确选项；非选择题应写出必要的文字说明、证明过程或演算步骤。')
      lines.push(`  \\item 本试卷共 ${paper.items.length} 题，满分 ${totalScore} 分。`)
      lines.push('\\end{GaokaoNotice}')
    }
  } else {
    if (isCombined && !output.answerOnly) {
      lines.push('\\ShowBindingLine' + (fields.showBindingLine ? 'true' : 'false'))
      lines.push('\\AnswerSheetOnlyfalse')
      lines.push('\\ShowInlineSolutionfalse')
    }
    lines.push('\\UstcHeader')
    lines.push(scoreTable(paper.items, output.answerOnly))
  }

  let sequence = 0
  const groups = groupItems(output.items)
  for (const [sectionIndex, group] of groups.entries()) {
    const scoreDetail = formatSectionScore(group)
    if (isGaokao) {
      const sectionNumber = chineseNumber(sectionIndex + 1)
      lines.push(`\\GaokaoSection{${sectionNumber}}{${latexText(group.title)}：${scoreDetail}}`)
      lines.push(`\\begin{enumerate}[label=\\arabic*., start=${sequence + 1}, leftmargin=2.2em, itemsep=4mm]`)
    } else {
      const sectionNumber = chineseNumber(sectionIndex + 1)
      lines.push(`\\UstcSection{${sectionNumber}}{${scoreDetail}}{${latexText(group.title)}}`)
      lines.push('\\begin{enumerate}[label=(\\arabic*), leftmargin=2.2em, itemsep=3.5mm]')
    }

    for (const item of group.items) {
      const question = item.question
      const figMap = figureMaps?.get(`${item.source_id}\0${item.question_id}`) ?? new Map()
      sequence++
      const scoreTag = isGaokao && (question.type === 'solve' || question.type === 'proof')
        ? `(${item.score}分)\\ ` : ''
      lines.push(`\\item ${output.answerOnly ? '' : scoreTag}`)

      if (!output.answerOnly) {
        const stemTex = renderMarkdownToLatex(question.stem.md, safeFallback, true)
        const choiceSuffix = (isGaokao && (question.type === 'single' || question.type === 'multi'))
          ? (output.showSolutions ? ` \\GaokaoParen[${extractChoiceKey(question.answer.md)}]` : ' \\GaokaoParen')
          : ''
        lines.push(`${stemTex}${choiceSuffix}`)
        lines.push(...renderFiguresLatex(question.stem.figures, figMap))

        if (question.options?.length) {
          if (isGaokao) {
            if (question.options.length <= 4) {
              const opts = [...question.options]
              while (opts.length < 4) opts.push({ md: '' })
              lines.push(`\\GaokaoOptions{${opts.slice(0, 4).map(o => renderMarkdownToLatex(o.md, safeFallback, false)).join('}{')}}`)
            } else {
              lines.push('\\begin{enumerate}[label=\\Alph*., leftmargin=2em, itemsep=1mm]')
              for (const option of question.options) {
                lines.push(`  \\item ${renderMarkdownToLatex(option.md, safeFallback, false)}`)
              }
              lines.push('\\end{enumerate}')
            }
          } else {
            const opts = [...question.options]
            while (opts.length < 4) opts.push({ md: '' })
            lines.push(`\\UstcOptions{${opts.slice(0, 4).map(o => renderMarkdownToLatex(o.md, safeFallback, false)).join('}{')}}`)
          }
        }
      }

      if (output.showSolutions) {
        const label = question.type === 'proof' ? '证明' : '解'
        const solText = resolveSolutionText(question)
        const showAns = shouldShowAnswerLine(question)

        if (isGaokao) {
          lines.push('\\begin{GaokaoSolution}')
          if (showAns) {
            lines.push(`\\noindent\\textbf{【答案】}\\ ${renderMarkdownToLatex(question.answer.md, safeFallback, false)}\\par\\smallskip`)
          }
          if (solText) {
            lines.push(`\\noindent\\textbf{【${label}】}\\ ${renderMarkdownToLatex(solText, safeFallback, false)}`)
          }
          lines.push(...renderFiguresLatex(question.solution.figures, figMap))
          const comment = buildCommentText(item, question)
          if (comment) {
            lines.push(`\\par\\smallskip\\noindent{\\color{ExamCommentRed}\\textbf{点评：}${renderMarkdownToLatex(comment, safeFallback, false)}}`)
          }
          lines.push('\\end{GaokaoSolution}')
        } else {
          if (showAns) {
            lines.push(`\\par\\vspace{1mm}\\noindent{\\bfseries\\heiti 答案：}\\ ${renderMarkdownToLatex(question.answer.md, safeFallback, false)}`)
          }
          if (solText) {
            lines.push(`\\begin{UstcSolution}[${label}]{${fields.writeSpace}}`)
            lines.push(renderMarkdownToLatex(solText, safeFallback, false))
            lines.push(...renderFiguresLatex(question.solution.figures, figMap))
            lines.push('\\end{UstcSolution}')
          }
          const comment = buildCommentText(item, question)
          if (comment) {
            lines.push(`\\UstcComment{${renderMarkdownToLatex(comment, safeFallback, false)}}`)
          }
        }
      } else if (!isGaokao && (question.type === 'solve' || question.type === 'proof')) {
        lines.push(`\\par\\vspace{${fields.writeSpace}}`)
      } else if (isGaokao && (question.type === 'solve' || question.type === 'proof')) {
        lines.push(`\\par\\vspace{${fields.writeSpace}}`)
      }
    }
    lines.push('\\end{enumerate}')
  }
  return lines.join('\n')
}

function formatSectionScore(group) {
  const n = group.items.length
  const uniform = n > 1 && group.items.every(it => Number(it.score) === Number(group.items[0].score))
  if (uniform) return `共${group.score}分，每小题${group.items[0].score}分`
  return `共${group.score}分`
}

function buildCommentText(item, question) {
  const parts = []
  if (item.comment_md) parts.push(item.comment_md)
  if (question.quality?.note && question.quality.note !== item.comment_md) parts.push(question.quality.note)
  if (question.answer?.origin === 'ai' || item.is_ai_variant) {
    parts.push('本题含 AI 推导或变式，请注意核验。')
  }
  return parts.join('；')
}

function shouldShowAnswerLine(question) {
  const ans = String(question.answer?.md ?? '').trim()
  const sol = String(question.solution?.md ?? '').trim()
  if (!ans) return false
  if (question.type === 'proof' && sol && ans.length > 80) return false
  if (sol && normalizeCompare(ans) === normalizeCompare(sol)) return false
  return true
}

function resolveSolutionText(question) {
  const md = String(question.solution?.md ?? '').trim()
  if (md) return md
  const steps = question.solution?.steps ?? []
  if (steps.length) return steps.map((s, i) => `(${i + 1}) ${s}`).join('\n')
  return ''
}

function normalizeCompare(s) {
  return String(s).replace(/\s+/g, '').toLowerCase()
}

function extractChoiceKey(answerMd) {
  const match = String(answerMd ?? '').match(/[A-D]{1,4}/)
  return match ? match[0] : ''
}

function renderFiguresLatex(figures, figMap) {
  if (!figures?.length) return []
  const lines = []
  for (const fig of figures) {
    const abs = figMap.get(fig.path)
    if (!abs) continue
    const ext = path.extname(abs).toLowerCase()
    if (!['.png', '.jpg', '.jpeg', '.pdf'].includes(ext)) continue
    const posixPath = abs.split(path.sep).join('/')
    lines.push(`\\begin{center}\\includegraphics[width=0.68\\linewidth,height=55mm,keepaspectratio]{${posixPath}}\\end{center}`)
  }
  return lines
}

function groupItems(items) {
  const groups = []
  for (const item of items) {
    const key = cleanSectionTitle(item.section_title, item.question?.type)
    let group = groups.at(-1)
    if (!group || group.key !== key) {
      group = { key, title: key, items: [], score: 0 }
      groups.push(group)
    }
    group.items.push(item)
    group.score += Number(item.score) || 0
  }
  return groups
}

export function cleanSectionTitle(raw, fallbackType) {
  let text = String(raw ?? '').trim()
  if (!text || text === '题目') return defaultSectionTitle(fallbackType)
  // 剥离模型可能自带的前缀序号（模板会自动按大题顺序加「一.」「二.」等编号）
  text = text
    .replace(/^(?:第\s*[一二三四五六七八九十百\d]+\s*(?:部分|大题|节)\s*[：:、.．\s]*)/u, '')
    .replace(/^(?:[（(]\s*[一二三四五六七八九十\d]+\s*[)）]\s*[：:、.．\s]*)/u, '')
    .replace(/^(?:[一二三四五六七八九十]+(?:\s*[、.．:：]\s*|\s+))/u, '')
    .replace(/^(?:\d+\s*[、.．:：]\s*)/u, '')
    .trim()
  // 剥离括号内的分值/题量说明（模板会自动汇总并渲染「共 X 分，每小题 Y 分」）
  const scoreParenRe = /\s*[（(][^）)]*(?:每\s*(?:小)?题|共\s*\d+|本大题|\d+(?:\.\d+)?\s*分|\d+\s*(?:小)?题)[^）)]*[)）]\s*$/u
  while (scoreParenRe.test(text)) {
    text = text.replace(scoreParenRe, '').trim()
  }
  // 剥离末尾无括号的分值/题量说明
  text = text.replace(/[\s，,、;；]*(?:本大题)?(?:共\s*\d+\s*(?:小)?题[\s，,]*)?(?:每\s*(?:小)?题\s*\d+(?:\.\d+)?\s*分[\s，,]*)?(?:共\s*\d+(?:\.\d+)?\s*分)\s*$/u, '').trim()
  return text || defaultSectionTitle(fallbackType)
}

function defaultSectionTitle(type) {
  return ({
    single: '单项选择题',
    multi: '多项选择题',
    blank: '填空题',
    solve: '计算与解答题',
    proof: '证明题',
  })[type] ?? '解答题'
}

function scoreTable(items, answerOnly) {
  const groups = groupItems(items)
  if (!groups.length || answerOnly) return ''
  const columns = `|c|${'c|'.repeat(groups.length + 1)}`
  const top = ['\\textbf{题号}', ...groups.map((_, index) => chineseNumber(index + 1)), '\\textbf{总分}']
  const scores = groups.map(group => group.score)
  const total = scores.reduce((sum, score) => sum + score, 0)
  return `\\begin{UstcScoreTable}{${columns}}
  ${top.join(' & ')} \\\\ \\hline
  \\textbf{满分} & ${scores.join(' & ')} & ${total} \\\\ \\hline
  \\textbf{得分} & ${groups.map(() => '\\hspace{11mm}').join(' & ')} & \\hspace{13mm} \\\\
\\end{UstcScoreTable}`
}

function renderMarkdownToLatex(markdown, safeFallback = false, breakInlineSubItems = false) {
  let raw = String(markdown ?? '').trim()
  if (!raw) return ''
  if (safeFallback) {
    return latexText(raw.replace(/\$+/g, ''))
  }

  // 自动把挤在同一行的多小题重公式题干（如 "计算下列积分：(1) $\int...$; (2) $\int...$; (3) ..."）拆为清晰换行，彻底杜绝右侧裁切
  if (breakInlineSubItems) {
    const heavyMathCount = (raw.match(/\\(?:int|sum|lim|frac|dfrac|prod|sqrt)\b/g) ?? []).length
    const hasSubItems = /[（(]2[）)]/.test(raw)
    if (heavyMathCount >= 2 && hasSubItems && !raw.includes('\n')) {
      raw = raw.replace(/\s*([：:;；。])\s*([（(][1-9][）)])/g, '$1\n$2 ')
        .replace(/^\s*([^（(\n]{2,20})\s*([（(]1[）)])/g, '$1\n$2 ')
    }
  }

  const paragraphs = raw.split(/\r?\n\s*\r?\n/)
  return paragraphs.map(para => {
    const lines = para.split(/\r?\n/)
    // 检测 Markdown 管道表格
    if (lines.length >= 2 && lines[0].includes('|') && /^\s*\|?[\s:-]+\|/.test(lines[1])) {
      return markdownTableToLatex(lines)
    }
    return lines.map(line => convertInlineLatex(line)).join('\\\\\n')
  }).join('\n\\par\\smallskip\n')
}

function markdownTableToLatex(lines) {
  const rows = lines
    .filter((_, idx) => idx !== 1)
    .map(line => line.replace(/^\s*\||\|\s*$/g, '').split('|').map(cell => convertInlineLatex(cell.trim())))
    .filter(cells => cells.length > 0)
  if (!rows.length) return ''
  const cols = Math.max(...rows.map(r => r.length))
  const colSpec = `|${'c|'.repeat(cols)}`
  const body = rows.map(r => {
    const padded = [...r, ...Array(Math.max(0, cols - r.length)).fill('')]
    return `${padded.join(' & ')} \\\\ \\hline`
  }).join('\n')
  const inner = `\\begin{tabular}{${colSpec}}\\hline\n${body}\n\\end{tabular}`
  return cols >= 5
    ? `\\begin{center}\\resizebox{\\linewidth}{!}{${inner}}\\end{center}`
    : `\\begin{center}${inner}\\end{center}`
}

function convertInlineLatex(text) {
  const tokens = String(text ?? '').split(MATH_SPLIT_RE)
  return tokens.map(token => {
    if ((token.startsWith('$') && token.endsWith('$')) || token.startsWith('\\[') || token.startsWith('\\(')) {
      const display = token.startsWith('$$') || token.startsWith('\\[')
      const math = sanitizeMath(stripMathDelimiters(token))
      if (/\\begin\{(?:align|align\*|gather|gather\*|multline|multline\*|equation|equation\*)\}/.test(math)) {
        return `\n${math}\n`
      }
      return display ? `\n\\[${math}\\]\n` : `\\(${math}\\)`
    }
    return convertTextFormatting(token)
  }).join('')
}

function convertTextFormatting(text) {
  // 保留 **粗体** 与 *斜体*
  const parts = String(text ?? '').split(/(\*\*[^*]+\*\*|\*[^*\n]+\*)/g)
  return parts.map(part => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return `\\textbf{${latexText(part.slice(2, -2))}}`
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return `\\emph{${latexText(part.slice(1, -1))}}`
    }
    return latexText(part)
  }).join('')
}

function stripMathDelimiters(token) {
  if (token.startsWith('$$') && token.endsWith('$$')) return token.slice(2, -2).trim()
  if (token.startsWith('\\[') && token.endsWith('\\]')) return token.slice(2, -2).trim()
  if (token.startsWith('\\(') && token.endsWith('\\)')) return token.slice(2, -2).trim()
  if (token.startsWith('$') && token.endsWith('$')) return token.slice(1, -1).trim()
  return token
}

function sanitizeMath(value) {
  let out = String(value)
    .replace(/\\(?:input|include|includeonly|openout|write|write18|read|readline|catcode|csname|usepackage|documentclass|newcommand|renewcommand|def|gdef|loop|special)\b/gi, '\\text{[blocked]}')
  // 把数学环境中未包 \text{} 的中文字符与中文标点包进 \text{}，避免 xelatex 缺字方块
  out = out.replace(/(?<!\\text\{)([\u4e00-\u9fff，。；：、！？（）【】《》“”‘’]+)/g, '\\text{$1}')
  return out
}

function latexText(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/([#$%&_{}])/g, '\\$1')
    .replace(/\^/g, '\\textasciicircum{}')
    .replace(/~/g, '\\textasciitilde{}')
}

// ============================================================================
// 可打印 KaTeX HTML（降级与快速浏览共用）
// ============================================================================

function buildPrintableHtml(paper, outputs, fields) {
  const pages = outputs.map(output => {
    const groups = groupItems(output.items)
    let seq = 0
    const sectionHtml = groups.map((group, secIdx) => {
      const itemsHtml = group.items.map(item => {
        seq++
        const question = item.question
        const prompt = output.answerOnly ? '' : `<div class="stem">${markdownHtml(question.stem.md)}</div>`
        const options = output.answerOnly || !question.options?.length ? ''
          : `<div class="options">${question.options.map(option => `<div><strong>${escapeHtml(option.key)}.</strong> ${markdownHtml(option.md)}</div>`).join('')}</div>`
        const solText = resolveSolutionText(question)
        const comment = buildCommentText(item, question)
        const solution = output.showSolutions
          ? `<section class="solution">
              ${shouldShowAnswerLine(question) ? `<div class="ans-line"><strong>答案：</strong>${markdownHtml(question.answer.md)}</div>` : ''}
              ${solText ? `<div class="sol-body"><strong>${question.type === 'proof' ? '证明' : '解'}</strong>　${markdownHtml(solText)}</div>` : ''}
              ${comment ? `<p class="comment"><strong>点评：</strong>${markdownHtml(comment)}</p>` : ''}
            </section>`
          : ((question.type === 'solve' || question.type === 'proof') ? '<div class="answer-space"></div>' : '')
        return `<article class="q-item"><div class="q-no">(${seq}) ${output.answerOnly ? '' : `<span class="q-score">（${item.score} 分）</span>`}</div>${prompt}${options}${solution}</article>`
      }).join('')
      return `<section class="exam-section"><h2>${chineseNumber(secIdx + 1)}.（${formatSectionScore(group)}）${escapeHtml(group.title)}</h2>${itemsHtml}</section>`
    }).join('')

    return `<section class="page">
      <header class="exam-header">
        <div class="school-term">${escapeHtml(fields.schoolTerm)}</div>
        <div class="course-title">${escapeHtml(fields.courseTitle)}${output.answerOnly ? '——参考答案与解析' : ''}</div>
        <div class="meta-line">考试时间 <u>${escapeHtml(fields.examDate)}</u>　　考试形式 <u>${escapeHtml(fields.examForm)}</u></div>
      </header>
      ${output.answerOnly ? '' : scoreHtml(paper.items)}
      ${sectionHtml}
    </section>`
  }).join('')

  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><link rel="stylesheet" href="/api/dsh-study/katex?file=katex.min.css"><link rel="stylesheet" href="katex.min.css"><title>${escapeHtml(paper.title)}</title>
    <meta name="viewport" content="width=device-width, initial-scale=1"><style>
    body{font-family:"Songti SC","Noto Serif CJK SC","SimSun","Microsoft YaHei",serif;color:#111827;background:#f3f4f6;margin:0;padding:20px;line-height:1.8;font-size:15px}
    .page{background:#fff;max-width:820px;margin:0 auto 24px;padding:40px 48px;box-shadow:0 1px 4px rgba(0,0,0,.08)}
    .exam-header{text-align:center;margin-bottom:20px}
    .school-term,.course-title{font-family:"Microsoft YaHei","SimHei",sans-serif;font-size:20px;font-weight:700;line-height:1.5}
    .meta-line{margin-top:8px;font-size:14px;color:#374151}
    .meta-line u{text-decoration:none;border-bottom:1px solid #374151;padding:0 16px}
    table.score-table{border-collapse:collapse;margin:16px auto 24px;font-size:14px}
    table.score-table td{border:1px solid #374151;padding:6px 16px;text-align:center;min-width:34px}
    h2{font-family:"Microsoft YaHei","SimHei",sans-serif;font-size:15.5px;font-weight:700;margin:22px 0 12px}
    .q-item{margin-bottom:16px}.q-no{font-weight:600;margin-bottom:4px}.q-score{font-weight:400;color:#6b7280;font-size:13px}
    .options{display:grid;grid-template-columns:1fr 1fr;gap:6px 24px;margin:8px 0 8px 18px}
    .solution{margin-top:10px;padding-left:4px}.ans-line{margin-bottom:6px}.comment{color:#c01c28;margin:8px 0 0}
    .answer-space{height:${fields.writeSpace}}
    @media print{body{background:#fff;padding:0}.page{box-shadow:none;margin:0;padding:12mm 16mm;break-after:page}.page:last-child{break-after:auto}.q-item{break-inside:avoid}}
    </style></head><body>${pages}</body></html>`
}

function scoreHtml(items) {
  const groups = groupItems(items)
  const scores = groups.map(group => group.score)
  const total = scores.reduce((sum, score) => sum + score, 0)
  return `<table class="score-table">
    <tr><td><strong>题号</strong></td>${groups.map((_, i) => `<td>${chineseNumber(i + 1)}</td>`).join('')}<td><strong>总分</strong></td></tr>
    <tr><td><strong>满分</strong></td>${scores.map(s => `<td>${s}</td>`).join('')}<td>${total}</td></tr>
    <tr><td><strong>得分</strong></td>${groups.map(() => '<td>&nbsp;</td>').join('')}<td>&nbsp;</td></tr>
  </table>`
}

function markdownHtml(value) {
  return String(value ?? '').split(MATH_SPLIT_RE).map(part => {
    if ((part.startsWith('$') && part.endsWith('$')) || part.startsWith('\\[') || part.startsWith('\\(')) {
      const display = part.startsWith('$$') || part.startsWith('\\[')
      const math = stripMathDelimiters(part)
      try {
        return katex.renderToString(math, { displayMode: display, throwOnError: false, trust: false })
      } catch {
        return `<code>${escapeHtml(math)}</code>`
      }
    }
    return escapeHtml(part)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/\n/g, '<br>')
  }).join('')
}

// ============================================================================
// PPT 版式：封面扁平多边形 + 内页流线型进度轨道与素雅底纹。同一场景描述输出 PPTX 与预览图
// ============================================================================

const SLIDE_W = 1280
const SLIDE_H = 720
const PX_PER_IN = 96
const BODY_X = 56
const BODY_W = 1136
const PPTX_TITLE_FONT = 'Noto Sans SC'

function mixHex(hex, t, base = 'FAF9F5') {
  const a = parseInt(stripHash(hex), 16)
  const b = parseInt(stripHash(base), 16)
  return [16, 8, 0]
    .map(shift => Math.round(((a >> shift) & 255) * t + ((b >> shift) & 255) * (1 - t)).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()
}

function wrapByWidth(text, fontSize, maxWidth, maxLines) {
  const lines = []
  let line = ''
  let width = 0
  for (const ch of String(text ?? '')) {
    const w = estimateCharWidth(ch, fontSize)
    if (line && width + w > maxWidth) {
      lines.push(line)
      line = ''
      width = 0
    }
    line += ch
    width += w
  }
  if (line) lines.push(line)
  if (lines.length > maxLines) {
    lines.length = maxLines
    lines[maxLines - 1] = `${lines[maxLines - 1].slice(0, -1)}…`
  }
  return lines
}

function splitScriptRuns(str) {
  const runs = []
  for (const ch of String(str ?? '')) {
    const cjk = ch.codePointAt(0) > 0x2E7F
    if (runs.length && runs[runs.length - 1].cjk === cjk) runs[runs.length - 1].text += ch
    else runs.push({ cjk, text: ch })
  }
  return runs
}

const CJK_BOLD_FALLBACK = 'DSH Noto Bold,PingFang SC,Noto Sans CJK SC,DengXian,Microsoft YaHei,SimHei,sans-serif'
const CJK_REG_FALLBACK = 'DSH Noto,PingFang SC,Noto Sans CJK SC,DengXian,Microsoft YaHei,SimHei,sans-serif'

function renderSvgStyledLine(line, role, bold) {
  if (role === 'numeral') return escapeHtml(line)
  const latinFam = role === 'kicker'
    ? 'DSH Mono,DSH Space Semi,sans-serif'
    : (bold ? 'DSH Space Bold,DSH Noto Bold,sans-serif' : 'DSH Noto,sans-serif')
  const cjkFam = bold ? CJK_BOLD_FALLBACK : CJK_REG_FALLBACK
  return splitScriptRuns(line).map(run => {
    const fam = run.cjk ? cjkFam : latinFam
    return `<tspan font-family="${fam}">${escapeHtml(run.text)}</tspan>`
  }).join('')
}

function textItemToSvgElements(item, { offsetX = 0, offsetY = 0 } = {}) {
  const lines = item.lines ?? [item.text]
  const lineHeight = item.lineHeight ?? item.size * 1.25
  const blockH = lines.length * lineHeight
  const top = (item.valign === 'top' ? item.y : item.y + (item.h - blockH) / 2) - offsetY
  const anchor = item.align === 'right' ? 'end' : item.align === 'center' ? 'middle' : 'start'
  const x = (item.align === 'right' ? item.x + item.w : item.align === 'center' ? item.x + item.w / 2 : item.x) - offsetX
  const spacing = item.spacing ? ` letter-spacing="${item.spacing}"` : (item.role === 'numeral' ? ' letter-spacing="-0.6"' : '')
  const baseFamily = item.role === 'numeral'
    ? 'DSH Space Semi,DSH Space Bold,sans-serif'
    : (item.bold ? CJK_BOLD_FALLBACK : CJK_REG_FALLBACK)
  return lines.map((line, i) => {
    const baseline = top + i * lineHeight + lineHeight / 2 + item.size * 0.35
    const inner = renderSvgStyledLine(line, item.role ?? 'body', !!item.bold)
    return `<text x="${x.toFixed(1)}" y="${baseline.toFixed(1)}" text-anchor="${anchor}" font-family="${baseFamily}" font-size="${item.size}"${spacing} fill="#${item.color}">${inner}</text>`
  })
}

function coverScene(theme, { kicker, title, assets = {} }) {
  const tint = t => mixHex(theme.accent, t, theme.background)
  const p = {
    A: [1280, 0], B: [1010, 0], C: [1150, 150], D: [1280, 260], E: [960, 250], F: [1080, 380],
    G: [1280, 470], H: [900, 470], I: [1010, 600], J: [1280, 720], K: [880, 720], L: [1160, 560],
  }
  const facets = [
    ['BCA', 0.10], ['ACD', 0.24], ['BEC', 0.05], ['CEF', 0.36], ['CFD', 0.14], ['DFG', 0.07], ['EHF', 0.18],
    ['FHI', 0.06], ['FIL', 1], ['FLG', 0.28], ['GLJ', 0.12], ['LIJ', 0.20], ['IKJ', 0.09], ['HKI', 0.05],
  ]
  const items = facets.map(([keys, t]) => ({
    type: 'poly', points: [...keys].map(k => p[k]), fill: tint(t), stroke: theme.background, strokeWidth: 1.5,
  }))
  // 右侧线框三角与节点：保留封面几何张力，去除底部杂字与横线
  items.push(
    { type: 'poly', points: [[860, 96], [960, 250], [830, 236]], stroke: theme.accent, strokeWidth: 1.2 },
    { type: 'poly', points: [[900, 470], [852, 506], [895, 530]], fill: theme.highlight },
    ...[[860, 96], [830, 236], [960, 250], [900, 470]].map(([cx, cy]) => ({ type: 'dot', cx, cy, r: 3.5, fill: theme.accent })),
  )

  const titleLines = wrapByWidth(title, 48, 700, 3)
  const lineHeight = 64
  const blockH = 44 + 22 + titleLines.length * lineHeight + 36 + 16
  const startY = Math.round((SLIDE_H - blockH) / 2) - 6
  const titleY = startY + 54
  const railY = titleY + titleLines.length * lineHeight + 36

  if (assets.iconQuestion) {
    items.push({ type: 'pic', x: 96, y: startY, w: 32, h: 32, data: assets.iconQuestion })
  } else {
    items.push({ type: 'poly', points: [[96, startY + 11], [106, startY + 11], [106, startY + 21], [96, startY + 21]], fill: theme.accent })
  }
  items.push(
    { type: 'text', x: 140, y: startY, w: 560, h: 32, text: kicker, size: 17, bold: true, role: 'kicker', color: theme.accent, spacing: 3.5 },
    { type: 'text', x: 96, y: titleY, w: 740, h: titleLines.length * lineHeight, lines: titleLines, lineHeight, size: 48, bold: true, role: 'display', color: theme.text, valign: 'top' },
    // 标题下方的流线型起笔轨（与内页呼应）
    { type: 'line', x1: 96, y1: railY, x2: 162, y2: railY, color: theme.accent, width: 2 },
    { type: 'line', x1: 184, y1: railY, x2: 332, y2: railY, color: theme.railMuted, width: 1.2, dash: 'dash' },
    { type: 'dot', cx: 173, cy: railY, r: 8, fill: theme.background, stroke: theme.accent, strokeWidth: 1.8 },
    { type: 'dot', cx: 173, cy: railY, r: 3.5, fill: theme.accent },
    { type: 'dot', cx: 338, cy: railY, r: 3.8, fill: theme.background, stroke: theme.railMuted, strokeWidth: 1.4 },
  )
  return items
}

function buildRouteRail(theme, mark, { number, total, y = 92 }) {
  const items = []
  const n = Math.max(1, Number(total) || 1)
  const cur = Math.max(0, Math.min(n - 1, (Number(number) || 1) - 1))
  const stations = Math.min(n, 12)
  const active = n <= 12 ? cur : Math.min(stations - 1, Math.round((cur / Math.max(1, n - 1)) * (stations - 1)))

  if (stations === 1) {
    const cx = 104
    items.push(
      { type: 'line', x1: BODY_X, y1: y, x2: cx - 11, y2: y, color: mark, width: 1.8 },
      { type: 'line', x1: cx + 11, y1: y, x2: 1214, y2: y, color: theme.railMuted, width: 1.2, dash: 'dash' },
      { type: 'dot', cx, cy: y, r: 8.5, fill: theme.background, stroke: mark, strokeWidth: 1.8 },
      { type: 'dot', cx, cy: y, r: 3.8, fill: mark },
      { type: 'dot', cx: 1220, cy: y, r: 3.8, fill: theme.background, stroke: theme.railMuted, strokeWidth: 1.4 },
    )
    return items
  }

  const x0 = 96
  const xEnd = 1216
  const step = (xEnd - x0) / (stations - 1)
  const xs = Array.from({ length: stations }, (_, i) => Math.round(x0 + i * step))

  items.push({
    type: 'line', x1: BODY_X, y1: y, x2: xs[0] - (active === 0 ? 11 : 6), y2: y, color: mark, width: 1.8,
  })
  for (let i = 0; i < stations - 1; i++) {
    const a = xs[i] + (i === active ? 11 : 6)
    const b = xs[i + 1] - (i + 1 === active ? 11 : 6)
    if (b <= a) continue
    if (i < active) {
      items.push({ type: 'line', x1: a, y1: y, x2: b, y2: y, color: mark, width: 1.8 })
    } else {
      items.push({ type: 'line', x1: a, y1: y, x2: b, y2: y, color: theme.railMuted, width: 1.2, dash: 'dash' })
    }
  }
  for (let i = 0; i < stations; i++) {
    if (i < active) {
      items.push({ type: 'dot', cx: xs[i], cy: y, r: 3.6, fill: mark })
    } else if (i === active) {
      items.push(
        { type: 'dot', cx: xs[i], cy: y, r: 8.5, fill: theme.background, stroke: mark, strokeWidth: 1.8 },
        { type: 'dot', cx: xs[i], cy: y, r: 3.8, fill: mark },
      )
    } else {
      items.push({ type: 'dot', cx: xs[i], cy: y, r: 3.8, fill: theme.background, stroke: theme.railMuted, strokeWidth: 1.4 })
    }
  }
  return items
}

function contentScene(theme, { number, total, tone, heading, aside, page, assets = {} }) {
  const isSol = tone === 'solution'
  const mark = isSol ? theme.highlight : theme.accent
  const iconData = isSol ? assets.iconSolution : assets.iconQuestion
  const items = []

  if (assets.bgContent) {
    items.push({ type: 'bg-image', data: assets.bgContent })
  }

  // 页眉：极简图标 + Space Grotesk 编号 + 竖线 + 标题 + 出处
  if (iconData) {
    items.push({ type: 'pic', x: BODY_X, y: 36, w: 30, h: 30, data: iconData })
  }
  const numX = iconData ? BODY_X + 40 : BODY_X
  items.push(
    { type: 'text', x: numX, y: 30, w: 54, h: 42, text: String(number).padStart(2, '0'), size: 32, bold: true, role: 'numeral', color: mark },
    { type: 'line', x1: numX + 58, y1: 40, x2: numX + 58, y2: 63, color: theme.border, width: 1.2 },
    { type: 'text', x: numX + 74, y: 32, w: 560, h: 38, text: heading, size: 22, bold: true, role: 'display', color: theme.text },
  )
  if (aside) {
    items.push({ type: 'text', x: 740, y: 34, w: 484, h: 34, text: aside, size: 13.5, role: 'aside', color: theme.muted, align: 'right' })
  }

  // 流线型题目进度轨道（致敬 USTC-Question-Bank README）
  items.push(...buildRouteRail(theme, mark, { number, total, y: 92 }))

  // 正文区（留白充足，无页脚小字，无俗套角落装饰）
  items.push({ type: 'image', x: BODY_X, y: 124, page })
  return items
}

function pxToPt(px) {
  return Math.max(8, Math.round(Number(px || 16) * 0.75 * 10) / 10)
}

function drawRichPagePptx(slide, page, originX, originY) {
  const inch = v => v / PX_PER_IN
  const lines = page.lines ?? []
  const maxWidth = page.width ?? BODY_W

  let y = 4
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const isPureText = line.items.length > 0 && line.items.every(it => it.kind === 'text')

    // 将同一段落内连续纯文本行合并为原生可编辑多行文本框，保留精确版面位置与自然换行
    if (isPureText) {
      const startY = y
      const baseIndent = line.indent ?? (line.items[0]?.x ?? 0)
      const paraId = line.paraId
      const runs = []
      let blockH = 0
      let j = i
      while (j < lines.length) {
        const cur = lines[j]
        if (cur.paraId !== paraId || (cur.indent ?? (cur.items[0]?.x ?? 0)) !== baseIndent) break
        if (!cur.items.length || !cur.items.every(it => it.kind === 'text')) break
        for (const atom of cur.items) {
          const prev = runs.at(-1)
          if (prev && prev.options.color === atom.color && prev.options.bold === !!atom.bold && prev.options.fontSize === pxToPt(atom.fontSize)) {
            prev.text += atom.text
          } else {
            runs.push({
              text: atom.text,
              options: {
                fontFace: PPTX_TITLE_FONT,
                fontSize: pxToPt(atom.fontSize),
                color: atom.color,
                bold: !!atom.bold,
              },
            })
          }
        }
        blockH += cur.ascent + cur.descent + cur.gapAfter
        j++
      }
      const boxW = Math.max(40, maxWidth - baseIndent + 12)
      const boxH = Math.max(24, blockH + 6)
      if (runs.length) {
        slide.addText(runs, {
          x: inch(originX + baseIndent),
          y: inch(originY + startY),
          w: inch(boxW),
          h: inch(boxH),
          margin: 0,
          valign: 'top',
          wrap: true,
          lineSpacingMultiple: 1.32,
        })
      }
      y += blockH
      i = j
      continue
    }

    // 含公式的混排行：文字用原生文本框，仅公式用纯矢量小块透明 PNG
    const baseline = y + line.ascent
    let span = null
    const flushSpan = () => {
      if (!span) return
      const textW = Math.min(SLIDE_W - originX - span.x - 16, Math.max(span.width + 14, span.fontSize * 1.2))
      slide.addText(span.text, {
        x: inch(originX + span.x),
        y: inch(originY + baseline - span.fontSize * 0.92),
        w: inch(Math.max(18, textW)),
        h: inch(span.fontSize * 1.35),
        fontFace: PPTX_TITLE_FONT,
        fontSize: pxToPt(span.fontSize),
        bold: !!span.bold,
        color: span.color,
        margin: 0,
        valign: 'middle',
        wrap: false,
      })
      span = null
    }

    for (const item of line.items) {
      if (item.kind === 'text') {
        if (span && span.color === item.color && span.bold === !!item.bold && span.fontSize === item.fontSize) {
          span.text += item.text
          span.width += item.width
        } else {
          flushSpan()
          span = { x: item.x, width: item.width, text: item.text, color: item.color, bold: !!item.bold, fontSize: item.fontSize }
        }
      } else if (item.kind === 'inline-math') {
        flushSpan()
        const top = baseline - item.ascent
        const png = renderMathSvgToPng(item.metrics, item.drawWidth, item.drawHeight)
        slide.addImage({
          data: `data:image/png;base64,${Buffer.from(png).toString('base64')}`,
          x: inch(originX + item.x + 1),
          y: inch(originY + top),
          w: inch(item.drawWidth),
          h: inch(item.drawHeight),
        })
      }
    }
    flushSpan()
    y = baseline + line.descent + line.gapAfter
    i++
  }
}

function drawScenePptx(pptx, slide, items, fontFiles = [], { skipBgImage = false, rasterizeText = false } = {}) {
  const inch = v => v / PX_PER_IN
  const textItems = []
  for (const item of items) {
    if (item.type === 'bg-image') {
      if (skipBgImage) continue
      slide.addImage({
        data: item.data,
        x: 0, y: 0, w: inch(SLIDE_W), h: inch(SLIDE_H),
      })
    } else if (item.type === 'pic') {
      slide.addImage({
        data: item.data,
        x: inch(item.x), y: inch(item.y), w: inch(item.w), h: inch(item.h),
      })
    } else if (item.type === 'poly' || item.type === 'line') {
      const points = item.type === 'line' ? [[item.x1, item.y1], [item.x2, item.y2]] : item.points
      const xs = points.map(pt => pt[0])
      const ys = points.map(pt => pt[1])
      const x0 = Math.min(...xs)
      const y0 = Math.min(...ys)
      const geom = points.map(([x, y]) => ({ x: inch(x - x0), y: inch(y - y0) }))
      if (item.type === 'poly') geom.push({ close: true })
      const stroke = item.type === 'line'
        ? { color: item.color, width: item.width, dash: item.dash }
        : item.stroke ? { color: item.stroke, width: item.strokeWidth } : null
      slide.addShape(pptx.ShapeType.custGeom, {
        x: inch(x0), y: inch(y0),
        w: inch(Math.max(1, Math.max(...xs) - x0)), h: inch(Math.max(1, Math.max(...ys) - y0)),
        points: geom,
        ...(item.fill ? { fill: { color: item.fill } } : {}),
        ...(stroke ? {
          line: {
            color: stroke.color,
            width: stroke.width * 0.75,
            ...(stroke.dash === 'dash' ? { dashType: 'dash' } : {}),
          },
        } : {}),
      })
    } else if (item.type === 'dot') {
      slide.addShape(pptx.ShapeType.ellipse, {
        x: inch(item.cx - item.r), y: inch(item.cy - item.r), w: inch(item.r * 2), h: inch(item.r * 2),
        ...(item.fill ? { fill: { color: item.fill } } : {}),
        ...(item.stroke ? { line: { color: item.stroke, width: (item.strokeWidth ?? 1.5) * 0.75 } } : { line: { type: 'none' } }),
      })
    } else if (item.type === 'text') {
      if (rasterizeText) {
        textItems.push(item)
      } else {
        const lines = item.lines ?? [item.text]
        slide.addText(lines.join('\n'), {
          x: inch(item.x),
          y: inch(item.y),
          w: inch(item.w),
          h: inch(item.h),
          fontFace: PPTX_TITLE_FONT,
          fontSize: pxToPt(item.size),
          bold: !!item.bold,
          color: item.color,
          align: item.align ?? 'left',
          valign: item.valign ?? 'middle',
          margin: 0,
          wrap: true,
          ...(item.lineHeight && item.size ? { lineSpacingMultiple: Number((item.lineHeight / item.size).toFixed(2)) } : {}),
        })
      }
    } else if (item.type === 'image') {
      if (rasterizeText) {
        const svg = item.page.getSvg ? item.page.getSvg() : item.page.svg
        const png = renderSvgToPng(svg, item.page.width * 2, fontFiles)
        slide.addImage({
          data: `data:image/png;base64,${Buffer.from(png).toString('base64')}`,
          x: inch(item.x), y: inch(item.y), w: inch(item.page.width), h: inch(item.page.height),
        })
      } else {
        drawRichPagePptx(slide, item.page, item.x, item.y)
      }
    }
  }
  if (rasterizeText && textItems.length) {
    // 可选全图片化模式：合并整页文字为一个透明 2× 图层
    const padX = 4
    const padY = 8
    const minX = Math.max(0, Math.floor(Math.min(...textItems.map(it => it.x)) - padX))
    const minY = Math.max(0, Math.floor(Math.min(...textItems.map(it => it.y)) - padY))
    const maxX = Math.min(SLIDE_W, Math.ceil(Math.max(...textItems.map(it => it.x + it.w)) + padX))
    const maxY = Math.min(SLIDE_H, Math.ceil(Math.max(...textItems.map(it => it.y + it.h)) + padY))
    const svgW = Math.max(16, maxX - minX)
    const svgH = Math.max(16, maxY - minY)
    const elems = textItems.flatMap(it => textItemToSvgElements(it, { offsetX: minX, offsetY: minY }))
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}">${elems.join('')}</svg>`
    const png = renderSvgToPng(svg, svgW * 2, fontFiles)
    slide.addImage({
      data: `data:image/png;base64,${Buffer.from(png).toString('base64')}`,
      x: inch(minX), y: inch(minY), w: inch(svgW), h: inch(svgH),
    })
  }
}

function sceneToSvg(items, theme) {
  const parts = [`<rect width="${SLIDE_W}" height="${SLIDE_H}" fill="#${theme.background}"/>`]
  for (const item of items) {
    if (item.type === 'bg-image') {
      parts.push(`<image href="${item.data}" x="0" y="0" width="${SLIDE_W}" height="${SLIDE_H}" preserveAspectRatio="xMidYMid slice"/>`)
    } else if (item.type === 'pic') {
      parts.push(`<image href="${item.data}" x="${item.x}" y="${item.y}" width="${item.w}" height="${item.h}"/>`)
    } else if (item.type === 'poly') {
      const fill = item.fill ? `#${item.fill}` : 'none'
      const stroke = item.stroke ? ` stroke="#${item.stroke}" stroke-width="${item.strokeWidth}" stroke-linejoin="round"` : ''
      parts.push(`<polygon points="${item.points.map(pt => pt.join(',')).join(' ')}" fill="${fill}"${stroke}/>`)
    } else if (item.type === 'line') {
      const dash = item.dash === 'dash' ? ' stroke-dasharray="3 5"' : ''
      parts.push(`<line x1="${item.x1}" y1="${item.y1}" x2="${item.x2}" y2="${item.y2}" stroke="#${item.color}" stroke-width="${item.width}"${dash}/>`)
    } else if (item.type === 'dot') {
      const fill = item.fill ? `#${item.fill}` : 'none'
      const stroke = item.stroke ? ` stroke="#${item.stroke}" stroke-width="${item.strokeWidth ?? 1.5}"` : ''
      parts.push(`<circle cx="${item.cx}" cy="${item.cy}" r="${item.r}" fill="${fill}"${stroke}/>`)
    } else if (item.type === 'text') {
      parts.push(...textItemToSvgElements(item))
    } else if (item.type === 'image') {
      const svg = item.page.getSvg ? item.page.getSvg() : item.page.svg
      const inner = svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')
      parts.push(`<g transform="translate(${item.x}, ${item.y})">${inner}</g>`)
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SLIDE_W}" height="${SLIDE_H}" viewBox="0 0 ${SLIDE_W} ${SLIDE_H}">${parts.join('')}</svg>`
}


// ============================================================================
// 统一行内公式 SVG 混排引擎（PPTX 与高清预览缩略图共用，彻底解决公式错位/截断）
// ============================================================================

function renderSvgToPng(svg, widthPx, fontFiles = []) {
  return new Resvg(svg, {
    fitTo: { mode: 'width', value: Math.max(1, Math.round(widthPx)) },
    // 已内置完整中英文字体时关闭系统字体扫描，避免 200+ 页大试卷反复枚举系统字体导致超时或内存飙升
    font: { loadSystemFonts: fontFiles.length === 0, ...(fontFiles.length ? { fontFiles } : {}) },
  }).render().asPng()
}

function renderMathSvgToPng(metrics, drawWidth, drawHeight) {
  const w = Math.max(2, Number(drawWidth) || 24)
  const h = Math.max(2, Number(drawHeight) || 16)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w.toFixed(1)}" height="${h.toFixed(1)}" viewBox="${metrics.viewBox}" overflow="visible">${metrics.inner}</svg>`
  return new Resvg(svg, {
    fitTo: { mode: 'width', value: Math.max(4, Math.round(w * 2)) },
    font: { loadSystemFonts: false },
  }).render().asPng()
}

function convertFormulaToSvgMetrics(formula, display, fontSize, colorHex) {
  const cleaned = sanitizeMath(formula)
  const node = mathDocument.convert(cleaned, { display })
  const outer = adaptor.outerHTML(node)
  if (outer.includes('data-mml-node="merror"')) return null
  const start = outer.indexOf('<svg')
  const end = outer.lastIndexOf('</svg>')
  if (start < 0 || end <= start) return null
  let svg = outer.slice(start, end + 6)
  const wMatch = svg.match(/\bwidth="([\d.]+)ex"/)
  const hMatch = svg.match(/\bheight="([\d.]+)ex"/)
  const vaMatch = svg.match(/vertical-align:\s*(-?[\d.]+)ex/)
  const vbMatch = svg.match(/\bviewBox="([^"]+)"/)
  const exPx = fontSize * (display ? 0.52 : 0.46)
  const widthPx = (Number(wMatch?.[1]) || 4) * exPx
  const heightPx = (Number(hMatch?.[1]) || 2) * exPx
  const valignEx = Number(vaMatch?.[1]) || 0
  // MathJax vertical-align 为负值表示基线以下下沉深度
  const descentPx = Math.max(0, -valignEx * exPx)
  const ascentPx = Math.max(fontSize * 0.72, heightPx - descentPx)

  const innerStart = svg.indexOf('>') + 1
  const innerEnd = svg.lastIndexOf('</svg>')
  const inner = svg.slice(innerStart, innerEnd).replace(/currentColor/g, `#${colorHex}`)
  return {
    viewBox: vbMatch?.[1] ?? `0 0 ${Math.round(widthPx * 100)} ${Math.round(heightPx * 100)}`,
    widthPx,
    heightPx,
    ascentPx,
    descentPx,
    inner,
  }
}

function estimateCharWidth(ch, fontSize) {
  if (/[\u3000-\u9fff\uff00-\uffef]/.test(ch)) return fontSize * 1.02
  if (ch === ' ') return fontSize * 0.32
  if (/[ilI1.,;:!'|]/.test(ch)) return fontSize * 0.3
  if (/[MWmw@#%&]/.test(ch)) return fontSize * 0.82
  if (/[A-Z]/.test(ch)) return fontSize * 0.66
  return fontSize * 0.54
}

function tokenizeTextForWrap(text, fontSize, colorHex, bold = false) {
  const atoms = []
  let buffer = ''
  const flush = () => {
    if (!buffer) return
    let w = 0
    for (const ch of buffer) w += estimateCharWidth(ch, fontSize) * (bold ? 1.04 : 1)
    atoms.push({ kind: 'text', text: buffer, width: w, ascent: fontSize * 0.86, descent: fontSize * 0.24, fontSize, color: colorHex, bold })
    buffer = ''
  }
  for (const ch of String(text ?? '')) {
    if (/[\u3000-\u9fff\uff00-\uffef]/.test(ch)) {
      flush()
      atoms.push({ kind: 'text', text: ch, width: estimateCharWidth(ch, fontSize) * (bold ? 1.04 : 1), ascent: fontSize * 0.86, descent: fontSize * 0.24, fontSize, color: colorHex, bold })
    } else if (ch === ' ') {
      buffer += ch
      flush()
    } else {
      buffer += ch
    }
  }
  flush()
  return atoms
}

function layoutBlocksToLines(blocks, maxWidth, fontSize, defaultColor) {
  const lines = []
  const lineGap = Math.round(fontSize * 0.42)
  const paraGap = Math.round(fontSize * 0.5)
  let nextParaId = 0

  for (const [blockIdx, block] of blocks.entries()) {
    const color = stripHash(block.color ?? defaultColor)
    const indent = block.indent ?? 0
    // 跨行的 $$…$$ / \[…\] 先并成一行，避免按段落拆开后公式失效；文本加粗/强调命令只保留内容
    const normalized = String(block.text ?? '')
      .replace(/\$\$([\s\S]+?)\$\$/g, (_, f) => `$$${f.replace(/\s*\r?\n\s*/g, ' ').trim()}$$`)
      .replace(/\\\[([\s\S]+?)\\\]/g, (_, f) => `\\[${f.replace(/\s*\r?\n\s*/g, ' ').trim()}\\]`)
      .replace(/\\(?:textbf|textit|emph)\{((?:[^{}]|\{[^{}]*\})*)\}/g, (_, inner) => inner)
    const paragraphs = normalized.split(/\r?\n/)

    for (const [pIdx, para] of paragraphs.entries()) {
      const trimmed = para.trim()
      if (!trimmed && !(pIdx === 0 && block.label)) continue
      const paraId = ++nextParaId

      const atoms = []
      if (pIdx === 0 && block.label) {
        atoms.push(...tokenizeTextForWrap(block.label, fontSize, stripHash(block.labelColor ?? color), true))
      }

      const segments = para.split(MATH_SPLIT_RE)
      for (const seg of segments) {
        if (!seg) continue
        if ((seg.startsWith('$') && seg.endsWith('$')) || seg.startsWith('\\[') || seg.startsWith('\\(')) {
          const display = seg.startsWith('$$') || seg.startsWith('\\[')
          const formula = stripMathDelimiters(seg)
          let metrics = null
          try {
            metrics = convertFormulaToSvgMetrics(formula, display, fontSize, color)
          } catch {}
          if (metrics) {
            if (display) {
              atoms.push({ kind: 'display-math', metrics, color })
            } else {
              // 过宽的行内公式等比缩放到不超过可用宽度
              const avail = maxWidth - indent - 12
              let scale = 1
              if (metrics.widthPx > avail) scale = avail / metrics.widthPx
              atoms.push({
                kind: 'inline-math',
                metrics,
                width: metrics.widthPx * scale + 4,
                height: metrics.heightPx * scale,
                ascent: metrics.ascentPx * scale,
                descent: metrics.descentPx * scale,
                drawWidth: metrics.widthPx * scale,
                drawHeight: metrics.heightPx * scale,
              })
            }
          } else {
            atoms.push(...tokenizeTextForWrap(formula, fontSize, color, false))
          }
        } else {
          const cleanText = seg.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1')
          atoms.push(...tokenizeTextForWrap(cleanText, fontSize, color, false))
        }
      }

      // 将 atoms 折行
      let curItems = []
      let curX = indent
      let curAscent = fontSize * 0.9
      let curDescent = fontSize * 0.25

      const pushLine = (extraBottom = lineGap) => {
        if (!curItems.length) return
        lines.push({ items: curItems, ascent: curAscent, descent: curDescent, gapAfter: extraBottom, paraId, indent })
        curItems = []
        curX = indent
        curAscent = fontSize * 0.9
        curDescent = fontSize * 0.25
      }

      for (const atom of atoms) {
        if (atom.kind === 'display-math') {
          pushLine(Math.round(fontSize * 0.35))
          const m = atom.metrics
          const avail = maxWidth - indent
          const scale = m.widthPx > avail ? avail / m.widthPx : 1
          const dw = m.widthPx * scale
          const dh = m.heightPx * scale
          const cx = indent + Math.max(0, (avail - dw) / 2)
          lines.push({
            items: [{ kind: 'inline-math', x: cx, metrics: m, drawWidth: dw, drawHeight: dh, ascent: dh, descent: 0 }],
            ascent: dh,
            descent: 0,
            gapAfter: Math.round(fontSize * 0.45),
            paraId: ++nextParaId,
            indent,
          })
          continue
        }
        if (curItems.length && curX + atom.width > maxWidth) {
          pushLine(lineGap)
        }
        curItems.push({ ...atom, x: curX })
        curX += atom.width
        curAscent = Math.max(curAscent, atom.ascent)
        curDescent = Math.max(curDescent, atom.descent)
      }
      pushLine(pIdx === paragraphs.length - 1 ? paraGap : lineGap)
    }

    if (blockIdx < blocks.length - 1 && lines.length) {
      lines[lines.length - 1].gapAfter = Math.max(lines[lines.length - 1].gapAfter, Math.round(fontSize * 0.65))
    }
  }
  return lines
}

function renderLinesToSvg(lines, maxWidth) {
  let y = 4
  const chunks = []
  for (const line of lines) {
    const baseline = y + line.ascent
    // 合并相邻同样式文本减少 SVG 节点数量
    let textBuf = null
    const flushText = () => {
      if (!textBuf) return
      const bodyFont = textBuf.bold ? CJK_BOLD_FALLBACK : CJK_REG_FALLBACK
      chunks.push(`<text x="${textBuf.x.toFixed(1)}" y="${baseline.toFixed(1)}" font-family="${bodyFont}" font-size="${textBuf.fontSize}" fill="#${textBuf.color}">${escapeHtml(textBuf.text)}</text>`)
      textBuf = null
    }
    for (const item of line.items) {
      if (item.kind === 'text') {
        if (textBuf && textBuf.color === item.color && textBuf.bold === item.bold && textBuf.fontSize === item.fontSize) {
          textBuf.text += item.text
        } else {
          flushText()
          textBuf = { x: item.x, text: item.text, color: item.color, bold: item.bold, fontSize: item.fontSize }
        }
      } else if (item.kind === 'inline-math') {
        flushText()
        const top = baseline - item.ascent
        chunks.push(`<svg x="${(item.x + 1).toFixed(1)}" y="${top.toFixed(1)}" width="${item.drawWidth.toFixed(1)}" height="${item.drawHeight.toFixed(1)}" viewBox="${item.metrics.viewBox}" overflow="visible">${item.metrics.inner}</svg>`)
      }
    }
    flushText()
    y = baseline + line.descent + line.gapAfter
  }
  const height = Math.max(40, Math.ceil(y + 4))
  return {
    width: maxWidth,
    height,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${maxWidth}" height="${height}" viewBox="0 0 ${maxWidth} ${height}">${chunks.join('')}</svg>`,
  }
}

function buildRichPage(lines, maxWidth) {
  let y = 4
  for (const line of lines) {
    y += line.ascent + line.descent + line.gapAfter
  }
  const height = Math.max(40, Math.ceil(y + 4))
  let cachedSvg = null
  return {
    width: maxWidth,
    height,
    lines,
    getSvg() {
      if (cachedSvg === null) cachedSvg = renderLinesToSvg(lines, maxWidth).svg
      return cachedSvg
    },
  }
}

function composeRichPages(blocks, { maxWidth = 1160, maxHeight = 520, preferredFontSize = 23, minFontSize = 16, defaultColor = '1F2937' }) {
  // 1) 优先尝试适度缩小字号让单页放得下
  const candidates = []
  for (let fs = preferredFontSize; fs >= minFontSize; fs -= 2) candidates.push(fs)
  if (candidates.at(-1) !== minFontSize) candidates.push(minFontSize)

  let chosenLines = null
  for (const fs of candidates) {
    const lines = layoutBlocksToLines(blocks, maxWidth, fs, defaultColor)
    const totalH = lines.reduce((sum, line) => sum + line.ascent + line.descent + line.gapAfter, 8)
    chosenLines = lines
    if (totalH <= maxHeight) {
      return [buildRichPage(lines, maxWidth)]
    }
  }

  // 2) 若在最小字号下仍超出一页高度，自动拆分为多页，绝不截断任何公式或步骤
  const pages = []
  let bucket = []
  let bucketH = 8
  for (const line of chosenLines ?? []) {
    const lineH = line.ascent + line.descent + line.gapAfter
    if (bucket.length && bucketH + lineH > maxHeight) {
      pages.push(buildRichPage(bucket, maxWidth))
      bucket = []
      bucketH = 8
    }
    bucket.push(line)
    bucketH += lineH
  }
  if (bucket.length) pages.push(buildRichPage(bucket, maxWidth))
  return pages.length ? pages : [buildRichPage([], maxWidth)]
}

function extractLatexErrorSummary(compileLog, nativeLog, texBaseName = '') {
  const source = `${compileLog || ''}\n${nativeLog || ''}`
  const lines = source.split(/\r?\n/)
  const escapedTex = texBaseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const fileLineRe = escapedTex ? new RegExp(`${escapedTex}:\\d+:`, 'i') : /\.tex:\d+:/i
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    if (line.startsWith('! ') || fileLineRe.test(line)) {
      const snippet = [line]
      for (let k = i + 1; k < Math.min(lines.length, i + 4); k++) {
        const next = lines[k].trim()
        if (!next) break
        if (/^l\.\d+|^<|^\s*See the |not found|Undefined|Missing|Emergency/i.test(next) || snippet.length < 2) {
          snippet.push(next)
        }
      }
      return snippet.join(' | ').slice(0, 320)
    }
  }
  const fallback = lines.map(l => l.trim()).filter(l => /Error|Fatal|not found|Emergency stop/i.test(l)).slice(0, 2)
  return fallback.join(' | ').slice(0, 320)
}

// ============================================================================
// 辅助函数
// ============================================================================

async function firstExistingPath(candidates) {
  for (const candidate of candidates) {
    try {
      await fs.access(candidate)
      return candidate
    } catch {}
  }
  throw new Error(`缺少必需资源文件：${candidates.join(', ')}`)
}

function safeTemplatePath(root, relative) {
  if (!relative || relative.includes('\\') || path.posix.isAbsolute(relative) ||
      relative.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error(`自定义模板路径非法：${relative}`)
  }
  const resolvedRoot = path.resolve(root)
  const file = path.resolve(resolvedRoot, ...relative.split('/'))
  if (!file.startsWith(resolvedRoot + path.sep)) throw new Error('自定义模板路径超出目录范围')
  return file
}

function interpolateTemplate(source, values) {
  if (typeof source !== 'string' || !/{{(?:document|body|title|schoolTerm|examDate|mode)}}/.test(source)) {
    throw new Error('自定义模板必须包含有效的 {{...}} 占位符')
  }
  return source.replace(/{{(document|body|title|schoolTerm|examDate|mode)}}/g,
    (_, key) => values[key] ?? '')
}

function stripHash(hex) {
  return String(hex ?? '').replace(/^#/, '')
}

function truncateText(text, maxLen) {
  const s = String(text ?? '').trim()
  return s.length > maxLen ? `${s.slice(0, maxLen)}…` : s
}

function originLabel(origin) {
  return ({ official: '官方标答', community: '社区详解', ai: 'AI 推导' })[origin] ?? '参考答案'
}

function typeLabel(type) {
  return ({ single: '单选题', multi: '多选题', blank: '填空题', solve: '解答题', proof: '证明题' })[type] ?? '解答题'
}

function chineseNumber(value) {
  return ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'][value] ?? String(value)
}

function isValidLatexImageHeader(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return true // PNG
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return true // JPEG
  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) return true // PDF
  return false
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char])
}
