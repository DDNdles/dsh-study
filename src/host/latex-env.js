import fs from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { runProcess } from './process.js'

const FALLBACK_TINYTEX_TAG = 'v2026.11'
const REQUIRED_TEX_PACKAGES = [
  'ctex', 'xecjk', 'zhnumber', 'fandol', 'exam-zh',
  'environ', 'needspace', 'eso-pic', 'lastpage',
  'enumitem', 'booktabs', 'fancyhdr', 'pgf',
  'unicode-math', 'fontspec', 'l3packages', 'l3kernel',
]
const CTAN_MIRRORS = [
  'https://mirrors.ustc.edu.cn/CTAN/systems/texlive/tlnet',
  'https://mirrors.tuna.tsinghua.edu.cn/CTAN/systems/texlive/tlnet',
]

export class LatexEnvService {
  constructor({ dataDir, subprocess, xelatexBin = 'xelatex', mirrorBaseUrl = '' }) {
    this.dataDir = dataDir
    this.subprocess = subprocess
    this.xelatexBin = xelatexBin || 'xelatex'
    this.mirrorBaseUrl = mirrorBaseUrl || ''
    this.runtimeDir = path.join(dataDir, 'runtime')
    this.installTask = null
    this.state = {
      installing: false,
      stage: '',
      detail: '',
      percent: 0,
      error: null,
    }
  }

  async detect(configuredBin = this.xelatexBin, signal) {
    const bin = String(configuredBin || 'xelatex').trim()
    const isDefault = bin === 'xelatex' || bin === 'xelatex.exe'

    // 1. 显式绝对路径
    if (bin.includes('/') || bin.includes('\\')) {
      if (await isExecutableFile(bin)) {
        return this.formatStatus(true, bin, 'configured')
      }
      return this.formatStatus(false, null, null)
    }

    // 2. 当前 PATH
    if (this.subprocess?.resolveExecutable) {
      try {
        const resolved = await this.subprocess.resolveExecutable(bin, undefined, signal)
        if (resolved) return this.formatStatus(true, resolved, 'path')
      } catch {}
    }

    // 若用户显式指定了非默认二进制名（如测试降级），不越权回退到其他路径
    if (!isDefault) {
      return this.formatStatus(false, null, null)
    }

    // 3. 插件独立托管的 TinyTeX
    const managed = await this.findInTinyTexRoot(path.join(this.runtimeDir, 'TinyTeX'))
      ?? await this.findInTinyTexRoot(path.join(this.runtimeDir, '.TinyTeX'))
    if (managed) return this.formatStatus(true, managed, 'managed')

    // 4. 常见系统安装位置（避免桌面端未继承最新 PATH 导致误报）
    const systemBin = await findSystemXelatex()
    if (systemBin) return this.formatStatus(true, systemBin, 'system')

    return this.formatStatus(false, null, null)
  }

  formatStatus(available, executable, source) {
    return {
      available,
      executable,
      source,
      installing: this.state.installing,
      stage: this.state.stage,
      detail: this.state.detail,
      percent: this.state.percent,
      error: this.state.error,
    }
  }

  status() {
    return { ...this.state }
  }

  async findInTinyTexRoot(root) {
    const binDir = path.join(root, 'bin')
    const exeName = process.platform === 'win32' ? 'xelatex.exe' : 'xelatex'
    let entries
    try {
      entries = await fs.readdir(binDir, { withFileTypes: true })
    } catch {
      return null
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const candidate = path.join(binDir, entry.name, exeName)
      if (await isExecutableFile(candidate)) return candidate
    }
    return null
  }

  install(options = {}) {
    if (this.installTask) return this.installTask
    if (!this.subprocess) {
      return Promise.reject(new Error('当前环境缺少子进程能力，无法自动安装 LaTeX'))
    }

    // 同步进入安装态，保证 RPC 触发后立刻返回 installing=true 给前端轮询
    this.state = {
      installing: true,
      stage: 'preparing',
      detail: '正在检测并获取轻量 LaTeX（TinyTeX）版本信息…',
      percent: 4,
      error: null,
    }

    const task = this.runInstall(options).finally(() => {
      this.installTask = null
    })
    this.installTask = task
    return task
  }

