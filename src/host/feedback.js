import { randomUUID } from 'node:crypto'

export const FEEDBACK_CATEGORIES = [
  { id: 'stem_error', label: '题干错误' },
  { id: 'solution_error', label: '答案或解析错误' },
  { id: 'source_error', label: '来源/年份错误' },
  { id: 'image_blurry', label: '图片不清晰' },
  { id: 'image_cropped', label: '图片被截断' },
  { id: 'latex_format', label: '公式排版异常' },
  { id: 'taxonomy_error', label: '知识点归类错误' },
  { id: 'other', label: '其他问题' },
]

const CATEGORY_BY_ID = new Map(FEEDBACK_CATEGORIES.map(c => [c.id, c]))
const CATEGORY_BY_LABEL = new Map(FEEDBACK_CATEGORIES.map(c => [c.label, c]))

// 内置镜像源之间的仓库映射，确保无论用户从哪个镜像下载都能一键直达校内 GitLab 与 GitHub
const BUILTIN_REPO_MIRRORS = {
  'ustc-gitlab': {
    gitlab: 'https://git.ustc.edu.cn/zzl_stella05/USTC-Question-Bank',
    github: 'DDNdles/USTC-Question-Bank',
  },
  'ustc-official': {
    gitlab: 'https://git.ustc.edu.cn/zzl_stella05/USTC-Question-Bank',
    github: 'DDNdles/USTC-Question-Bank',
  },
}

function normalizeCategories(raw) {
  const list = Array.isArray(raw) ? raw : []
  const out = []
  const seen = new Set()
  for (const item of list) {
    const text = String(item ?? '').trim()
    if (!text) continue
    const found = CATEGORY_BY_ID.get(text) ?? CATEGORY_BY_LABEL.get(text)
    if (found && !seen.has(found.id)) {
      seen.add(found.id)
      out.push(found)
    } else if (!seen.has(text)) {
      seen.add(text)
      out.push({ id: 'other', label: text })
    }
  }
  return out
}

function excerpt(md, maxLen = 280) {
  const clean = String(md ?? '').replace(/\s+/g, ' ').trim()
  if (!clean) return '（无）'
  return clean.length > maxLen ? `${clean.slice(0, maxLen)}…` : clean
}

function parseGitLabRepo(urlText) {
  const text = String(urlText ?? '').trim()
  if (!text) return null
  const match = text.match(/^(https?:\/\/[^/]+\/[^/]+\/[^/]+?)(?:\/-\/raw\/|\/-\/tree\/|\/-\/blob\/|\.git$|\/?$)/)
  if (!match) return null
  const repo = match[1].replace(/\.git$/, '')
  if (/^https?:\/\/github\.com\//i.test(repo) || /^https?:\/\/raw\.githubusercontent\.com\//i.test(repo)) {
    return null
  }
  return repo
}

function parseGitHubRepo(value) {
  const text = String(value ?? '').trim()
  if (!text) return null
  if (/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(text)) return text
  const m = text.match(/^https?:\/\/github\.com\/([A-Za-z0-9._-]+\/[A-Za-z0-9._-]+?)(?:\.git|\/|$)/i)
  return m ? m[1] : null
}

