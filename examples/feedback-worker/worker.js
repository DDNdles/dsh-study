/**
 * dsh-study 零登录题目反馈中转服务（Cloudflare Workers / 标准 Web Fetch Worker）
 *
 * 环境变量（普通变量，可在 wrangler.toml 或控制台配置）：
 *   - GITLAB_BASE_URL   例如 https://git.ustc.edu.cn（可选）
 *   - GITLAB_PROJECT_ID 例如 10052 或 zzl_stella05/USTC-Question-Bank（可选）
 *   - GITHUB_REPO       例如 DDNdles/USTC-Question-Bank（可选）
 *   - ALLOWED_SOURCES   逗号分隔的允许 source_id 白名单（可选，留空不限）
 *
 * 密钥（必须通过 `wrangler secret put` 或控制台 Secret 加密配置，绝不写入代码）：
 *   - GITLAB_TOKEN      仅限目标题库单仓库的 Project Access Token（权限：api）
 *   - GITHUB_TOKEN      仅限目标题库单仓库的 Fine-grained PAT（权限：Issues Read and write）
 */

const ipWindow = new Map()
const recentKeys = new Map()

const WINDOW_MS = 10 * 60 * 1000
const MAX_PER_WINDOW = 6
const DEDUP_MS = 60 * 1000

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...CORS_HEADERS },
  })
}

function checkRateLimit(ip, dedupKey) {
  const now = Date.now()
  // 软去重：同一 IP + 同一题目 60 秒内防连点
  const last = recentKeys.get(dedupKey)
  if (last && now - last < DEDUP_MS) {
    return '同一题目请勿在 1 分钟内重复提交'
  }
  const stamps = (ipWindow.get(ip) ?? []).filter(t => now - t < WINDOW_MS)
  if (stamps.length >= MAX_PER_WINDOW) {
    return '提交过于频繁，请几分钟后再试'
  }
  stamps.push(now)
  ipWindow.set(ip, stamps)
  recentKeys.set(dedupKey, now)
  if (recentKeys.size > 500) {
    for (const [k, ts] of recentKeys) {
      if (now - ts > DEDUP_MS) recentKeys.delete(k)
    }
  }
  return null
}

async function createGitLabIssue(env, { title, markdown, courseCode }) {
  const base = String(env.GITLAB_BASE_URL || 'https://git.ustc.edu.cn').replace(/\/+$/, '')
  const project = encodeURIComponent(String(env.GITLAB_PROJECT_ID || '').trim())
  const url = `${base}/api/v4/projects/${project}/issues`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'PRIVATE-TOKEN': env.GITLAB_TOKEN,
    },
    body: JSON.stringify({
      title,
      description: markdown,
      labels: ['question-feedback', courseCode].filter(Boolean).join(','),
    }),
  })
  if (!res.ok) {
    throw new Error(`GitLab API ${res.status}: ${(await res.text()).slice(0, 200)}`)
  }
  const data = await res.json()
  return { target: 'gitlab', issue_url: data.web_url, issue_iid: data.iid }
}

async function createGitHubIssue(env, { title, markdown }) {
  const repo = String(env.GITHUB_REPO || '').trim()
  const url = `https://api.github.com/repos/${repo}/issues`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'dsh-study-feedback-relay/1.0',
    },
    body: JSON.stringify({
      title,
      body: markdown,
      labels: ['question-feedback'],
    }),
  })
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status}: ${(await res.text()).slice(0, 200)}`)
  }
  const data = await res.json()
  return { target: 'github', issue_url: data.html_url, issue_iid: data.number }
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS })
    }
    if (request.method === 'GET') {
      return json({ ok: true, service: 'dsh-study-feedback-relay' })
    }
    if (request.method !== 'POST') {
      return json({ ok: false, error: 'Method not allowed' }, 405)
    }

    let payload
    try {
      const raw = await request.text()
      if (raw.length > 16_000) return json({ ok: false, error: 'Payload too large' }, 413)
      payload = JSON.parse(raw)
    } catch {
      return json({ ok: false, error: 'Invalid JSON' }, 400)
    }

    if (payload?.schema !== 'dsh-study-feedback/1.0') {
      return json({ ok: false, error: 'Unsupported feedback schema' }, 400)
    }

    const sourceId = String(payload.source_id ?? '').trim()
    const courseCode = String(payload.course_code ?? '').trim().slice(0, 40)
    const questionId = String(payload.question_id ?? '').trim().slice(0, 120)
    const title = String(payload.title ?? '').trim().slice(0, 160)
    const markdown = String(payload.markdown ?? '').trim().slice(0, 4000)

    if (!courseCode || !questionId || !title || !markdown) {
      return json({ ok: false, error: 'Missing required feedback fields' }, 400)
    }

    if (env.ALLOWED_SOURCES) {
      const allowed = new Set(String(env.ALLOWED_SOURCES).split(',').map(s => s.trim()).filter(Boolean))
      if (allowed.size && !allowed.has(sourceId)) {
        return json({ ok: false, error: 'Source not allowed' }, 403)
      }
    }

    const ip = request.headers.get('cf-connecting-ip')
      || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || 'unknown'
    const limited = checkRateLimit(ip, `${ip}:${sourceId}:${questionId}`)
    if (limited) {
      return json({ ok: false, error: limited }, 429)
    }

    const hasGitLab = Boolean(env.GITLAB_TOKEN && env.GITLAB_PROJECT_ID)
    const hasGitHub = Boolean(env.GITHUB_TOKEN && env.GITHUB_REPO)
    if (!hasGitLab && !hasGitHub) {
      return json({ ok: false, error: 'Relay target is not configured' }, 500)
    }

    const errors = []
    if (hasGitLab) {
      try {
        const result = await createGitLabIssue(env, { title, markdown, courseCode })
        return json({ ok: true, ...result }, 201)
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err))
      }
    }
    if (hasGitHub) {
      try {
        const result = await createGitHubIssue(env, { title, markdown })
        return json({ ok: true, ...result }, 201)
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err))
      }
    }

    return json({ ok: false, error: errors.join(' | ') || 'Upstream error' }, 502)
  },
}
