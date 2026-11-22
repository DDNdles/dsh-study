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
    ['study_source_list', '查看已注册题库源与已下载课程列表。', object()],
    ['study_source_add', '添加并校验一个符合 manifest v1.0 协议的题库源。', object({
      source_id: string('题库源唯一标识（留空自动生成）'),
      name: string('题库源中文名称'),
      transport: { type: 'string', enum: ['github-raw', 'http-manifest', 'local-dir', 'git'] },
      location: string('GitHub 仓库（owner/repo）、网络地址或本机目录路径'),
      ref: string('Git 分支、标签或提交号'),
      mirror_url: string('可选下载镜像前缀'),
    }, ['transport', 'location'])],
    ['study_source_sync', '按课程代码下载或增量更新题库（自动校验 SHA-256 与 Schema）。', object({
      source_id: string('题库源标识'),
      course_codes: array(string('课程代码'), { minItems: 1 }),
    }, ['source_id', 'course_codes'])],
    ['study_taxonomy_list', '查询已下载课程的知识点树（中文名称、层级与 kp_id），用于精准检索、录题与组卷。', object({
      course_codes: array(string('课程代码，留空则返回全部已装课程知识点')),
    })],
    ['study_question_search', '基于 FTS5 全文检索与结构化条件（课程、知识点、题型、难度、年份、答案来源）搜索已下载题目。', object({
      query: string('全文检索关键词'),
      source_ids: array(string('题库源标识')),
      course_codes: array(string('课程代码')),
      kp_ids: array(string('知识点 ID（自动包含下级知识点）')),
      types: array({ type: 'string', enum: ['single', 'multi', 'blank', 'solve', 'proof'] }),
      difficulty_min: number('最低难度（1–5）', { minimum: 1, maximum: 5 }),
      difficulty_max: number('最高难度（1–5）', { minimum: 1, maximum: 5 }),
      answer_origins: array({ type: 'string', enum: ['official', 'community', 'ai'] }),
      source_kinds: array({ type: 'string', enum: ['exam_paper', 'book', 'dataset', 'notes'] }),
      year_from: number('起始年份'),
      year_to: number('结束年份'),
      exclude_quarantined: bool('是否排除低置信隔离题（默认 true）'),
      limit: number('返回条数上限', { minimum: 1, maximum: 100 }),
      offset: number('分页偏移', { minimum: 0 }),
    })],
    ['study_question_get', '读取单题完整 v1.0 数据与本地配图地址。', object({
      source_id: string('题库源标识'),
      question_id: string('题目 ID'),
    }, ['source_id', 'question_id'])],
    ['study_mistake_mark', '将题库中已有题目记入个人错题本，记录错因标签、错误做法与反思。', object({
      source_id: string('题库源标识'),
      question_id: string('题目 ID'),
      error_tags: array(string('错因标签，如：概念、计算、方法、证明、审题、粗心')),
      wrong_attempt_md: string('用户的错误思路或卡壳点'),
      reflection_md: string('反思总结与正确要点'),
    }, ['source_id', 'question_id'])],
    ['study_mistake_ingest_draft', '校验并暂存一道新录错题草稿（不落盘），展示给用户核对并等待确认。', object({
      question,
      error_tags: array(string('错因标签')),
      wrong_attempt_md: string('错误做法'),
      reflection_md: string('反思笔记'),
    }, ['question'])],
    ['study_mistake_draft_list', '列出等待用户确认的错题草稿。', object()],
    ['study_mistake_commit', '在用户后续消息明确确认后，将暂存错题草稿写入个人题库与错题本。', object({
      draft_id: string('草稿 ID'),
      confirmed: bool('仅在用户明确确认后传 true'),
    }, ['draft_id', 'confirmed'])],
    ['study_mistake_list', '查询个人错题本与待复习优先级。', object({
      source_id: string('可选题库源'),
      course_code: string('可选课程代码'),
      status: { type: 'string', enum: ['unmastered', 'reviewing', 'mastered'] },
      dueOnly: bool('仅返回已到期需复习的错题'),
    })],
    ['study_mistake_review', '记录一次错题复习打卡（简化 SM-2 调度）。', object({
      mistake_id: string('错题 ID'),
      rating: { type: 'string', enum: ['again', 'hard', 'good', 'easy'] },
      note_md: string('本次复习备注'),
    }, ['mistake_id', 'rating'])],
    ['study_paper_assemble_mistakes', '按错题复习优先级与同知识点拓展组装错题巩固卷。', object({
      course_codes: array(string('课程代码')),
      mistake_ids: array(string('指定错题 ID 列表')),
      count: number('目标题数', { minimum: 1, maximum: 500 }),
      original_redo_ratio: number('原错题重做占比（0–1）', { minimum: 0, maximum: 1 }),
      include_similar: bool('是否补充同知识点类似题'),
      exclude_quarantined: bool('是否排除隔离题'),
      title: string('试卷标题'),
      seed: number('随机种子'),
    })],
    ['study_paper_assemble_exam', '按条件或大题蓝图组装模拟试卷/专题练习卷，并如实报告题量缺口。', object({
      mode: { type: 'string', enum: ['exam', 'topic'] },
      title: string('试卷标题'),
      course_codes: array(string('课程代码')),
      source_ids: array(string('题库源标识')),
      kp_ids: array(string('知识点 ID 列表')),
      count: number('目标总题数', { minimum: 1, maximum: 500 }),
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
        title: string('大题名称'),
        count: number('该大题题数', { minimum: 0, maximum: 200 }),
        score: number('每小题分值', { minimum: 0.5 }),
      }, ['title', 'count', 'score'])),
    })],
    ['study_paper_assemble_custom', '按大模型精选的具体题目列表组装自定义试卷（可附每题分值、大题名与针对性点评）。', object({
      title: string('试卷标题'),
      mode: { type: 'string', enum: ['exam', 'topic', 'mistake'] },
      items: array(object({
        source_id: string('题库源标识'),
        question_id: string('题目 ID'),
        score: number('分值', { minimum: 0.5 }),
        section_title: string('所属大题标题'),
        comment_md: string('针对性学习点评（渲染为 PDF 红色点评与 PPT 易错提示）'),
      }, ['source_id', 'question_id']), { minItems: 1 }),
    }, ['items'])],
    ['study_paper_get', '读取已保存试卷的完整题目清单与分值。', object({
      paper_id: string('试卷 ID'),
    }, ['paper_id'])],
    ['study_paper_items_update', '调整已保存试卷的题目顺序与分值。', object({
      paper_id: string('试卷 ID'),
      items: array(object({
        seq: number('原题序号'),
        score: number('调整后的分值', { minimum: 0, maximum: 1000 }),
      }), { minItems: 1 }),
    }, ['paper_id', 'items'])],
    ['study_paper_comment_update', '为已保存试卷的题目写入或更新针对性点评（直接渲染在 PDF 红色点评与 PPT 讲评页中）。', object({
      paper_id: string('试卷 ID'),
      comments: array(object({
        seq: number('题序号（从 1 开始）'),
        comment_md: string('点评内容（支持行内 LaTeX）'),
      }, ['seq', 'comment_md']), { minItems: 1 }),
    }, ['paper_id', 'comments'])],
    ['study_paper_list', '列出最近保存的试卷列表。', object()],
    ['study_paper_variant_propose', '仅在全局与单次开关均开启时，暂存一道 AI 变式题草稿待用户确认。', object({
      paper_id: string('试卷 ID'),
      question,
      score: number('分值', { minimum: 0.5 }),
      allow_ai_variants: bool('本次显式允许 AI 变式'),
    }, ['paper_id', 'question', 'allow_ai_variants'])],
    ['study_paper_variant_commit', '用户明确确认后，将暂存 AI 变式题加入试卷。', object({
      draft_id: string('变式草稿 ID'),
      confirmed: bool('仅在用户明确确认后传 true'),
    }, ['draft_id', 'confirmed'])],
    ['study_template_list', '查看内置及用户自定义的所有 PDF 与 PPT 导出模板。', object()],
    ['study_env_check', '检测本机 LaTeX（xelatex）排版环境是否可用及自动安装进度。', object()],
    ['study_env_install_latex', '自动下载并安装独立轻量 LaTeX 环境（TinyTeX + 中文试卷宏包）到插件数据目录；仅在用户明确确认安装后调用。', object({
      confirmed: bool('仅在用户明确确认安装后传 true'),
    }, ['confirmed'])],
    ['study_question_feedback', '记录题目问题反馈（题干错误、解析错误、来源错误、图片不清晰/被截断、公式排版或知识点归类错误等），并生成直达题库仓库的一键预填 Issue 链接（若题库配置了直推接口则直接发送）。', object({
      source_id: string('题库源标识'),
      question_id: string('题目 ID'),
      categories: array(string('问题类型，如：题干错误、答案或解析错误、来源/年份错误、图片不清晰、图片被截断、公式排版异常、知识点归类错误、其他问题'), { minItems: 1 }),
      detail: string('补充说明（选填）'),
    }, ['source_id', 'question_id', 'categories'])],
    ['study_export_render', '将已保存试卷导出为 PDF（题目后解析或原题与答案分开）或讲评 PPTX。', object({
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
      }),
    }, ['paper_id', 'format'])],
  ]
  for (const [name, description, parameters] of definitions) {
    ctx.effect(() => ctx.tools.register({
      name,
      description,
      parameters,
      output: toolOutput,
      async execute(args, exec = {}) {
        return plainJson(await execute(name, args ?? {}, exec, services))
      },
    }))
  }
}