function buildIssueChannels({ source, manifest, title, shortMarkdown }) {
  const channels = []
  const seenUrls = new Set()
  const addChannel = (id, label, url, primary = false) => {
    if (!url || seenUrls.has(url)) return
    seenUrls.add(url)
    channels.push({ id, label, url, primary })
  }

  const builtin = BUILTIN_REPO_MIRRORS[source?.source_id]
  let gitlabRepo = builtin?.gitlab ?? null
  let githubRepo = builtin?.github ?? null

  if (!gitlabRepo && source?.transport === 'http-manifest' && /\/-\/raw\//.test(source.location)) {
    gitlabRepo = parseGitLabRepo(source.location)
  }
  if (!gitlabRepo && source?.transport === 'git') {
    gitlabRepo = parseGitLabRepo(source.location)
  }
  if (!githubRepo && source?.transport === 'github-raw') {
    githubRepo = parseGitHubRepo(source.location)
  }
  if (!githubRepo && manifest?.repository) {
    githubRepo = parseGitHubRepo(manifest.repository)
  }
  if (!gitlabRepo && manifest?.repository) {
    gitlabRepo = parseGitLabRepo(manifest.repository)
  }

  if (gitlabRepo) {
    const isUstc = /^https?:\/\/git\.ustc\.edu\.cn\//i.test(gitlabRepo)
    const params = new URLSearchParams()
    params.set('issue[title]', title)
    params.set('issue[description]', shortMarkdown)
    addChannel(
      'gitlab',
      isUstc ? '提交到 USTC GitLab（校内免代理 · 已自动填好）' : '提交到 GitLab Issue（已自动填好）',
      `${gitlabRepo}/-/issues/new?${params.toString()}`,
      true,
    )
  }

  if (githubRepo) {
    const params = new URLSearchParams()
    params.set('title', title)
    params.set('body', shortMarkdown)
    addChannel(
      'github',
      '提交到 GitHub Issue（已自动填好）',
      `https://github.com/${githubRepo}/issues/new?${params.toString()}`,
      !gitlabRepo,
    )
  }

  if (manifest?.feedback_url && /^https?:\/\//i.test(manifest.feedback_url)) {
    addChannel('custom', '打开题库反馈页', manifest.feedback_url, channels.length === 0)
  }

  return channels
}

export class FeedbackService {
  constructor({ db, fetchImpl = fetch }) {
    this.db = db
    this.fetchImpl = fetchImpl
  }

  list({ source_id, course_code, limit = 100 } = {}) {
    const where = []
    const params = []
    if (source_id) { where.push('source_id=?'); params.push(source_id) }
    if (course_code) { where.push('course_code=?'); params.push(course_code) }
    const rows = this.db.prepare(`
      SELECT feedback_id, source_id, question_id, course_code, categories_json,
        detail, delivery_status, issue_urls_json, markdown, created_at
      FROM question_feedback
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY created_at DESC LIMIT ?
    `).all(...params, Math.max(1, Math.min(200, Math.trunc(limit))))
    return rows.map(row => ({
      ...row,
      categories: JSON.parse(row.categories_json || '[]'),
      issue_channels: JSON.parse(row.issue_urls_json || '[]'),
      categories_json: undefined,
      issue_urls_json: undefined,
    }))
  }

