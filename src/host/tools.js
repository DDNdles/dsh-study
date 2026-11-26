import fs from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import path from 'node:path'
import { serializeError } from './errors.js'
import { assertSafeRelative } from './validation.js'

const object = (properties = {}, required = []) => ({
  type: 'object', properties, required, additionalProperties: false,
})
const string = (description, extra = {}) => ({ type: 'string', description, ...extra })
const number = (description, extra = {}) => ({ type: 'number', description, ...extra })
const bool = (description, extra = {}) => ({ type: 'boolean', description, ...extra })
const array = (items, extra = {}) => ({ type: 'array', items, ...extra })
const question = {
  type: 'object',
  description: '符合 USTC-Question-Bank v1.0 Schema 的单题记录',
  additionalProperties: true,
}
const plainJson = value => value === undefined
  ? undefined
  : JSON.parse(JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item))
const toolOutput = {
  schema: {
    type: 'object',
    properties: {
      ok: { type: 'boolean' },
      data: {},
      error: { type: 'object', additionalProperties: true },
    },
    required: ['ok'],
    additionalProperties: true,
  },
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
}

export function registerTools(ctx, services) {
  const definitions = [
    ['study_bank', '查看或管理题库源、课程知识点树、导出模板与本机 LaTeX 环境。默认 action=status 一次返回题库源与课程、可用模板及 LaTeX 检测状态。', object({
      action: {
        type: 'string',
        enum: ['status', 'taxonomy', 'sync', 'add_source', 'install_latex'],
        description: '操作类型：status（默认，查看题库/模板/环境）、taxonomy（查知识点树）、sync（下载或更新课程）、add_source（添加题库源）、install_latex（安装轻量 TinyTeX）',
      },
      source_id: string('题库源标识（sync / add_source 时使用）'),
      course_codes: array(string('课程代码（status/taxonomy 可选过滤，sync 时必填）')),
      name: string('题库源中文名称（add_source）'),
      transport: { type: 'string', enum: ['github-raw', 'http-manifest', 'local-dir', 'git'] },
      location: string('GitHub 仓库（owner/repo）、网络地址或本机目录路径（add_source）'),
      ref: string('Git 分支、标签或提交号（add_source）'),
      mirror_url: string('可选下载镜像前缀（add_source）'),
    })],

    ['study_search', '检索题库题目或读取单题完整详情。传入 source_id + question_id 时直接返回单题完整数据与配图；否则按条件搜索题库。', object({
      source_id: string('单题查询时的题库源标识（与 question_id 同时提供）'),
      question_id: string('单题查询时的题目 ID（与 source_id 同时提供）'),
      query: string('关键词（支持中文子串、LaTeX 片段、知识点名、出处年份）'),
      source_ids: array(string('题库源标识列表')),
      course_codes: array(string('课程代码列表')),
      kp_ids: array(string('知识点 ID（自动包含下级知识点）')),
      types: array({ type: 'string', enum: ['single', 'multi', 'blank', 'solve', 'proof'] }),
      difficulty_min: number('最低难度（1–5）', { minimum: 1, maximum: 5 }),
      difficulty_max: number('最高难度（1–5）', { minimum: 1, maximum: 5 }),
      answer_origins: array({ type: 'string', enum: ['official', 'community', 'ai'] }),
      source_kinds: array({ type: 'string', enum: ['exam_paper', 'book', 'dataset', 'notes'] }),
      year_from: number('起始年份'),
      year_to: number('结束年份'),
      exclude_quarantined: bool('是否排除隔离题（默认 true）'),
      limit: number('返回条数上限', { minimum: 1, maximum: 100 }),
      offset: number('分页偏移', { minimum: 0 }),
    })],

    ['study_mistake', '管理个人错题本：查询列表（list）、标记题库已有题（mark）、直接录入新错题（add）、复习打卡（review）或删除（delete）。', object({
      action: {
        type: 'string',
        enum: ['list', 'mark', 'add', 'review', 'delete'],
        description: '操作类型：list（默认）、mark（标记题库题）、add（直接录入新错题并写入个人库）、review（复习打卡）、delete（删除）',
      },
      source_id: string('题库源标识（list 过滤或 mark 必填）'),
      course_code: string('课程代码（list 过滤）'),
      question_id: string('题目 ID（mark 必填）'),
      mistake_id: string('错题 ID（review / delete 必填）'),
      status: { type: 'string', enum: ['unmastered', 'reviewing', 'mastered'] },
      dueOnly: bool('list 时仅返回已到期需复习的错题'),
      question,
      error_tags: array(string('错因标签，如：概念、计算、方法、证明、审题、粗心')),
      wrong_attempt_md: string('用户的错误思路或卡壳点'),
      reflection_md: string('反思总结与正确要点'),
      rating: { type: 'string', enum: ['again', 'hard', 'good', 'easy'] },
      note_md: string('本次复习备注（review）'),
    })],

    ['study_paper', '组卷与试卷管理：按条件组卷（assemble）、按错题巩固组卷（assemble_mistakes）、按精选题列表组卷（assemble_custom）、查看/列出试卷（get/list）、调整分值顺序（update_items）、批量写点评（update_comments）或添加 AI 变式题（add_variant）。', object({
      action: {
        type: 'string',
        enum: ['assemble', 'assemble_mistakes', 'assemble_custom', 'get', 'list', 'update_items', 'update_comments', 'add_variant'],
        description: '操作类型，默认 assemble',
      },
      paper_id: string('试卷 ID（get / update_items / update_comments / add_variant 必填）'),
      mode: { type: 'string', enum: ['exam', 'topic', 'mistake'] },
      title: string('试卷标题'),
      course_codes: array(string('课程代码')),
      source_ids: array(string('题库源标识')),
      kp_ids: array(string('知识点 ID 列表')),
      mistake_ids: array(string('指定错题 ID 列表（assemble_mistakes）')),
      count: number('目标总题数', { minimum: 1, maximum: 500 }),
      original_redo_ratio: number('原错题重做占比（0–1，assemble_mistakes）', { minimum: 0, maximum: 1 }),
      include_similar: bool('是否补充同知识点类似题（assemble_mistakes）'),
      types: array({ type: 'string', enum: ['single', 'multi', 'blank', 'solve', 'proof'] }),
      difficulty_min: number('最低难度', { minimum: 1, maximum: 5 }),
      difficulty_max: number('最高难度', { minimum: 1, maximum: 5 }),
      source_kinds: array({ type: 'string', enum: ['exam_paper', 'book', 'dataset', 'notes'] }),
      exam_kinds: array({ type: 'string', enum: ['midterm', 'final', 'makeup', 'quiz'] }),
      year_from: number('起始年份'),
      year_to: number('结束年份'),
      answer_origins: array({ type: 'string', enum: ['official', 'community', 'ai'] }),
      exclude_batches: array(string('需排除的批次 ID')),
      exclude_quarantined: bool('是否排除隔离题'),
      score: number('默认每题分值', { minimum: 0.5 }),
      seed: number('可复现随机种子'),
      sections: array(object({
        title: string('大题纯名称（如「填空题」「计算题」；不要带「一、」编号或「共 X 分」说明，模板会自动生成）'),
        count: number('该大题题数', { minimum: 0, maximum: 200 }),
        score: number('每小题分值', { minimum: 0.5 }),
      }, ['title', 'count', 'score'])),
      items: array(object({
        source_id: string('题库源标识（assemble_custom）'),
        question_id: string('题目 ID（assemble_custom）'),
        seq: number('原题序号（update_items）'),
        score: number('分值', { minimum: 0, maximum: 1000 }),
        section_title: string('所属大题纯名称（assemble_custom）'),
        comment_md: string('针对性学习点评（assemble_custom）'),
      })),
      comments: array(object({
        seq: number('题序号（从 1 开始）'),
        comment_md: string('点评内容（支持行内 LaTeX）'),
      }, ['seq', 'comment_md'])),
      question,
      section_title: string('AI 变式题大题名称（add_variant）'),
    })],

    ['study_export', '将已保存试卷导出为 PDF（ustc-exam / gaokao）或讲评 PPTX（review-classic），自动保存到当前工作区并挂载可点击文件卡片。', object({
      paper_id: string('试卷 ID'),
      format: { type: 'string', enum: ['pdf', 'ppt'] },
      template_id: string('模板 ID（PDF 默认 ustc-exam，可选 gaokao；PPT 默认 review-classic）'),
      mode: { type: 'string', enum: ['inline-solution', 'split'] },
      options: object({
        schoolTerm: string('卷头学校与学期'),
        courseTitle: string('卷头课程与试卷名称'),
        examDate: string('考试时间'),
        examForm: string('考试形式（如闭卷/开卷）'),
        footerTerm: string('页脚学期'),
        showBindingLine: bool('奇数页是否绘制装订线'),
        writeSpace: { type: 'string', enum: ['compact', 'standard', 'spacious'] },
        splitLayout: { type: 'string', enum: ['two-files', 'combined'] },
        rasterizeText: bool('PPTX 是否将正文文本全部转为图片（默认 false，保留可编辑文本层）'),
      }),
    }, ['paper_id', 'format'])],

    ['study_feedback', '记录题目纠错反馈（题干、答案解析、来源年份、配图、公式或知识点归类问题），并生成直达题库仓库的预填 Issue 链接或直推提交。', object({
      source_id: string('题库源标识'),
      question_id: string('题目 ID'),
      categories: array(string('问题类型，如：题干错误、答案或解析错误、来源/年份错误、图片不清晰、图片被截断、公式排版异常、知识点归类错误、其他问题'), { minItems: 1 }),
      detail: string('补充说明（选填）'),
    }, ['source_id', 'question_id', 'categories'])],
  ]

  const pendingDeliveries = new WeakMap()
  for (const [name, description, parameters] of definitions) {
    ctx.effect(() => ctx.tools.register({
      name,
      description,
      parameters,
      output: toolOutput,
      async execute(args, exec = {}) {
        try {
          return plainJson(await execute(name, args ?? {}, exec, services, ctx, pendingDeliveries))
        } catch (error) {
          return plainJson({ ok: false, error: serializeError(error, name) })
        }
      },
    }))
  }

  // 与宿主官方 deliverables/presented 机制对齐：study_export 完成后自动挂载原生可点击文件卡片
  if (typeof ctx.on === 'function') {
    ctx.on('tools/result', (exec, result) => {
      const delivery = pendingDeliveries.get(exec)
      pendingDeliveries.delete(exec)
      if (!delivery || result?.isError || exec?.signal?.aborted) return
      try {
        delivery.session.append('deliverables/presented', {
          turn: delivery.turn,
          callId: exec.callId,
          files: delivery.files,
        })
      } catch {}
    })
  }
}