async function execute(name, args, exec, services) {
  const { sources, mistakes, papers, render, db, config } = services
  const signal = exec.signal
  switch (name) {
    case 'study_source_list':
      return {
        ok: true,
        data: sources.list().map(row => ({
          ...row,
          // 不向大模型暴露本机数据目录绝对路径，避免触发文件系统探索
          location: row.transport === 'personal' ? '内置个人错题库' : row.location,
        })),
      }
    case 'study_source_add':
      return { ok: true, data: await sources.add(args, signal) }
    case 'study_source_sync':
      return { ok: true, data: await sources.sync(args.source_id, args.course_codes, signal) }
    case 'study_taxonomy_list':
      return { ok: true, data: papers.taxonomyList(args.course_codes ?? []) }
    case 'study_question_search':
      return { ok: true, data: searchQuestions(db, papers, args) }
    case 'study_question_get':
      return { ok: true, data: questionDetails(db, config, args) }
    case 'study_mistake_mark':
      return { ok: true, data: mistakes.mark(args) }
    case 'study_mistake_ingest_draft': {
      const data = mistakes.draft(args)
      return { ok: true, data, summary: `已生成待确认错题草稿，请向用户展示完整题面与解析并等待确认。` }
    }
    case 'study_mistake_draft_list':
      return { ok: true, data: mistakes.listDrafts() }
    case 'study_mistake_commit':
      assertUserConfirmation(exec, args.confirmed)
      return { ok: true, data: await mistakes.commit(args.draft_id, signal) }
    case 'study_mistake_list':
      return { ok: true, data: mistakes.list(args) }
    case 'study_mistake_review':
      return { ok: true, data: mistakes.review(args) }
    case 'study_paper_assemble_mistakes':
      return { ok: true, data: mistakes.assembleMistakes(args) }
    case 'study_paper_assemble_exam':
      return { ok: true, data: papers.assemble(args) }
    case 'study_paper_assemble_custom':
      return { ok: true, data: papers.assembleFromKeys(args) }
    case 'study_paper_get':
      return { ok: true, data: papers.get(args.paper_id) }
    case 'study_paper_items_update':
      return { ok: true, data: papers.updateItems(args.paper_id, args.items) }
    case 'study_paper_comment_update':
      return { ok: true, data: papers.updateComments(args.paper_id, args.comments) }
    case 'study_paper_list':
      return { ok: true, data: papers.list() }
    case 'study_paper_variant_propose':
      return { ok: true, data: papers.proposeVariant(args, args) }
    case 'study_paper_variant_commit':
      assertUserConfirmation(exec, args.confirmed)
      return { ok: true, data: papers.confirmVariant(args.draft_id) }
    case 'study_template_list':
      return { ok: true, data: await render.templates() }
    case 'study_env_check': {
      const env = await services.latexEnv.detect(config.xelatexBin, signal)
      return { ok: true, data: { ...env, executable: undefined } }
    }
    case 'study_env_install_latex':
      assertUserConfirmation(exec, args.confirmed)
      services.latexEnv.install({ mirrorBaseUrl: config.mirrorBaseUrl }).catch(() => {})
      return { ok: true, data: await services.latexEnv.detect(config.xelatexBin, signal) }
    case 'study_question_feedback':
      return { ok: true, data: await services.feedback.submit(args, signal) }
    case 'study_export_render': {
      const rendered = await render.render({
        ...args,
        template_id: args.template_id || (args.format === 'ppt' ? config.defaultPptTemplate : config.defaultPdfTemplate),
        mode: args.mode || config.defaultPdfMode,
      }, signal)
      const arts = rendered.artifacts ?? {}
      const fileLink = rel => (rel ? `/api/dsh-study/file?path=${encodeURIComponent(rel)}` : undefined)
      const downloadLink = rel => (rel ? `/api/dsh-study/file?path=${encodeURIComponent(rel)}&download=1` : undefined)
      const links = {}
      if (arts.inlinePdf) { links.pdf_preview = fileLink(arts.inlinePdf); links.pdf_download = downloadLink(arts.inlinePdf) }
      if (arts.questionPdf) { links.question_pdf_preview = fileLink(arts.questionPdf); links.question_pdf_download = downloadLink(arts.questionPdf) }
      if (arts.answerPdf) { links.answer_pdf_preview = fileLink(arts.answerPdf); links.answer_pdf_download = downloadLink(arts.answerPdf) }
      if (arts.pptx) { links.pptx_download = downloadLink(arts.pptx) }
      if (arts.html) { links.html_preview = fileLink(arts.html) }
      return {
        ok: true,
        data: {
          export_id: rendered.export_id,
          paper_id: rendered.paper_id,
          format: rendered.format,
          template_id: rendered.template_id,
          export_mode: rendered.export_mode,
          status: rendered.status,
          degraded_reason: rendered.degraded_reason ?? null,
          links,
          done: rendered.status === 'ok',
          delivery_note: rendered.status === 'ok'
            ? '导出已成功完成且内置模板已校验通过。请直接向用户汇报试卷标题、题量、总分与上方预览/下载链接并立即结束本轮；除非用户明确要求打开浏览器检查排版，否则不要调用浏览器、截图或脚本做二次核查，更不要修改任何插件或模板文件。'
            : '当前因缺少本机 XeLaTeX 已降级为可打印网页版，请如实告知用户并提供 html_preview 链接，可询问用户是否确认安装轻量 TinyTeX（study_env_install_latex）。',
        },
      }
    }
    default:
      throw new Error(`未知工具：${name}`)
  }
}

function assertUserConfirmation(exec, confirmed) {
  if (confirmed !== true || !hasRecentUserConfirmation(exec.agent?.session)) {
    throw new Error('未执行写入：请先向用户展示完整草稿内容，待用户在下一条消息中明确确认后再提交。')
  }
}

function hasRecentUserConfirmation(session) {
  const nodes = session?.surface?.nodes
  if (!Array.isArray(nodes) || typeof session.eventAt !== 'function') return false
  for (let index = nodes.length - 1; index >= 0; index--) {
    const event = session.eventAt(nodes[index])
    if (event?.type !== 'user/message' || event.data?.source?.kind !== 'user') continue
    const content = event.data.message?.content ?? event.data.content ?? []
    const text = Array.isArray(content)
      ? content.filter(item => item.type === 'text').map(item => item.text).join('\n')
      : String(content)
    return /确认|同意|保存|入库|提交|可以|好的/.test(text) && !/不要|暂不|取消|拒绝/.test(text)
  }
  return false
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