  async runInstall({ mirrorBaseUrl = this.mirrorBaseUrl, signal } = {}) {
    const tmpDir = path.join(this.runtimeDir, 'tmp')
    try {
      const existing = await this.detect('xelatex', signal)
      if (existing.available) {
        this.state = {
          installing: false,
          stage: 'done',
          detail: 'LaTeX 环境已就绪',
          percent: 100,
          error: null,
        }
        return this.detect('xelatex', signal)
      }
      await fs.mkdir(tmpDir, { recursive: true })
      const asset = await resolveTinyTexAsset(mirrorBaseUrl, signal)
      const archivePath = path.join(tmpDir, asset.name)

      // 步骤 1：流式下载 TinyTeX-1（约 50-70 MB）
      this.state = {
        installing: true,
        stage: 'downloading',
        detail: `正在下载 ${asset.name}…`,
        percent: 8,
        error: null,
      }
      await downloadWithProgress(asset.url, archivePath, (loaded, total) => {
        const mb = (loaded / 1024 / 1024).toFixed(1)
        const pct = total > 0 ? Math.min(58, 8 + Math.round((loaded / total) * 50)) : 28
        const totalStr = total > 0 ? ` / ${(total / 1024 / 1024).toFixed(0)} MB` : ''
        this.state = {
          installing: true,
          stage: 'downloading',
          detail: `正在下载 TinyTeX（${mb}${totalStr}）…`,
          percent: pct,
          error: null,
        }
      }, signal)

      // 步骤 2：静默解压到插件独立目录（<dataDir>/runtime/）
      this.state = {
        installing: true,
        stage: 'extracting',
        detail: '正在解压 LaTeX 排版引擎（无需管理员权限）…',
        percent: 62,
        error: null,
      }
      if (process.platform === 'win32') {
        await runProcess(this.subprocess, [archivePath, '-y', `-o${this.runtimeDir}`], {
          cwd: this.runtimeDir,
          signal,
          timeoutMs: 180_000,
        })
      } else {
        const tarBin = await this.subprocess.resolveExecutable('tar', undefined, signal)
        await runProcess(this.subprocess, [tarBin, '-xf', archivePath, '-C', this.runtimeDir], {
          cwd: this.runtimeDir,
          signal,
          timeoutMs: 180_000,
        })
      }

      const xelatexPath = await this.findInTinyTexRoot(path.join(this.runtimeDir, 'TinyTeX'))
        ?? await this.findInTinyTexRoot(path.join(this.runtimeDir, '.TinyTeX'))
      if (!xelatexPath) {
        throw new Error('TinyTeX 解压完成但未找到 xelatex 可执行文件')
      }

      // 步骤 3：安装中文与试卷宏包（优先国内镜像）
      const binDir = path.dirname(xelatexPath)
      const isWin = process.platform === 'win32'
      const tlmgrPath = path.join(binDir, isWin ? 'tlmgr.bat' : 'tlmgr')
      if (await isExecutableFile(tlmgrPath)) {
        this.state = {
          installing: true,
          stage: 'packages',
          detail: '正在安装中文与试卷排版宏包（约需 1–2 分钟）…',
          percent: 72,
          error: null,
        }
        const env = {
          ...process.env,
          PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
        }
        // Windows 下 Node 20+ 禁止直接 spawn .bat，需通过 cmd.exe /d /c 调用
        const tlmgrArgv = args => (isWin ? [process.env.ComSpec || 'cmd.exe', '/d', '/c', tlmgrPath, ...args] : [tlmgrPath, ...args])
        const repo = await pickReachableCtanMirror(signal)
        if (repo) {
          await runProcess(this.subprocess, tlmgrArgv(['option', 'repository', repo]), {
            cwd: binDir, env, signal, timeoutMs: 30_000, check: false,
          })
        }
        const installRes = await runProcess(this.subprocess, tlmgrArgv(['install', ...REQUIRED_TEX_PACKAGES]), {
          cwd: binDir, env, signal, timeoutMs: 420_000, check: false,
        })
        if (installRes.exitCode !== 0) {
          if (repo) {
            // 镜像失败时切回默认 CTAN 重试一次
            await runProcess(this.subprocess, tlmgrArgv(['option', 'repository', 'ctan']), {
              cwd: binDir, env, signal, timeoutMs: 30_000, check: false,
            })
            const retry = await runProcess(this.subprocess, tlmgrArgv(['install', ...REQUIRED_TEX_PACKAGES]), {
              cwd: binDir, env, signal, timeoutMs: 420_000, check: false,
            })
            if (retry.exitCode !== 0) {
              throw new Error(`宏包安装未完全成功，请稍后重试（${(retry.stderr || retry.stdout).trim().slice(-240)}）`)
            }
          } else {
            throw new Error(`宏包安装未完全成功，请稍后重试（${(installRes.stderr || installRes.stdout).trim().slice(-240)}）`)
          }
        }
      }

      // 步骤 4：清理压缩包并复检
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
      this.state = {
        installing: false,
        stage: 'done',
        detail: 'LaTeX 环境已就绪',
        percent: 100,
        error: null,
      }
      return this.detect('xelatex', signal)
    } catch (error) {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
      const message = error instanceof Error ? error.message : String(error)
      this.state = {
        installing: false,
        stage: 'error',
        detail: '',
        percent: 0,
        error: message,
      }
      throw error
    }
  }
}