async function execute(name, args, exec, services, ctx, pendingDeliveries) {
  const { sources, mistakes, papers, render, db, config } = services
  const signal = exec.signal

  switch (name) {
    case 'study_bank': {
      const action = args.action || 'status'
      if (action === 'status') {
        const [templates, latexEnv] = await Promise.all([
          render.templates(),
          services.latexEnv.detect(config.xelatexBin, signal),
        ])
        const data = {
          sources: sources.list(),
          templates,
          latex_env: latexEnv,
        }
        if (args.course_codes?.length) {
          data.taxonomy = papers.taxonomyList(args.course_codes)
        }
        return { ok: true, data }
      }
      if (action === 'taxonomy') {
        return { ok: true, data: papers.taxonomyList(args.course_codes ?? []) }
      }
      if (action === 'sync') {
        if (!args.source_id || !args.course_codes?.length) {
          throw new Error('sync 需要提供 source_id 和至少一个 course_codes')
        }
        return { ok: true, data: await sources.sync(args.source_id, args.course_codes, signal) }
      }
      if (action === 'add_source') {
        if (!args.transport || !args.location) {
          throw new Error('add_source 需要提供 transport 和 location')
        }
        return { ok: true, data: await sources.add(args, signal) }
      }
      if (action === 'install_latex') {
        services.latexEnv.install({ mirrorBaseUrl: config.mirrorBaseUrl }).catch(() => {})
        return { ok: true, data: await services.latexEnv.detect(config.xelatexBin, signal) }
      }
      throw new Error(`未知 study_bank 操作：${action}`)
    }

    case 'study_search': {
      if (args.source_id && args.question_id) {
        return { ok: true, data: questionDetails(db, config, args) }
      }
      return { ok: true, data: searchQuestions(db, papers, args) }
    }

    case 'study_mistake': {
      const action = args.action || 'list'
      if (action === 'list') {
        return { ok: true, data: mistakes.list(args) }
      }
      if (action === 'mark') {
        if (!args.source_id || !args.question_id) {
          throw new Error('mark 需要提供 source_id 和 question_id')
        }
        return { ok: true, data: mistakes.mark(args) }
      }
      if (action === 'add') {
        if (!args.question) throw new Error('add 需要提供 question 对象')
        const draft = mistakes.draft(args)
        const committed = await mistakes.commit(draft.draft_id, signal)
        return { ok: true, data: committed }
      }
      if (action === 'review') {
        if (!args.mistake_id || !args.rating) {
          throw new Error('review 需要提供 mistake_id 和 rating')
        }
        return { ok: true, data: mistakes.review(args) }
      }
      if (action === 'delete') {
        if (!args.mistake_id) throw new Error('delete 需要提供 mistake_id')
        return { ok: true, data: { deleted: mistakes.delete(args.mistake_id) } }
      }
      throw new Error(`未知 study_mistake 操作：${action}`)
    }

    case 'study_paper': {
      const action = args.action || 'assemble'
      if (action === 'assemble') {
        return { ok: true, data: papers.assemble(args) }
      }
      if (action === 'assemble_mistakes') {
        return { ok: true, data: mistakes.assembleMistakes(args) }
      }
      if (action === 'assemble_custom') {
        return { ok: true, data: papers.assembleFromKeys(args) }
      }
      if (action === 'get') {
        if (!args.paper_id) throw new Error('get 需要提供 paper_id')
        return { ok: true, data: papers.get(args.paper_id) }
      }
      if (action === 'list') {
        return { ok: true, data: papers.list() }
      }
      if (action === 'update_items') {
        if (!args.paper_id || !args.items?.length) throw new Error('update_items 需要提供 paper_id 和 items')
        return { ok: true, data: papers.updateItems(args.paper_id, args.items) }
      }
      if (action === 'update_comments') {
        if (!args.paper_id || !args.comments?.length) throw new Error('update_comments 需要提供 paper_id 和 comments')
        return { ok: true, data: papers.updateComments(args.paper_id, args.comments) }
      }
      if (action === 'add_variant') {
        if (!args.paper_id || !args.question) throw new Error('add_variant 需要提供 paper_id 和 question')
        return { ok: true, data: papers.addVariant(args) }
      }
      throw new Error(`未知 study_paper 操作：${action}`)
    }

    case 'study_export': {
      const rendered = await render.render({
        ...args,
        template_id: args.template_id || (args.format === 'ppt' ? config.defaultPptTemplate : config.defaultPdfTemplate),
        mode: args.mode || config.defaultPdfMode,
      }, signal)
      const paper = papers.get(rendered.paper_id)
      const paperTitle = paper?.title || '练习卷'
      const session = exec?.agent?.session
      const workingDirectory = exec?.agent?.ctx?.get?.('workingDirectory') ?? ctx?.get?.('workingDirectory')
      const workspaceCwd = session?.header?.cwd
        || (workingDirectory && exec?.agent ? await workingDirectory.ensure(exec.agent, signal).catch(() => '') : '')
      const deliveredFiles = await materializeDeliverables({
        rendered,
        paperTitle,
        dataDir: config.dataDir,
        workspaceCwd,
        agentCtx: exec?.agent?.ctx,
        signal,
      })

      // 自动准备宿主原生文件卡片事件（DSH 与词元工坊通用 deliverables/presented）
      let presentedNatively = false
      if (session && typeof session.append === 'function' && deliveredFiles.length && pendingDeliveries) {
        const agents = ctx?.get?.('agents') ?? exec?.agent?.ctx?.get?.('agents')
        const boundary = agents?.turnBoundaryOf?.(session)
        if (boundary && boundary.openTurnStartSeq !== null) {
          pendingDeliveries.set(exec, {
            session,
            turn: boundary.lastTurn,
            files: deliveredFiles.map(f => ({ path: f.presentPath, description: f.description })),
          })
          presentedNatively = true
        }
      }

      return {
        ok: true,
        data: {
          export_id: rendered.export_id,
          paper_id: rendered.paper_id,
          paper_title: paperTitle,
          question_count: paper?.items?.length ?? undefined,
          total_score: paper?.items?.reduce((sum, item) => sum + Number(item.score || 0), 0) ?? undefined,
          format: rendered.format,
          template_id: rendered.template_id,
          export_mode: rendered.export_mode,
          status: rendered.status,
          degraded_reason: rendered.degraded_reason ?? null,
          error_excerpt: rendered.error_excerpt ?? null,
          output_dir: rendered.output_dir_abs ?? rendered.output_dir,
          tex_paths: rendered.tex_paths ?? [],
          log_paths: rendered.log_paths ?? [],
          delivered_files: deliveredFiles.map(f => ({
            file_name: f.fileName,
            path: f.presentPath,
            relative_path: f.relativePath,
            description: f.description,
          })),
          presented_natively: presentedNatively,
          delivery_note: rendered.status === 'ok'
            ? (presentedNatively
              ? '成品文件已保存到当前工作区并自动挂载为原生可点击文件卡片。请简明汇报试卷标题、题量、总分与已交付文件名（勿输出 /api/dsh-study/... 相对链接）；除非用户要求质检或预览，否则可直接结束本轮。'
              : '成品文件已保存到 delivered_files 路径。若环境提供 present 工具，可调用一次 present 交付可点击文件卡片（勿输出 /api/dsh-study/... 相对链接）。')
            : `本次导出已降级为可打印网页版：${rendered.degraded_reason || '编译未通过'}。可查看 log_paths 定位详情或调用 study_bank(action="install_latex") 安装轻量 TinyTeX。`,
        },
      }
    }

    case 'study_feedback':
      return { ok: true, data: await services.feedback.submit(args, signal) }

    default:
      throw new Error(`未知工具：${name}`)
  }
}