  async submit({ source_id, question_id, categories = [], detail = '' }, signal) {
    const sid = String(source_id ?? '').trim()
    const qid = String(question_id ?? '').trim()
    if (!sid || !qid) throw new Error('缺少题目来源或编号')

    const parsedCategories = normalizeCategories(categories)
    const detailText = String(detail ?? '').trim().slice(0, 2000)
    if (!parsedCategories.length && !detailText) {
      throw new Error('请至少选择一项问题类型或填写具体说明')
    }

    const qRow = this.db.prepare(`
      SELECT q.source_id, q.id, q.course_code, q.source_ref, q.source_year, q.raw_json,
        c.name AS course_name
      FROM questions q
      LEFT JOIN courses c ON c.source_id=q.source_id AND c.code=q.course_code
      WHERE q.source_id=? AND q.id=?
    `).get(sid, qid)

    let question = qRow ? JSON.parse(qRow.raw_json) : null
    let courseCode = qRow?.course_code ?? ''
    let courseName = qRow?.course_name ?? courseCode

    // 若原题已不在 questions（例如来自错题本快照），兜底查 mistakes 快照
    if (!question) {
      const mRow = this.db.prepare(`
        SELECT course_code, question_snapshot_json FROM mistakes
        WHERE source_id=? AND question_id=? ORDER BY updated_at DESC LIMIT 1
      `).get(sid, qid)
      if (!mRow) throw new Error('未找到对应的题目记录')
      question = JSON.parse(mRow.question_snapshot_json)
      courseCode = mRow.course_code
      courseName = courseCode
    }

    const source = this.db.prepare('SELECT * FROM sources WHERE source_id=?').get(sid)
    let manifest = null
    if (source?.manifest_json) {
      try { manifest = JSON.parse(source.manifest_json) } catch {}
    }

    const labels = parsedCategories.map(c => c.label)
    const summaryTags = labels.length ? labels.join(' / ') : '题目反馈'
    const title = `[题目反馈][${courseCode}] ${qid} · ${summaryTags}`.slice(0, 140)
    const sourceRef = question.source?.ref || qRow?.source_ref || '（无）'
    const dataVer = source?.data_version || manifest?.data_version || 'unknown'
    const sourceLabel = source ? `${source.name} (\`${source.source_id}\`, v${dataVer})` : `\`${sid}\``
    const figureList = [
      ...(question.stem?.figures ?? []),
      ...(question.answer?.figures ?? []),
      ...(question.solution?.figures ?? []),
    ].map(f => f.path).filter(Boolean)

    const buildMarkdown = (stemLimit, ansLimit) => [
      '### 题目问题反馈',
      '',
      `- **课程**：${courseName} (\`${courseCode}\`)`,
      `- **题目 ID**：\`${qid}\``,
      `- **题库源**：${sourceLabel}`,
      `- **题目出处**：${sourceRef}`,
      `- **问题类型**：${labels.length ? labels.join('、') : '其他问题'}`,
      detailText ? `- **补充说明**：${detailText}` : null,
      figureList.length ? `- **涉及配图**：${figureList.map(p => `\`${p}\``).join('、')}` : null,
      '',
      '#### 原题摘要',
      `> ${excerpt(question.stem?.md, stemLimit)}`,
      question.answer?.md ? `\n#### 当前答案摘要\n> ${excerpt(question.answer.md, ansLimit)}` : null,
    ].filter(line => line !== null).join('\n')

    const fullMarkdown = buildMarkdown(480, 240)
    const shortMarkdown = buildMarkdown(200, 120)
    const issueChannels = buildIssueChannels({ source, manifest, title, shortMarkdown })

    const feedbackId = `fb-${randomUUID().slice(0, 10)}`
    const now = new Date().toISOString()

    // 若题库 manifest 配置了 HTTPS feedback_endpoint，尝试免登录直推
    let deliveryStatus = issueChannels.length ? 'prepared' : 'local'
    let deliveryError = null
    let deliveredIssueUrl = null
    const endpoint = manifest?.feedback_endpoint
    if (typeof endpoint === 'string' && /^https?:\/\//i.test(endpoint.trim())) {
      try {
        const res = await this.fetchImpl(endpoint.trim(), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            schema: 'dsh-study-feedback/1.0',
            feedback_id: feedbackId,
            source_id: sid,
            data_version: dataVer,
            course_code: courseCode,
            course_name: courseName,
            question_id: qid,
            source_ref: sourceRef,
            categories: parsedCategories.map(c => c.id),
            category_labels: labels,
            detail: detailText,
            figures: figureList,
            title,
            markdown: fullMarkdown,
            created_at: now,
          }),
          signal: signal ?? AbortSignal.timeout(8000),
        })
        if (res.ok) {
          deliveryStatus = 'delivered'
          try {
            const body = await res.json()
            if (typeof body?.issue_url === 'string' && /^https?:\/\//i.test(body.issue_url)) {
              deliveredIssueUrl = body.issue_url
            }
          } catch {}
        } else {
          deliveryError = `直推接口返回 ${res.status}，已改用手动/Issue 提交方式`
        }
      } catch (error) {
        deliveryError = `直推暂时不可达（${error instanceof Error ? error.message : String(error)}），可使用下方链接提交`
      }
    }

    this.db.prepare(`
      INSERT INTO question_feedback (
        feedback_id, source_id, question_id, course_code, categories_json,
        detail, delivery_status, issue_urls_json, markdown, created_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?)
    `).run(
      feedbackId, sid, qid, courseCode,
      JSON.stringify(labels), detailText, deliveryStatus,
      JSON.stringify(issueChannels), fullMarkdown, now,
    )

    return {
      feedback_id: feedbackId,
      source_id: sid,
      question_id: qid,
      course_code: courseCode,
      categories: labels,
      detail: detailText,
      delivery_status: deliveryStatus,
      delivery_error: deliveryError,
      delivered_issue_url: deliveredIssueUrl,
      issue_channels: issueChannels,
      title,
      markdown: fullMarkdown,
      created_at: now,
    }
  }
}
