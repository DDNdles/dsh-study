# 零登录题目反馈中转（Cloudflare Worker）

将此 Worker 部署后，把得到的 HTTPS 地址填入题库仓库 `manifest.json` 的 `feedback_endpoint` 字段。用户在 `dsh-study` 插件内点击「提交反馈」即可**无需任何 GitLab / GitHub 账号、无需跳转浏览器**，自动在你的题库仓库生成结构化 Issue。

## 部署步骤

### 1. 创建单仓库最小权限令牌（二选一，或双配互为兜底）
- **USTC GitLab（推荐）**：打开题库仓库 → `Settings → Access Tokens` → 创建 **Project Access Token**（角色 `Reporter` 或 `Developer`，权限仅勾选 `api`）。
- **GitHub**：在 GitHub `Settings → Developer settings → Fine-grained personal access tokens` 创建仅限题库单仓库的 Token（权限仅勾选 `Issues: Read and write`）。

### 2. 部署 Worker 并写入加密密钥
```bash
cd examples/feedback-worker
npx wrangler login
npx wrangler secret put GITLAB_TOKEN   # 粘贴 GitLab Project Access Token
# 可选：再配一个 GitHub Token 作为自动兜底
# npx wrangler secret put GITHUB_TOKEN
npx wrangler deploy
```

> **国内 / 校内网络提示**：Cloudflare 默认的 `*.workers.dev` 域名在国内部分网络可能被干扰，建议在 Cloudflare 控制台 **Workers & Pages → Settings → Domains & Routes** 绑定一个自定义子域名（例如 `feedback.yourdomain.com`），国内即可稳定直连。

### 3. 写入题库 `manifest.json`
在你的题库仓库 `manifest.json` 顶层增加一行：
```json
"feedback_endpoint": "https://你的Worker地址/"
```
插件同步或刷新题库清单后即自动启用免登录一键直推；若网络暂时不可达，会自动平滑回退到预填 Issue 链接与一键复制。