function sanitizeFileBaseName(name, fallback = '练习卷') {
  const cleaned = String(name ?? '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 72)
  return cleaned || fallback
}

async function copyFileNonDestructive(srcPath, destDir, baseName, ext) {
  await fs.mkdir(destDir, { recursive: true })
  for (let index = 1; index <= 99; index++) {
    const fileName = index === 1 ? `${baseName}${ext}` : `${baseName}-${index}${ext}`
    const destPath = path.join(destDir, fileName)
    try {
      await fs.copyFile(srcPath, destPath, fsConstants.COPYFILE_EXCL)
      return { destPath, fileName }
    } catch (error) {
      if (error?.code === 'EEXIST') continue
      throw error
    }
  }
  const fallbackName = `${baseName}-${Date.now()}${ext}`
  const destPath = path.join(destDir, fallbackName)
  await fs.copyFile(srcPath, destPath)
  return { destPath, fileName: fallbackName }
}

export async function materializeDeliverables({ rendered, paperTitle, dataDir, workspaceCwd, agentCtx, signal }) {
  const arts = rendered.artifacts ?? {}
  const base = sanitizeFileBaseName(paperTitle, rendered.format === 'ppt' ? '讲评课件' : '练习卷')
  const candidates = []
  if (rendered.format === 'ppt' && arts.pptx) {
    candidates.push({ rel: arts.pptx, baseName: `${base}（讲评课件）`, ext: '.pptx', description: '讲评 PPT 课件' })
  } else if (arts.inlinePdf) {
    candidates.push({ rel: arts.inlinePdf, baseName: base, ext: '.pdf', description: 'PDF 试卷（含解析）' })
  } else if (arts.questionPdf || arts.answerPdf) {
    if (arts.questionPdf) {
      candidates.push({ rel: arts.questionPdf, baseName: `${base}（原题卷）`, ext: '.pdf', description: 'PDF 原题卷' })
    }
    if (arts.answerPdf) {
      candidates.push({ rel: arts.answerPdf, baseName: `${base}（答案与解析）`, ext: '.pdf', description: 'PDF 答案与解析卷' })
    }
  } else if (arts.html) {
    candidates.push({ rel: arts.html, baseName: `${base}（可打印网页版）`, ext: '.html', description: '可打印试卷网页版' })
  }

  const dshFs = agentCtx?.get?.('fs')
  const out = []
  for (const item of candidates) {
    const srcAbs = path.join(dataDir, ...item.rel.split('/'))
    try {
      const stat = await fs.stat(srcAbs)
      if (!stat.isFile() || stat.size <= 0) continue
    } catch {
      continue
    }

    let finalAbs = srcAbs
    let fileName = `${item.baseName}${item.ext}`
    let relativePath = null
    if (workspaceCwd) {
      try {
        const copied = await copyFileNonDestructive(srcAbs, workspaceCwd, item.baseName, item.ext)
        finalAbs = copied.destPath
        fileName = copied.fileName
        relativePath = copied.fileName
      } catch {
        // 工作区不可写时回退到原始导出文件
      }
    }

    let presentPath = finalAbs
    if (dshFs && workspaceCwd && relativePath) {
      try {
        const target = await dshFs.resolve(relativePath, { cwd: workspaceCwd, signal })
        presentPath = dshFs.processPath(target)
      } catch {}
    }

    out.push({ fileName, presentPath, relativePath, description: item.description })
  }
  return out
}

export function searchQuestions(db, papers, args) {
  const where = []
  const params = []
  const addIn = (column, values) => {
    if (!values?.length) return
    where.push(`${column} IN (${values.map(() => '?').join(',')})`)
    params.push(...values)
  }
  addIn('q.source_id', args.source_ids)
  addIn('q.course_code', args.course_codes)
  addIn('q.type', args.types)
  addIn('q.answer_origin', args.answer_origins)
  addIn('q.source_kind', args.source_kinds)
  if (args.exclude_quarantined !== false) where.push('q.quarantined=0')
  if (Number.isInteger(args.difficulty_min)) { where.push('q.difficulty>=?'); params.push(args.difficulty_min) }
  if (Number.isInteger(args.difficulty_max)) { where.push('q.difficulty<=?'); params.push(args.difficulty_max) }
  if (Number.isInteger(args.year_from)) { where.push('q.source_year>=?'); params.push(args.year_from) }
  if (Number.isInteger(args.year_to)) { where.push('q.source_year<=?'); params.push(args.year_to) }
  const kps = papers.expandTaxonomy(args.course_codes ?? [], args.kp_ids ?? [])
  if (kps.length) {
    where.push(`EXISTS (SELECT 1 FROM question_kp kp WHERE kp.source_id=q.source_id
      AND kp.question_id=q.id AND kp.kp_id IN (${kps.map(() => '?').join(',')}))`)
    params.push(...kps)
  }
  const query = String(args.query ?? '').trim()
  const limit = Math.max(1, Math.min(100, Math.trunc(args.limit ?? 30)))
  const offset = Math.max(0, Math.trunc(args.offset ?? 0))

  const runQuery = (ftsJoin, extraWhere, extraParams) => {
    const allWhere = [...where, ...extraWhere]
    const allParams = [...params, ...extraParams]
    return db.prepare(`
      SELECT q.source_id,q.id,q.raw_json,q.course_code,q.type,q.difficulty,q.answer_origin,
        q.source_kind,q.source_year,q.source_ref,q.quarantined
      FROM questions q ${ftsJoin}
      ${allWhere.length ? `WHERE ${allWhere.join(' AND ')}` : ''}
      ORDER BY q.course_code,q.id LIMIT ? OFFSET ?
    `).all(...allParams, limit, offset)
  }

  let rows
  if (!query) {
    rows = runQuery('', [], [])
  } else {
    const terms = query.split(/\s+/).filter(Boolean)
    const pureAscii = terms.every(t => /^[A-Za-z0-9]+$/.test(t))
    if (pureAscii) {
      rows = runQuery(
        'JOIN questions_fts ON questions_fts.source_id=q.source_id AND questions_fts.id=q.id',
        ['questions_fts MATCH ?'],
        [terms.map(t => `"${t.replaceAll('"', '""')}"`).join(' AND ')],
      )
    }
    if (!rows?.length) {
      // 支持中文子串、LaTeX 公式片段、年份、课号与中文知识点名称搜索
      const likeWhere = []
      const likeParams = []
      for (const term of terms) {
        const escaped = term.replace(/[\\%_]/g, '\\$&')
        const pattern = `%${escaped}%`
        likeWhere.push(`(
          q.stem_md LIKE ? ESCAPE '\\'
          OR q.answer_md LIKE ? ESCAPE '\\'
          OR q.solution_md LIKE ? ESCAPE '\\'
          OR q.source_ref LIKE ? ESCAPE '\\'
          OR q.id LIKE ? ESCAPE '\\'
          OR q.course_code LIKE ? ESCAPE '\\'
          OR EXISTS (
            SELECT 1 FROM question_kp kp
            JOIN taxonomy t ON t.source_id=kp.source_id AND t.course_code=kp.course_code AND t.kp_id=kp.kp_id
            WHERE kp.source_id=q.source_id AND kp.question_id=q.id AND t.name LIKE ? ESCAPE '\\'
          )
        )`)
        likeParams.push(pattern, pattern, pattern, pattern, pattern, pattern, pattern)
      }
      rows = runQuery('', likeWhere, likeParams)
    }
  }
  return rows.map(row => ({
    ...row,
    question: JSON.parse(row.raw_json),
    raw_json: undefined,
  }))
}

export function questionDetails(db, config, args) {
  const row = db.prepare('SELECT raw_json,course_code FROM questions WHERE source_id=? AND id=?')
    .get(args.source_id, args.question_id)
  if (!row) return null
  const question = JSON.parse(row.raw_json)
  const scope = args.source_id === 'local-personal' ? 'personal' : 'cache'
  const figures = [
    ...question.stem.figures,
    ...question.answer.figures,
    ...question.solution.figures,
    ...question.options.flatMap(option => option.figures ?? []),
  ]
  const figure_urls = figures.map(figure => {
    assertSafeRelative(figure.path)
    return {
      id: figure.id,
      path: figure.path,
      url: `/api/dsh-study/file?path=${encodeURIComponent(`${scope}/${args.source_id}/${row.course_code}/${figure.path}`)}`,
    }
  })
  return { question, figure_urls }
}