async function resolveTinyTexAsset(mirrorBaseUrl, signal) {
  let tag = FALLBACK_TINYTEX_TAG
  try {
    const res = await fetch('https://api.github.com/repos/rstudio/tinytex-releases/releases/latest', {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'dsh-study' },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8_000)]) : AbortSignal.timeout(8_000),
    })
    if (res.ok) {
      const json = await res.json()
      if (typeof json?.tag_name === 'string' && /^v\d{4}\.\d{2}/.test(json.tag_name)) {
        tag = json.tag_name
      }
    }
  } catch {}

  let name
  if (process.platform === 'win32') {
    name = `TinyTeX-1-windows-${tag}.exe`
  } else if (process.platform === 'darwin') {
    name = `TinyTeX-1-darwin-${tag}.tar.xz`
  } else {
    const arch = process.arch === 'arm64' ? 'arm64' : 'x86_64'
    name = `TinyTeX-1-linux-${arch}-${tag}.tar.xz`
  }
  const rawUrl = `https://github.com/rstudio/tinytex-releases/releases/download/${tag}/${name}`
  const url = mirrorBaseUrl ? `${mirrorBaseUrl.replace(/\/+$/, '')}/${rawUrl}` : rawUrl
  return { tag, name, url }
}

async function downloadWithProgress(url, destination, onProgress, signal) {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': 'dsh-study' },
    signal,
  })
  if (!res.ok || !res.body) {
    throw new Error(`下载 TinyTeX 失败（HTTP ${res.status}），请检查网络连接`)
  }
  const total = Number(res.headers.get('content-length') || 0)
  let loaded = 0
  let lastEmit = 0
  const readable = Readable.fromWeb(res.body)
  readable.on('data', chunk => {
    loaded += chunk.length
    const now = Date.now()
    if (now - lastEmit > 250 || (total > 0 && loaded >= total)) {
      lastEmit = now
      onProgress(loaded, total)
    }
  })
  await pipeline(readable, createWriteStream(destination))
}

async function pickReachableCtanMirror(signal) {
  for (const url of CTAN_MIRRORS) {
    try {
      const res = await fetch(`${url}/tlpkg/texlive.tlpdb.sha512`, {
        method: 'HEAD',
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(4_000)]) : AbortSignal.timeout(4_000),
      })
      if (res.ok) return url
    } catch {}
  }
  return null
}

async function findSystemXelatex() {
  const home = os.homedir()
  const candidates = []

  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming')
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local')
    candidates.push(
      path.join(appData, 'TinyTeX', 'bin', 'windows', 'xelatex.exe'),
      path.join(appData, 'TinyTeX', 'bin', 'win32', 'xelatex.exe'),
    )
    // 扫描常见盘符下的 TeX Live（优先最新年份）
    for (const drive of ['C:', 'D:', 'E:', 'F:']) {
      const tlRoot = path.join(drive, path.sep, 'texlive')
      try {
        const years = (await fs.readdir(tlRoot)).filter(n => /^20\d{2}$/.test(n)).sort().reverse()
        for (const y of years) {
          candidates.push(
            path.join(tlRoot, y, 'bin', 'windows', 'xelatex.exe'),
            path.join(tlRoot, y, 'bin', 'win32', 'xelatex.exe'),
          )
        }
      } catch {}
    }
    candidates.push(
      path.join(localAppData, 'Programs', 'MiKTeX', 'miktex', 'bin', 'x64', 'xelatex.exe'),
      path.join('C:', path.sep, 'Program Files', 'MiKTeX', 'miktex', 'bin', 'x64', 'xelatex.exe'),
    )
  } else if (process.platform === 'darwin') {
    candidates.push(
      path.join(home, 'Library', 'TinyTeX', 'bin', 'universal-darwin', 'xelatex'),
      '/Library/TeX/texbin/xelatex',
    )
    try {
      const years = (await fs.readdir('/usr/local/texlive')).filter(n => /^20\d{2}$/.test(n)).sort().reverse()
      for (const y of years) {
        candidates.push(`/usr/local/texlive/${y}/bin/universal-darwin/xelatex`)
      }
    } catch {}
  } else {
    candidates.push(
      path.join(home, '.TinyTeX', 'bin', 'x86_64-linux', 'xelatex'),
      path.join(home, '.TinyTeX', 'bin', 'aarch64-linux', 'xelatex'),
      '/usr/bin/xelatex',
      '/usr/local/bin/xelatex',
    )
  }

  for (const candidate of candidates) {
    if (await isExecutableFile(candidate)) return candidate
  }
  return null
}

async function isExecutableFile(filePath) {
  try {
    const stat = await fs.stat(filePath)
    return stat.isFile()
  } catch {
    return false
  }
}
