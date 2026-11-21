const NS = 'dsh-study'
const PANEL_ID = 'dsh-study'
const TABS = [
  ['quick', '快速出卷'],
  ['bank', '题库与错题'],
  ['sources', '题库管理'],
]
export const inject = ['connection', 'locale', 'slots', 'sidebarRight', 'sidebarRightTabs', 'uiWorkspace']

const TYPE_LABEL = { single: '单选题', multi: '多选题', blank: '填空题', solve: '解答题', proof: '证明题' }
const ORIGIN_LABEL = { official: '官方标答', community: '社区详解', ai: 'AI 推导' }
const STATUS_LABEL = { unmastered: '未掌握', reviewing: '复习中', mastered: '已掌握' }
const TRANSPORT_LABEL = { 'local-dir': '本机文件夹', 'github-raw': 'GitHub 仓库', 'http-manifest': '网络题库地址', git: 'Git 仓库', personal: '个人错题库' }
const TEMPLATE_LABEL = { 'ustc-exam': '中科大标准考试卷', gaokao: '高考标准考试卷', 'review-classic': '经典讲评 PPT' }
const PDF_MODE_LABEL = { 'inline-solution': '题目后附解析', split: '原题与答案分开' }
const REVIEW_ACTIONS = [
  ['again', '再练一次'],
  ['hard', '有点难'],
  ['good', '已掌握'],
  ['easy', '很简单'],
]
const ERROR_TAG_PRESETS = ['概念', '计算', '方法', '证明', '审题', '粗心']
const COUNT_PRESETS = [5, 8, 10, 15]

const STYLE = `
.dsh-study{
  --s-bg:var(--dsw-alias-background-primary,#fff);
  --s-surface:var(--dsw-alias-background-secondary,#f7f7f8);
  --s-hover:var(--dsw-alias-background-tertiary,#efefef);
  --s-border:var(--dsw-alias-border-primary,#e5e7eb);
  --s-text:var(--dsw-alias-label-primary,#111827);
  --s-muted:var(--dsw-alias-label-secondary,#6b7280);
  --s-brand:var(--dsw-alias-brand-primary,#2563eb);
  --s-on-brand:var(--dsw-alias-label-on-brand,#fff);
  --s-danger:var(--dsw-alias-label-danger,#c01c28);
  --s-ok:var(--dsw-alias-state-success-primary,#15803d);
  color:var(--s-text);background:var(--s-bg);height:100%;min-height:0;
  display:flex;flex-direction:column;font-size:13.5px;line-height:1.55;
}
.dsh-study *{box-sizing:border-box}
.dsh-study .katex-mathml{position:absolute;clip:rect(1px,1px,1px,1px);padding:0;border:0;height:1px;width:1px;overflow:hidden}
.dsh-study .katex-display{margin:10px 0;overflow-x:auto;overflow-y:hidden}
.dsh-study button,.dsh-study input,.dsh-study select,.dsh-study textarea{font:inherit;color:inherit}
.dsh-study button{cursor:pointer;transition:background .12s,border-color .12s,opacity .12s}
.dsh-study button:disabled{cursor:not-allowed;opacity:.45}

.dsh-study-head{
  height:52px;padding:0 24px;border-bottom:1px solid var(--s-border);
  display:flex;align-items:center;justify-content:space-between;gap:20px;flex-shrink:0;
}
.dsh-study-head-left{display:flex;align-items:center;gap:24px;height:100%}
.dsh-study-title{font-size:15px;font-weight:600;margin:0;letter-spacing:.01em}
.dsh-study-tabs{display:flex;align-items:stretch;height:100%;gap:6px}
.dsh-study-tab{
  border:0;background:transparent;padding:0 12px;color:var(--s-muted);
  border-bottom:2px solid transparent;font-weight:500;
}
.dsh-study-tab:hover{color:var(--s-text)}
.dsh-study-tab[aria-selected=true]{color:var(--s-text);border-bottom-color:var(--s-brand);font-weight:600}

.dsh-study-body{flex:1;min-height:0;overflow:auto;padding:22px 24px}
.dsh-study-split{
  display:grid;grid-template-columns:340px minmax(0,1fr);gap:24px;
  height:100%;min-height:0;align-items:start;
}
.dsh-study-col{display:flex;flex-direction:column;gap:18px;min-width:0}
.dsh-study-preview-pane{
  display:flex;flex-direction:column;gap:12px;min-width:0;min-height:540px;height:calc(100vh - 118px);
}

.dsh-study-seg{
  display:inline-flex;padding:3px;border-radius:8px;background:var(--s-surface);
  border:1px solid var(--s-border);gap:2px;width:100%;
}
.dsh-study-seg.auto{width:auto}
.dsh-study-seg button{
  flex:1;border:0;background:transparent;padding:6px 12px;border-radius:6px;
  color:var(--s-muted);font-weight:500;white-space:nowrap;
}
.dsh-study-seg button[aria-pressed=true]{
  background:var(--s-bg);color:var(--s-text);font-weight:600;
  box-shadow:0 1px 2px rgba(0,0,0,.06);
}

.dsh-study-group{display:flex;flex-direction:column;gap:8px}
.dsh-study-group-label{font-size:12px;font-weight:600;color:var(--s-muted)}
.dsh-study-pills{display:flex;flex-wrap:wrap;gap:7px}
.dsh-study-pill{
  border:1px solid var(--s-border);background:var(--s-bg);color:var(--s-text);
  padding:5px 11px;border-radius:999px;font-size:12.5px;
}
.dsh-study-pill:hover{background:var(--s-surface)}
.dsh-study-pill[aria-pressed=true]{
  border-color:var(--s-brand);background:var(--s-brand);color:var(--s-on-brand);font-weight:500;
}

.dsh-study-btn{
  display:inline-flex;align-items:center;justify-content:center;gap:6px;
  height:36px;padding:0 14px;border:1px solid var(--s-border);
  background:var(--s-bg);border-radius:7px;font-weight:500;white-space:nowrap;
}
.dsh-study-btn:hover{background:var(--s-surface)}
.dsh-study-btn.primary{
  background:var(--s-brand);border-color:var(--s-brand);color:var(--s-on-brand);
}
.dsh-study-btn.primary:hover{opacity:.92}
.dsh-study-btn.sm{height:30px;padding:0 10px;font-size:12.5px}
.dsh-study-btn.ghost{border-color:transparent;background:transparent;color:var(--s-muted)}
.dsh-study-btn.ghost:hover{background:var(--s-surface);color:var(--s-text)}
.dsh-study-btn.danger{color:var(--s-danger)}

.dsh-study-input,.dsh-study-textarea{
  width:100%;border:1px solid var(--s-border);border-radius:8px;
  background:var(--s-bg);padding:7px 10px;min-width:0;outline:none;
}
.dsh-study-input:focus,.dsh-study-textarea:focus{border-color:var(--s-brand)}
.dsh-study-input{height:35px}
.dsh-study-textarea{resize:vertical;min-height:74px;line-height:1.6}

/* ---- 自定义下拉选择与知识点树形多选 ---- */
.dsh-study-dd{position:relative;width:100%;min-width:0}
.dsh-study-dd-trigger{
  width:100%;min-height:35px;padding:4px 9px 4px 10px;border:1px solid var(--s-border);
  border-radius:8px;background:var(--s-bg);color:var(--s-text);
  display:flex;align-items:center;justify-content:space-between;gap:8px;text-align:left;
  transition:border-color .14s,box-shadow .14s,background .14s;
}
.dsh-study-dd-trigger:hover{border-color:color-mix(in srgb,var(--s-text) 28%,var(--s-border))}
.dsh-study-dd-trigger[aria-expanded=true]{
  border-color:var(--s-brand);
  box-shadow:0 0 0 2px color-mix(in srgb,var(--s-brand) 14%,transparent);
}
.dsh-study-dd-val{
  flex:1;min-width:0;display:flex;align-items:center;flex-wrap:wrap;gap:4px;
  overflow:hidden;
}
.dsh-study-dd-single-text{
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:13px;
}
.dsh-study-dd-placeholder{color:var(--s-muted);font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsh-study-dd-actions{display:inline-flex;align-items:center;gap:2px;flex-shrink:0;color:var(--s-muted)}
.dsh-study-dd-clear{
  width:18px;height:18px;border:0;border-radius:4px;background:transparent;color:var(--s-muted);
  display:inline-grid;place-items:center;padding:0;
}
.dsh-study-dd-clear:hover{background:var(--s-hover);color:var(--s-text)}
.dsh-study-dd-chev{transition:transform .16s ease;flex-shrink:0}
.dsh-study-dd-trigger[aria-expanded=true] .dsh-study-dd-chev{transform:rotate(180deg)}

.dsh-study-chip{
  display:inline-flex;align-items:center;gap:4px;max-width:170px;
  padding:1px 6px 1px 7px;border-radius:6px;font-size:12px;line-height:1.45;
  background:color-mix(in srgb,var(--s-brand) 10%,var(--s-bg));
  border:1px solid color-mix(in srgb,var(--s-brand) 24%,transparent);
  color:var(--s-text);
}
.dsh-study-chip span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-study-chip-x{
  border:0;background:transparent;padding:0;width:14px;height:14px;border-radius:3px;
  display:inline-grid;place-items:center;color:var(--s-muted);flex-shrink:0;
}
.dsh-study-chip-x:hover{background:rgba(0,0,0,.08);color:var(--s-text)}
.dsh-study-chip-more{
  display:inline-flex;align-items:center;padding:1px 6px;border-radius:6px;font-size:11.5px;
  background:var(--s-surface);border:1px solid var(--s-border);color:var(--s-muted);
}

.dsh-study-dd-menu{
  position:absolute;top:calc(100% + 5px);left:0;z-index:300;
  min-width:100%;max-width:min(420px,85vw);
  border-radius:10px;border:1px solid var(--s-border);background:var(--s-bg);
  box-shadow:0 12px 32px rgba(0,0,0,.13),0 2px 6px rgba(0,0,0,.05);
  overflow:hidden;display:flex;flex-direction:column;
}
.dsh-study-dd-menu.wide{min-width:max(100%,310px)}
.dsh-study-dd-menu.align-right{left:auto;right:0}
.dsh-study-dd-search{
  display:flex;align-items:center;gap:7px;padding:7px 10px;
  border-bottom:1px solid var(--s-border);background:var(--s-bg);color:var(--s-muted);
}
.dsh-study-dd-search input{
  flex:1;min-width:0;border:0;background:transparent;outline:none;font-size:12.5px;color:var(--s-text);
}
.dsh-study-dd-list{
  max-height:268px;overflow-y:auto;padding:5px;display:flex;flex-direction:column;gap:1px;
}
.dsh-study-dd-opt{
  width:100%;border:0;background:transparent;text-align:left;
  padding:6px 8px;border-radius:7px;display:flex;align-items:center;gap:8px;
  font-size:13px;line-height:1.4;color:var(--s-text);
}
.dsh-study-dd-opt:hover{background:var(--s-surface)}
.dsh-study-dd-opt[data-selected=true]{
  background:color-mix(in srgb,var(--s-brand) 8%,transparent);
}
.dsh-study-dd-opt.chapter{font-weight:600;padding-top:6px;padding-bottom:6px}
.dsh-study-dd-opt-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-study-dd-fold{
  width:18px;height:18px;border:0;background:transparent;padding:0;border-radius:4px;
  display:inline-grid;place-items:center;color:var(--s-muted);flex-shrink:0;
}
.dsh-study-dd-fold:hover{background:var(--s-hover);color:var(--s-text)}
.dsh-study-dd-check{
  width:15px;height:15px;border-radius:4px;flex-shrink:0;
  border:1.5px solid color-mix(in srgb,var(--s-text) 25%,var(--s-border));
  background:var(--s-bg);display:inline-grid;place-items:center;
  transition:background .12s,border-color .12s;
}
.dsh-study-dd-check[data-state=checked],
.dsh-study-dd-check[data-state=indeterminate]{
  background:var(--s-brand);border-color:var(--s-brand);color:var(--s-on-brand);
}
.dsh-study-dd-count{
  font-size:11.5px;color:var(--s-muted);flex-shrink:0;font-variant-numeric:tabular-nums;
}
.dsh-study-dd-empty{padding:18px 10px;text-align:center;color:var(--s-muted);font-size:12.5px}
.dsh-study-dd-foot{
  display:flex;align-items:center;justify-content:space-between;gap:8px;
  padding:7px 10px;border-top:1px solid var(--s-border);background:var(--s-surface);
  font-size:12px;color:var(--s-muted);
}

.dsh-study-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dsh-study-between{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.dsh-study-stack{display:flex;flex-direction:column;gap:10px}
.dsh-study-grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px}

.dsh-study-box{
  border:1px solid var(--s-border);border-radius:10px;padding:14px 16px;background:var(--s-bg);
}
.dsh-study-soft{
  border:1px solid var(--s-border);border-radius:10px;padding:12px 14px;background:var(--s-surface);
}
.dsh-study-banner{
  padding:10px 14px;border-radius:8px;font-size:13px;margin-bottom:14px;
  display:flex;align-items:center;justify-content:space-between;gap:12px;
}
.dsh-study-banner.err{background:rgba(192,28,40,.08);color:var(--s-danger);border:1px solid rgba(192,28,40,.2)}
.dsh-study-banner.info{background:var(--s-surface);color:var(--s-text);border:1px solid var(--s-border)}
.dsh-study-banner.ok{background:rgba(21,128,61,.08);color:var(--s-ok);border:1px solid rgba(21,128,61,.2)}
.dsh-study-progress{height:4px;border-radius:999px;background:var(--s-border);overflow:hidden;width:100%}
.dsh-study-progress-fill{height:100%;background:var(--s-brand);transition:width .25s ease}

.dsh-study-frame{
  width:100%;flex:1;min-height:460px;border:1px solid var(--s-border);
  border-radius:10px;background:#fff;
}
.dsh-study-slide-stage{
  flex:1;min-height:380px;border:1px solid var(--s-border);border-radius:10px;
  background:var(--s-surface);display:flex;align-items:center;justify-content:center;
  padding:12px;overflow:hidden;
}
.dsh-study-slide-stage img{
  max-width:100%;max-height:100%;border-radius:6px;
  box-shadow:0 2px 12px rgba(0,0,0,.08);background:#fff;
}
.dsh-study-thumbs{
  display:flex;gap:8px;overflow-x:auto;padding:4px 2px;flex-shrink:0;
}
.dsh-study-thumb{
  border:2px solid var(--s-border);border-radius:6px;padding:0;background:#fff;
  width:118px;flex-shrink:0;overflow:hidden;
}
.dsh-study-thumb[aria-current=true]{border-color:var(--s-brand)}
.dsh-study-thumb img{display:block;width:100%;aspect-ratio:16/9;object-fit:cover}
.dsh-study-thumb span{
  display:block;font-size:11px;padding:3px 5px;color:var(--s-muted);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:left;
}

.dsh-study-q{
  padding:16px 0;border-bottom:1px solid var(--s-border);
}
.dsh-study-q:last-child{border-bottom:0}
.dsh-study-rich{line-height:1.85;overflow-wrap:anywhere;word-break:break-word}
.dsh-study-tag{
  display:inline-flex;align-items:center;padding:2px 8px;border-radius:999px;
  background:var(--s-surface);color:var(--s-muted);font-size:11.5px;border:1px solid var(--s-border);
}
.dsh-study-tag.accent{color:var(--s-brand);border-color:rgba(37,99,235,.25);background:rgba(37,99,235,.06)}
.dsh-study-tag.warn{color:var(--s-danger);border-color:rgba(192,28,40,.25);background:rgba(192,28,40,.06)}
.dsh-study-tag.ok{color:var(--s-ok);border-color:rgba(21,128,61,.25);background:rgba(21,128,61,.06)}

.dsh-study-empty{
  padding:42px 20px;text-align:center;color:var(--s-muted);
  border:1px dashed var(--s-border);border-radius:10px;display:flex;flex-direction:column;
  align-items:center;gap:12px;
}
.dsh-study-stats{
  display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-bottom:16px;
}
.dsh-study-stat{
  border:1px solid var(--s-border);border-radius:10px;padding:12px 16px;background:var(--s-surface);
}
.dsh-study-stat span{display:block;font-size:12px;color:var(--s-muted)}
.dsh-study-stat strong{display:block;font-size:22px;font-weight:600;margin-top:2px}

.dsh-study-table-wrap{overflow:auto;border:1px solid var(--s-border);border-radius:10px}
.dsh-study-table{width:100%;border-collapse:collapse}
.dsh-study-table th,.dsh-study-table td{
  padding:10px 14px;text-align:left;border-bottom:1px solid var(--s-border);vertical-align:middle;
}
.dsh-study-table th{font-size:12px;font-weight:600;color:var(--s-muted);background:var(--s-surface)}
.dsh-study-table tr:last-child td{border-bottom:0}

.dsh-study-modal-bg{
  position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:9999;
  display:grid;place-items:center;padding:20px;
}
.dsh-study-modal{
  width:min(600px,100%);max-height:88vh;overflow:auto;background:var(--s-bg);
  border:1px solid var(--s-border);border-radius:12px;padding:20px 22px;
  display:flex;flex-direction:column;gap:14px;box-shadow:0 12px 40px rgba(0,0,0,.18);
}
.dsh-study-basket-bar{
  position:sticky;bottom:0;background:var(--s-bg);border:1px solid var(--s-brand);
  border-radius:10px;padding:10px 14px;margin-top:14px;
  display:flex;align-items:center;justify-content:space-between;gap:12px;
  box-shadow:0 4px 16px rgba(0,0,0,.08);
}
.dsh-study-order-row{
  display:grid;grid-template-columns:auto minmax(0,1fr) 72px;gap:8px;align-items:center;
  padding:7px 0;border-bottom:1px solid var(--s-border);font-size:12.5px;
}
.dsh-study-order-row:last-child{border-bottom:0}
.dsh-study-icon-btn{
  border:0;background:transparent;width:26px;height:26px;border-radius:6px;
  display:inline-grid;place-items:center;color:var(--s-muted);
}
.dsh-study-icon-btn:hover{background:var(--s-hover);color:var(--s-text)}

.dsh-study-drawer{padding:14px;display:flex;flex-direction:column;gap:12px}
.dsh-study-settings{padding:20px 24px;max-width:620px;display:flex;flex-direction:column;gap:16px}
.dsh-study-muted{color:var(--s-muted);font-size:12.5px}
.dsh-study-details summary{cursor:pointer;color:var(--s-muted);font-size:12.5px;user-select:none}
.dsh-study-details summary:hover{color:var(--s-text)}

@media(max-width:920px){
  .dsh-study-split{grid-template-columns:1fr}
  .dsh-study-preview-pane{height:auto;min-height:460px}
}
`

export function apply(ctx) {
  const React = require('react')
  const { createElement: h, useCallback, useEffect, useMemo, useRef, useState } = React
  const Icon = require('lucide-react')
  const katex = require('katex')

  const unwrap = result => {
    if (result && typeof result === 'object' && 'ok' in result) {
      if (!result.ok) {
        const error = result.error ?? {}
        const failure = new Error(friendlyError(error.message ?? '请求失败，请稍后重试'))
        failure.code = error.code
        throw failure
      }
      return result.value
    }
    return result
  }

  const rpc = async (context, endpoint, payload = {}, signal) => {
    const remote = (() => {
      try { return context.get?.('remote')?.dshStudy ?? context.remote?.dshStudy } catch { return null }
    })()
    if (typeof remote?.call === 'function') return unwrap(await remote.call({ endpoint, payload }, signal))
    return unwrap(await context.connection.rpc.call(
      '/api', 'dshStudy/call', { args: { endpoint, payload } }, signal))
  }

  function fileUrl(relPath, download = false) {
    if (!relPath) return ''
    return `/api/dsh-study/file?path=${encodeURIComponent(String(relPath))}${download ? '&download=1' : ''}`
  }

  function RichMath({ text }) {
    const html = useMemo(() => {
      const parts = String(text ?? '').split(/(\$\$[\s\S]+?\$\$|\$[^$\n]+\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\))/g)
      return parts.map(part => {
        if ((part.startsWith('$') && part.endsWith('$')) || part.startsWith('\\[') || part.startsWith('\\(')) {
          const display = part.startsWith('$$') || part.startsWith('\\[')
          const math = part.replace(/^\$\$?|^\$|\$\$?$|^\\\[|\\\]$|^\\\(|\\\)$/g, '')
          try {
            return katex.renderToString(math, { displayMode: display, throwOnError: false, trust: false })
          } catch {
            return escapeHtml(math)
          }
        }
        return escapeHtml(part)
          .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
          .replace(/\n/g, '<br>')
      }).join('')
    }, [text])
    return h('div', { className: 'dsh-study-rich', dangerouslySetInnerHTML: { __html: html } })
  }

  function useOutsideClose(ref, open, onClose) {
    useEffect(() => {
      if (!open) return
      const onPointerDown = event => {
        if (ref.current && event.target instanceof Node && ref.current.contains(event.target)) return
        onClose()
      }
      const onKeyDown = event => {
        if (event.key === 'Escape') onClose()
      }
      document.addEventListener('pointerdown', onPointerDown, true)
      document.addEventListener('keydown', onKeyDown)
      return () => {
        document.removeEventListener('pointerdown', onPointerDown, true)
        document.removeEventListener('keydown', onKeyDown)
      }
    }, [ref, open, onClose])
  }

  // 自定义单选下拉（替换所有原生 <select>，选项较多时自动带搜索与数量提示）
  function NiceSelect({ value, options = [], placeholder = '请选择', onChange, style, align = 'left', searchable, searchPlaceholder = '搜索…', wide = false }) {
    const [open, setOpen] = useState(false)
    const [search, setSearch] = useState('')
    const rootRef = useRef(null)
    const inputRef = useRef(null)
    useOutsideClose(rootRef, open, () => setOpen(false))

    const showSearch = searchable ?? options.length >= 6
    useEffect(() => {
      if (open && showSearch) setTimeout(() => inputRef.current?.focus(), 0)
      if (!open) setSearch('')
    }, [open, showSearch])

    const filtered = useMemo(() => {
      const q = search.trim().toLowerCase()
      if (!q) return options
      return options.filter(opt => `${opt.label ?? ''} ${opt.meta ?? ''}`.toLowerCase().includes(q))
    }, [options, search])

    const current = options.find(opt => opt.value === value)
    return h('div', { className: 'dsh-study-dd', ref: rootRef, style },
      h('button', {
        type: 'button',
        className: 'dsh-study-dd-trigger',
        'aria-haspopup': 'listbox',
        'aria-expanded': open,
        onClick: () => setOpen(v => !v),
      },
      h('span', { className: 'dsh-study-dd-val' },
        current
          ? h('span', { className: 'dsh-study-dd-single-text', title: current.label }, current.label)
          : h('span', { className: 'dsh-study-dd-placeholder' }, placeholder)),
      h('span', { className: 'dsh-study-dd-actions' },
        h(Icon.ChevronDown, { size: 15, className: 'dsh-study-dd-chev' }))),
      open ? h('div', { className: `dsh-study-dd-menu${wide ? ' wide' : ''}${align === 'right' ? ' align-right' : ''}`, role: 'listbox' },
        showSearch ? h('div', { className: 'dsh-study-dd-search' },
          h(Icon.Search, { size: 14 }),
          h('input', {
            ref: inputRef,
            placeholder: searchPlaceholder,
            value: search,
            onChange: e => setSearch(e.target.value),
          }),
          search
            ? h('button', { type: 'button', className: 'dsh-study-dd-clear', onClick: () => setSearch('') }, h(Icon.X, { size: 12 }))
            : null) : null,
        h('div', { className: 'dsh-study-dd-list' },
          filtered.length
            ? filtered.map(opt => {
              const active = opt.value === value
              return h('button', {
                key: String(opt.value),
                type: 'button',
                role: 'option',
                'aria-selected': active,
                'data-selected': active ? 'true' : 'false',
                className: 'dsh-study-dd-opt',
                onClick: () => {
                  onChange(opt.value)
                  setOpen(false)
                },
              },
              h('span', { className: 'dsh-study-dd-opt-label', title: opt.label }, opt.label),
              opt.meta ? h('span', { className: 'dsh-study-dd-count' }, opt.meta) : null,
              active ? h(Icon.Check, { size: 14, style: { color: 'var(--s-brand)', flexShrink: 0 } }) : null)
            })
            : h('div', { className: 'dsh-study-dd-empty' }, '没有匹配项'))) : null)
  }

  // 自定义多选下拉（用于课程多选等扁平列表，科目再多也保持单行紧凑）
  function MultiSelect({ options = [], value = [], onChange, placeholder = '请选择', searchPlaceholder = '搜索课程…', style, align = 'left' }) {
    const [open, setOpen] = useState(false)
    const [search, setSearch] = useState('')
    const rootRef = useRef(null)
    const inputRef = useRef(null)
    useOutsideClose(rootRef, open, () => setOpen(false))

    const showSearch = options.length >= 5
    useEffect(() => {
      if (open && showSearch) setTimeout(() => inputRef.current?.focus(), 0)
      if (!open) setSearch('')
    }, [open, showSearch])

    const selectedSet = useMemo(() => new Set(value), [value])
    const selectedOptions = useMemo(() => options.filter(o => selectedSet.has(o.value)), [options, selectedSet])
    const filtered = useMemo(() => {
      const q = search.trim().toLowerCase()
      if (!q) return options
      return options.filter(o => `${o.label ?? ''} ${o.meta ?? ''}`.toLowerCase().includes(q))
    }, [options, search])

    const allVisibleSelected = filtered.length > 0 && filtered.every(o => selectedSet.has(o.value))

    const toggle = val => {
      const next = new Set(selectedSet)
      if (next.has(val)) next.delete(val)
      else next.add(val)
      onChange([...next])
    }

    const toggleSelectAll = () => {
      const next = new Set(selectedSet)
      if (allVisibleSelected) {
        for (const o of filtered) next.delete(o.value)
      } else {
        for (const o of filtered) next.add(o.value)
      }
      onChange([...next])
    }

    const maxChips = 2
    return h('div', { className: 'dsh-study-dd', ref: rootRef, style },
      h('button', {
        type: 'button',
        className: 'dsh-study-dd-trigger',
        'aria-haspopup': 'listbox',
        'aria-expanded': open,
        onClick: () => setOpen(v => !v),
      },
      h('span', { className: 'dsh-study-dd-val' },
        selectedOptions.length
          ? h(React.Fragment, null,
            selectedOptions.slice(0, maxChips).map(opt => h('span', { key: opt.value, className: 'dsh-study-chip' },
              h('span', { title: opt.label }, opt.label),
              h('span', {
                role: 'button',
                tabIndex: -1,
                className: 'dsh-study-chip-x',
                title: `移除 ${opt.label}`,
                onClick: e => {
                  e.stopPropagation()
                  toggle(opt.value)
                },
              }, h(Icon.X, { size: 11 })))),
            selectedOptions.length > maxChips
              ? h('span', { className: 'dsh-study-chip-more' }, `+${selectedOptions.length - maxChips}`)
              : null)
          : h('span', { className: 'dsh-study-dd-placeholder' }, placeholder)),
      h('span', { className: 'dsh-study-dd-actions' },
        selectedOptions.length
          ? h('span', {
            role: 'button',
            tabIndex: -1,
            className: 'dsh-study-dd-clear',
            title: '清空',
            onClick: e => {
              e.stopPropagation()
              onChange([])
            },
          }, h(Icon.X, { size: 13 }))
          : null,
        h(Icon.ChevronDown, { size: 15, className: 'dsh-study-dd-chev' }))),

      open ? h('div', { className: `dsh-study-dd-menu${align === 'right' ? ' align-right' : ''}`, role: 'listbox', 'aria-multiselectable': 'true' },
        showSearch ? h('div', { className: 'dsh-study-dd-search' },
          h(Icon.Search, { size: 14 }),
          h('input', {
            ref: inputRef,
            placeholder: searchPlaceholder,
            value: search,
            onChange: e => setSearch(e.target.value),
          }),
          search
            ? h('button', { type: 'button', className: 'dsh-study-dd-clear', onClick: () => setSearch('') }, h(Icon.X, { size: 12 }))
            : null) : null,
        h('div', { className: 'dsh-study-dd-list' },
          filtered.length
            ? filtered.map(opt => {
              const checked = selectedSet.has(opt.value)
              return h('div', {
                key: String(opt.value),
                role: 'option',
                'aria-selected': checked,
                'data-selected': checked ? 'true' : 'false',
                className: 'dsh-study-dd-opt',
                onClick: () => toggle(opt.value),
              },
              h('span', { className: 'dsh-study-dd-check', 'data-state': checked ? 'checked' : 'unchecked' },
                checked ? h(Icon.Check, { size: 11, strokeWidth: 2.8 }) : null),
              h('span', { className: 'dsh-study-dd-opt-label', title: opt.label }, opt.label),
              opt.meta ? h('span', { className: 'dsh-study-dd-count' }, opt.meta) : null)
            })
            : h('div', { className: 'dsh-study-dd-empty' }, '没有匹配的课程')),
        h('div', { className: 'dsh-study-dd-foot' },
          h('button', {
            type: 'button', className: 'dsh-study-btn sm ghost', style: { height: 26, padding: '0 8px' },
            disabled: !filtered.length,
            onClick: toggleSelectAll,
          }, allVisibleSelected ? '取消全选' : '全选'),
          h('div', { className: 'dsh-study-row', style: { gap: 6 } },
            selectedOptions.length
              ? h('button', {
                type: 'button', className: 'dsh-study-btn sm ghost', style: { height: 26, padding: '0 8px' },
                onClick: () => onChange([]),
              }, '清空')
              : null,
            h('button', {
              type: 'button', className: 'dsh-study-btn sm primary', style: { height: 26, padding: '0 10px' },
              onClick: () => setOpen(false),
            }, '完成')))) : null)
  }

  // 自定义树形知识点多选器（支持搜索、章节折叠、整章联动多选、标签直删与题量提示）
  function KpMultiSelect({ nodes = [], value = [], onChange, placeholder = '全部知识点', style, align = 'left' }) {
    const [open, setOpen] = useState(false)
    const [search, setSearch] = useState('')
    const [collapsed, setCollapsed] = useState(() => new Set())
    const rootRef = useRef(null)
    const inputRef = useRef(null)
    useOutsideClose(rootRef, open, () => setOpen(false))

    useEffect(() => {
      if (open) {
        setTimeout(() => inputRef.current?.focus(), 0)
      } else {
        setSearch('')
      }
    }, [open])

    // 将扁平 taxonomy 构建为按章节嵌套的有序树
    const tree = useMemo(() => {
      const byId = new Map()
      const childrenOf = new Map()
      const unique = []
      for (const n of nodes) {
        if (byId.has(n.kp_id)) continue
        byId.set(n.kp_id, n)
        unique.push(n)
      }
      const roots = []
      for (const n of unique) {
        const pid = n.parent_id && byId.has(n.parent_id) ? n.parent_id : ''
        if (!pid) {
          roots.push(n)
        } else {
          const list = childrenOf.get(pid) ?? []
          list.push(n)
          childrenOf.set(pid, list)
        }
      }
      const descMap = new Map()
      const parentMap = new Map()
      const collectDesc = id => {
        if (descMap.has(id)) return descMap.get(id)
        const kids = childrenOf.get(id) ?? []
        const all = []
        for (const kid of kids) {
          parentMap.set(kid.kp_id, id)
          all.push(kid.kp_id, ...collectDesc(kid.kp_id))
        }
        descMap.set(id, all)
        return all
      }
      for (const r of roots) collectDesc(r.kp_id)
      const flat = []
      const walk = (node, depth) => {
        const kids = childrenOf.get(node.kp_id) ?? []
        flat.push({ node, depth, hasChildren: kids.length > 0 })
        for (const kid of kids) walk(kid, depth + 1)
      }
      for (const r of roots) walk(r, 0)
      return { byId, childrenOf, descMap, parentMap, flat, roots }
    }, [nodes])

    const selectedSet = useMemo(() => new Set(value), [value])

    const nodeState = useCallback(id => {
      const desc = tree.descMap.get(id) ?? []
      if (!desc.length) return selectedSet.has(id) ? 'checked' : 'unchecked'
      const checkedDesc = desc.filter(d => selectedSet.has(d)).length
      if (selectedSet.has(id) || checkedDesc === desc.length) return 'checked'
      if (checkedDesc > 0) return 'indeterminate'
      return 'unchecked'
    }, [tree.descMap, selectedSet])

    const toggleNode = id => {
      const next = new Set(selectedSet)
      const desc = tree.descMap.get(id) ?? []
      const state = nodeState(id)
      if (state === 'checked') {
        next.delete(id)
        for (const d of desc) next.delete(d)
        // 若取消某个子节点，同步解除祖先节点的全选标记，保留其它兄弟节点
        let cur = tree.parentMap.get(id)
        while (cur) {
          if (next.has(cur)) {
            next.delete(cur)
            for (const sib of tree.childrenOf.get(cur) ?? []) {
              if (sib.kp_id !== id && !(tree.descMap.get(sib.kp_id) ?? []).includes(id)) {
                next.add(sib.kp_id)
                for (const sd of tree.descMap.get(sib.kp_id) ?? []) next.add(sd)
              }
            }
          }
          cur = tree.parentMap.get(cur)
        }
      } else {
        next.add(id)
        for (const d of desc) next.add(d)
        // 若同级全部选中，顺带勾选父节点
        let cur = tree.parentMap.get(id)
        while (cur) {
          const kids = tree.childrenOf.get(cur) ?? []
          if (kids.length && kids.every(k => next.has(k.kp_id))) next.add(cur)
          cur = tree.parentMap.get(cur)
        }
      }
      onChange([...next])
    }

    // 计算触发框里展示的精简标签（整章全选时只展示章名，避免标签爆炸）
    const displayChips = useMemo(() => {
      const chips = []
      const covered = new Set()
      for (const { node } of tree.flat) {
        if (covered.has(node.kp_id)) continue
        if (nodeState(node.kp_id) === 'checked') {
          chips.push(node)
          covered.add(node.kp_id)
          for (const d of tree.descMap.get(node.kp_id) ?? []) covered.add(d)
        }
      }
      return chips
    }, [tree.flat, tree.descMap, nodeState])

    // 搜索过滤（命中子节点时自动保留其父章作为路径上下文）
    const visibleRows = useMemo(() => {
      const q = search.trim().toLowerCase()
      if (!q) {
        const rows = []
        for (const row of tree.flat) {
          let hidden = false
          let anc = tree.parentMap.get(row.node.kp_id)
          while (anc) {
            if (collapsed.has(anc)) { hidden = true; break }
            anc = tree.parentMap.get(anc)
          }
          if (!hidden) rows.push(row)
        }
        return rows
      }
      const keep = new Set()
      for (const { node } of tree.flat) {
        const hay = `${node.name ?? ''} ${node.chapter_ref ?? ''}`.toLowerCase()
        if (hay.includes(q)) {
          keep.add(node.kp_id)
          let anc = tree.parentMap.get(node.kp_id)
          while (anc) { keep.add(anc); anc = tree.parentMap.get(anc) }
          for (const d of tree.descMap.get(node.kp_id) ?? []) keep.add(d)
        }
      }
      return tree.flat.filter(row => keep.has(row.node.kp_id))
    }, [tree.flat, tree.parentMap, tree.descMap, search, collapsed])

    const toggleFold = (e, id) => {
      e.stopPropagation()
      setCollapsed(cur => {
        const next = new Set(cur)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })
    }

    const selectScopeIds = useMemo(() => {
      const target = search.trim() ? visibleRows : tree.flat
      return target.map(r => r.node.kp_id)
    }, [search, visibleRows, tree.flat])

    const allInScopeSelected = selectScopeIds.length > 0 && selectScopeIds.every(id => nodeState(id) === 'checked')

    const toggleSelectAll = () => {
      const next = new Set(selectedSet)
      if (allInScopeSelected) {
        for (const id of selectScopeIds) next.delete(id)
      } else {
        for (const id of selectScopeIds) next.add(id)
      }
      onChange([...next])
    }

    const maxChips = 3
    return h('div', { className: 'dsh-study-dd', ref: rootRef, style },
      h('button', {
        type: 'button',
        className: 'dsh-study-dd-trigger',
        'aria-haspopup': 'listbox',
        'aria-expanded': open,
        onClick: () => setOpen(v => !v),
      },
      h('span', { className: 'dsh-study-dd-val' },
        displayChips.length
          ? h(React.Fragment, null,
            displayChips.slice(0, maxChips).map(chip => h('span', { key: chip.kp_id, className: 'dsh-study-chip' },
              h('span', { title: chip.name }, chip.name),
              h('span', {
                role: 'button',
                tabIndex: -1,
                className: 'dsh-study-chip-x',
                title: `移除 ${chip.name}`,
                onClick: e => {
                  e.stopPropagation()
                  toggleNode(chip.kp_id)
                },
              }, h(Icon.X, { size: 11 })))),
            displayChips.length > maxChips
              ? h('span', { className: 'dsh-study-chip-more' }, `+${displayChips.length - maxChips}`)
              : null)
          : h('span', { className: 'dsh-study-dd-placeholder' }, placeholder)),
      h('span', { className: 'dsh-study-dd-actions' },
        displayChips.length
          ? h('span', {
            role: 'button',
            tabIndex: -1,
            className: 'dsh-study-dd-clear',
            title: '清空已选知识点',
            onClick: e => {
              e.stopPropagation()
              onChange([])
            },
          }, h(Icon.X, { size: 13 }))
          : null,
        h(Icon.ChevronDown, { size: 15, className: 'dsh-study-dd-chev' }))),

      open ? h('div', { className: `dsh-study-dd-menu wide${align === 'right' ? ' align-right' : ''}`, role: 'listbox', 'aria-multiselectable': 'true' },
        h('div', { className: 'dsh-study-dd-search' },
          h(Icon.Search, { size: 14 }),
          h('input', {
            ref: inputRef,
            placeholder: '搜索知识点名称…',
            value: search,
            onChange: e => setSearch(e.target.value),
          }),
          search
            ? h('button', { type: 'button', className: 'dsh-study-dd-clear', onClick: () => setSearch('') }, h(Icon.X, { size: 12 }))
            : null),
        h('div', { className: 'dsh-study-dd-list' },
          visibleRows.length
            ? visibleRows.map(({ node, depth, hasChildren }) => {
              const checkState = nodeState(node.kp_id)
              const isFolded = collapsed.has(node.kp_id) && !search.trim()
              return h('div', {
                key: `${node.course_code}-${node.kp_id}`,
                role: 'option',
                'aria-selected': checkState === 'checked',
                'data-selected': checkState !== 'unchecked' ? 'true' : 'false',
                className: `dsh-study-dd-opt${depth === 0 && hasChildren ? ' chapter' : ''}`,
                style: { paddingLeft: 8 + depth * 18 },
                onClick: () => toggleNode(node.kp_id),
              },
              hasChildren
                ? h('button', {
                  type: 'button',
                  className: 'dsh-study-dd-fold',
                  onClick: e => toggleFold(e, node.kp_id),
                  title: isFolded ? '展开' : '折叠',
                }, h(isFolded ? Icon.ChevronRight : Icon.ChevronDown, { size: 13 }))
                : (depth > 0 ? h('span', { style: { width: 10, flexShrink: 0 } }) : null),
              h('span', { className: 'dsh-study-dd-check', 'data-state': checkState },
                checkState === 'checked'
                  ? h(Icon.Check, { size: 11, strokeWidth: 2.8 })
                  : checkState === 'indeterminate'
                    ? h(Icon.Minus, { size: 11, strokeWidth: 2.8 })
                    : null),
              h('span', { className: 'dsh-study-dd-opt-label', title: node.name }, node.name),
              typeof node.question_count === 'number' && node.question_count > 0
                ? h('span', { className: 'dsh-study-dd-count' }, `${node.question_count} 题`)
                : null)
            })
            : h('div', { className: 'dsh-study-dd-empty' }, '没有匹配的知识点')),
        h('div', { className: 'dsh-study-dd-foot' },
          h('button', {
            type: 'button', className: 'dsh-study-btn sm ghost', style: { height: 26, padding: '0 8px' },
            disabled: !selectScopeIds.length,
            onClick: toggleSelectAll,
          }, allInScopeSelected ? '取消全选' : '全选'),
          h('div', { className: 'dsh-study-row', style: { gap: 6 } },
            displayChips.length
              ? h('button', {
                type: 'button', className: 'dsh-study-btn sm ghost', style: { height: 26, padding: '0 8px' },
                onClick: () => onChange([]),
              }, '清空')
              : null,
            h('button', {
              type: 'button', className: 'dsh-study-btn sm primary', style: { height: 26, padding: '0 10px' },
              onClick: () => setOpen(false),
            }, '完成')))) : null)
  }

  function useStudyData() {
    const [state, setState] = useState({
      sources: [], courses: [], mistakes: [], drafts: [], papers: [], exports: [],
      templates: [], taxonomy: [], error: '', notice: '', busy: false, loaded: false,
    })

    const refresh = useCallback(async () => {
      try {
        const [sources, mistakes, drafts, papers, templates, exports, taxonomy] = await Promise.all([
          rpc(ctx, 'sourceList'),
          rpc(ctx, 'mistakeList'),
          rpc(ctx, 'mistakeDraftList'),
          rpc(ctx, 'paperList'),
          rpc(ctx, 'templateList'),
          rpc(ctx, 'exportList'),
          rpc(ctx, 'taxonomyList'),
        ])
        const courseRows = sources.filter(row => row.course_code)
        setState(current => ({
          ...current,
          sources, courses: courseRows, mistakes, drafts, papers, templates, exports, taxonomy,
          error: '', loaded: true,
        }))
      } catch (error) {
        setState(current => ({ ...current, error: friendlyError(error), loaded: true }))
      }
    }, [])

    useEffect(() => { refresh() }, [refresh])

    const call = useCallback(async (endpoint, payload = {}, successNotice = '') => {
      setState(current => ({ ...current, busy: true, error: '', notice: '' }))
      try {
        const result = await rpc(ctx, endpoint, payload)
        await refresh()
        if (successNotice) setState(current => ({ ...current, notice: successNotice }))
        return result
      } catch (error) {
        setState(current => ({ ...current, error: friendlyError(error) }))
        throw error
      } finally {
        setState(current => ({ ...current, busy: false }))
      }
    }, [refresh])

    const clearMessages = () => setState(current => ({ ...current, error: '', notice: '' }))
    return [state, call, refresh, clearMessages]
  }

  // ============================================================================
  // 主工作台（精简 3 标签：快速出卷 · 题库与错题 · 题库管理）
  // ============================================================================

  function Workspace() {
    const [state, call, , clearMessages] = useStudyData()
    const [tab, setTab] = useState('quick')

    // ---- 快速出卷（零模型直出通道）----
    const [quickMode, setQuickMode] = useState('exam') // 'exam' | 'mistake'
    const [selectedCourseCodes, setSelectedCourseCodes] = useState([])
    const [count, setCount] = useState(8)
    const [pdfTemplate, setPdfTemplate] = useState('ustc-exam')
    const [pdfMode, setPdfMode] = useState('inline-solution')
    const [showAdvanced, setShowAdvanced] = useState(false)
    const [advFilter, setAdvFilter] = useState({
      kp_ids: [], type: '', origin: '', difficulty_min: '', difficulty_max: '', title: '', showBindingLine: true,
    })
    const [activeExport, setActiveExport] = useState(null)
    const [activePaper, setActivePaper] = useState(null)
    const [pdfSubView, setPdfSubView] = useState('primary') // 'primary' | 'answers' | 'html'
    const [slidesManifest, setSlidesManifest] = useState(null)
    const [slideIndex, setSlideIndex] = useState(0)
    const [editingPaper, setEditingPaper] = useState(false)
    const [editableItems, setEditableItems] = useState([])
    const [latexEnv, setLatexEnv] = useState(null)

    // ---- 题库与错题 ----
    const [bankSubTab, setBankSubTab] = useState('browse') // 'browse' | 'mistakes'
    const [bankCourse, setBankCourse] = useState('')
    const [bankKps, setBankKps] = useState([])
    const [bankQuery, setBankQuery] = useState('')
    const [bankItems, setBankItems] = useState([])
    const [bankSearched, setBankSearched] = useState(false)
    const [basket, setBasket] = useState([]) // [{ source_id, question_id, stem, course_code }]
    const [showAddMistakeModal, setShowAddMistakeModal] = useState(false)
    const [mistakeForm, setMistakeForm] = useState({
      course_code: '', stem: '', answer: '', solution: '', error_tags: [], reflection_md: '',
    })

    // ---- 题库管理 ----
    const [checkedCourses, setCheckedCourses] = useState([])
    const [showAddSource, setShowAddSource] = useState(false)
    const [sourceForm, setSourceForm] = useState({ name: '', transport: 'local-dir', location: '' })

    const installedCourses = useMemo(() => {
      const map = new Map()
      for (const row of state.courses) {
        if (!row.installed) continue
        if (!map.has(row.course_code)) {
          map.set(row.course_code, { code: row.course_code, name: row.course_name || row.course_code, total: row.total_questions })
        } else {
          const prev = map.get(row.course_code)
          prev.total += Number(row.total_questions || 0)
        }
      }
      return [...map.values()]
    }, [state.courses])

    const courseNameMap = useMemo(() => {
      const m = new Map()
      for (const row of state.courses) m.set(row.course_code, row.course_name || row.course_code)
      return m
    }, [state.courses])

    const mistakeKeySet = useMemo(() => new Set(state.mistakes.map(m => `${m.source_id}\0${m.question_id}`)), [state.mistakes])
    const dueCount = useMemo(() => state.mistakes.filter(m => Date.parse(m.next_review_at) <= Date.now()).length, [state.mistakes])
    const unmasteredCount = useMemo(() => state.mistakes.filter(m => m.status === 'unmastered').length, [state.mistakes])

    // 自动选中第一门已装课程
    useEffect(() => {
      if (installedCourses.length && !selectedCourseCodes.length) {
        setSelectedCourseCodes([installedCourses[0].code])
      }
      if (installedCourses.length && !bankCourse) {
        setBankCourse(installedCourses[0].code)
      }
      if (installedCourses.length && !mistakeForm.course_code) {
        setMistakeForm(cur => ({ ...cur, course_code: installedCourses[0].code }))
      }
    }, [installedCourses])

    // 自动检测本机或插件托管的 LaTeX（xelatex）环境；安装中则轮询进度
    useEffect(() => {
      let live = true
      rpc(ctx, 'envCheck').then(info => {
        if (live) setLatexEnv(info)
      }).catch(() => {})
      return () => { live = false }
    }, [])

    useEffect(() => {
      if (!latexEnv?.installing) return undefined
      let live = true
      const timer = setInterval(() => {
        rpc(ctx, 'envCheck').then(info => {
          if (live) setLatexEnv(info)
        }).catch(() => {})
      }, 1200)
      return () => {
        live = false
        clearInterval(timer)
      }
    }, [latexEnv?.installing])

    const startInstallLatex = useCallback(async () => {
      try {
        const info = await rpc(ctx, 'envInstallLatex', {})
        setLatexEnv(info)
      } catch (error) {
        setLatexEnv(cur => ({
          ...(cur ?? { available: false }),
          installing: false,
          error: friendlyError(error),
        }))
      }
    }, [])

    // 首次进入导出历史时加载最近一条导出用于预览
    useEffect(() => {
      if (!activeExport && state.exports.length) {
        const latest = state.exports[0]
        setActiveExport(normalizeExportRow(latest))
      }
    }, [state.exports, activeExport])

    // 当切换到 PPT 导出记录时拉取 slides-manifest.json
    useEffect(() => {
      if (!activeExport || activeExport.format !== 'ppt' || !activeExport.artifacts?.slidesManifest) {
        setSlidesManifest(null)
        return
      }
      let live = true
      fetch(fileUrl(activeExport.artifacts.slidesManifest))
        .then(res => res.ok ? res.json() : null)
        .then(data => {
          if (live && data) {
            setSlidesManifest(data)
            setSlideIndex(0)
          }
        })
        .catch(() => {})
      return () => { live = false }
    }, [activeExport])

    // 题库浏览自动按当前课程加载前 30 题
    const loadBankQuestions = useCallback(async (override = {}) => {
      const targetCourse = override.course ?? bankCourse
      const targetKps = override.kps ?? bankKps
      const targetQuery = override.query ?? bankQuery
      if (!installedCourses.length) {
        setBankItems([])
        return
      }
      try {
        const rows = await rpc(ctx, 'questionSearch', {
          course_codes: targetCourse ? [targetCourse] : [],
          kp_ids: Array.isArray(targetKps) ? targetKps : [],
          query: targetQuery,
          limit: 30,
        })
        setBankItems(rows)
        setBankSearched(true)
      } catch {}
    }, [bankCourse, bankKps, bankQuery, installedCourses.length])

    useEffect(() => {
      if (tab === 'bank' && bankSubTab === 'browse' && installedCourses.length && !bankSearched) {
        loadBankQuestions()
      }
    }, [tab, bankSubTab, installedCourses.length, bankSearched, loadBankQuestions])

    const pdfTemplates = useMemo(() => state.templates.filter(item => item.kind === 'pdf'), [state.templates])
    const courseTaxonomy = useMemo(() => {
      const codes = selectedCourseCodes.length ? new Set(selectedCourseCodes) : null
      return state.taxonomy.filter(node => !codes || codes.has(node.course_code))
    }, [state.taxonomy, selectedCourseCodes])
    const bankTaxonomy = useMemo(() => state.taxonomy.filter(node => !bankCourse || node.course_code === bankCourse), [state.taxonomy, bankCourse])

    // ---- 零模型一键出卷/出 PPT ----
    const runQuickExport = async (format, extra = {}) => {
      const payload = {
        mode: extra.mode ?? quickMode,
        course_codes: extra.course_codes ?? selectedCourseCodes,
        count: extra.count ?? count,
        title: extra.title ?? (advFilter.title.trim() || undefined),
        kp_ids: Array.isArray(advFilter.kp_ids) ? advFilter.kp_ids : [],
        types: advFilter.type ? [advFilter.type] : [],
        answer_origins: advFilter.origin ? [advFilter.origin] : [],
        difficulty_min: advFilter.difficulty_min ? Number(advFilter.difficulty_min) : undefined,
        difficulty_max: advFilter.difficulty_max ? Number(advFilter.difficulty_max) : undefined,
        format,
        template_id: format === 'ppt' ? 'review-classic' : pdfTemplate,
        pdf_mode: pdfMode,
        options: { showBindingLine: advFilter.showBindingLine },
        ...extra,
      }
      const res = await call('quickExport', payload)
      if (res?.paper) {
        setActivePaper(res.paper)
        setEditableItems(res.paper.items ?? [])
      }
      if (res?.export) {
        setActiveExport({
          ...res.export,
          paper_title: res.paper?.title ?? '练习卷',
        })
        setPdfSubView('primary')
      }
      setTab('quick')
    }

    const openExportRecord = async row => {
      const normalized = normalizeExportRow(row)
      setActiveExport(normalized)
      setPdfSubView('primary')
      if (row.paper_id) {
        const paper = await rpc(ctx, 'paperGet', { paper_id: row.paper_id }).catch(() => null)
        if (paper) {
          setActivePaper(paper)
          setEditableItems(paper.items ?? [])
        }
      }
    }

    const updateSelectedCourses = codes => {
      setSelectedCourseCodes(codes)
      const codeSet = new Set(codes)
      const validKpIds = new Set(state.taxonomy.filter(n => !codeSet.size || codeSet.has(n.course_code)).map(n => n.kp_id))
      setAdvFilter(cur => ({
        ...cur,
        kp_ids: cur.kp_ids.filter(id => validKpIds.has(id)),
      }))
    }

    // ==================== 视图 1：快速出卷（零模型直出） ====================
    const renderPreviewPane = () => {
      if (!activeExport) {
        return h('div', { className: 'dsh-study-preview-pane' },
          h('div', { className: 'dsh-study-empty', style: { flex: 1, justifyContent: 'center' } },
            h(Icon.FileText, { size: 30, strokeWidth: 1.5 }),
            h('div', { className: 'dsh-study-muted' }, '选择课程后点击生成')))
      }

      const arts = activeExport.artifacts ?? {}
      const isPpt = activeExport.format === 'ppt'
      const isSplit = activeExport.export_mode === 'split' || (arts.questionPdf && arts.answerPdf)
      const primaryPdf = arts.inlinePdf || arts.questionPdf
      const answerPdf = arts.answerPdf
      const htmlUrl = arts.html ? fileUrl(arts.html) : ''
      const iframeSrc = pdfSubView === 'answers' && answerPdf
        ? fileUrl(answerPdf)
        : pdfSubView === 'html' || !primaryPdf
          ? htmlUrl
          : fileUrl(primaryPdf)

      const curSlide = slidesManifest?.slides?.[slideIndex]

      return h('div', { className: 'dsh-study-preview-pane' },
        h('div', { className: 'dsh-study-between' },
          h('div', { className: 'dsh-study-row' },
            h('strong', { style: { fontSize: '14.5px' } }, activeExport.paper_title || '已生成试卷'),
            h('span', { className: 'dsh-study-tag accent' }, TEMPLATE_LABEL[activeExport.template_id] ?? activeExport.template_id),
            activeExport.status === 'degraded'
              ? h('span', { className: 'dsh-study-tag warn' }, '可打印网页版')
              : null),
          h('div', { className: 'dsh-study-row' },
            !isPpt && isSplit && answerPdf ? h('div', { className: 'dsh-study-seg auto' },
              h('button', { type: 'button', 'aria-pressed': pdfSubView === 'primary', onClick: () => setPdfSubView('primary') }, '原题卷'),
              h('button', { type: 'button', 'aria-pressed': pdfSubView === 'answers', onClick: () => setPdfSubView('answers') }, '答案卷'),
              htmlUrl ? h('button', { type: 'button', 'aria-pressed': pdfSubView === 'html', onClick: () => setPdfSubView('html') }, '网页版') : null)
              : null,
            !isPpt && primaryPdf ? h('a', {
              className: 'dsh-study-btn sm', href: fileUrl(pdfSubView === 'answers' && answerPdf ? answerPdf : primaryPdf, true),
              download: '', target: '_blank', rel: 'noreferrer', style: { textDecoration: 'none' },
            }, h(Icon.Download, { size: 14 }), pdfSubView === 'answers' && answerPdf ? '下载答案 PDF' : '下载 PDF') : null,
            !isPpt && isSplit && answerPdf && pdfSubView !== 'answers' ? h('a', {
              className: 'dsh-study-btn sm', href: fileUrl(answerPdf, true),
              download: '', target: '_blank', rel: 'noreferrer', style: { textDecoration: 'none' },
            }, h(Icon.Download, { size: 14 }), '下载答案') : null,
            !isPpt && htmlUrl ? h('a', {
              className: 'dsh-study-btn sm ghost', href: htmlUrl, target: '_blank', rel: 'noreferrer',
              style: { textDecoration: 'none' },
            }, h(Icon.ExternalLink, { size: 14 }), '新窗口打印') : null,
            isPpt && arts.pptx ? h('a', {
              className: 'dsh-study-btn sm primary', href: fileUrl(arts.pptx, true),
              download: '', target: '_blank', rel: 'noreferrer', style: { textDecoration: 'none' },
            }, h(Icon.Download, { size: 14 }), '下载 PPT 文件') : null,
            activeExport.paper_id ? h('button', {
              type: 'button', className: 'dsh-study-btn sm', disabled: state.busy,
              onClick: () => runQuickExport(isPpt ? 'pdf' : 'ppt', { paper_id: activeExport.paper_id }),
            }, isPpt ? '同卷生成 PDF' : '同卷生成 PPT') : null)),

        activeExport.degraded_reason
          ? h('div', { className: 'dsh-study-banner info', style: { marginBottom: 0 } },
            h('span', null, activeExport.degraded_reason),
            latexEnv && !latexEnv.available && !latexEnv.installing
              ? h('button', {
                type: 'button', className: 'dsh-study-btn sm primary',
                onClick: startInstallLatex,
              }, h(Icon.Download, { size: 14 }), '一键安装 LaTeX')
              : null)
          : null,

        isPpt
          ? h(React.Fragment, null,
            h('div', { className: 'dsh-study-slide-stage' },
              curSlide
                ? h('img', { src: fileUrl(curSlide.thumbnail_path), alt: curSlide.title })
                : h('div', { className: 'dsh-study-muted' }, '正在加载幻灯片预览…')),
            slidesManifest?.slides?.length
              ? h('div', { className: 'dsh-study-between' },
                h('span', { className: 'dsh-study-muted' }, `第 ${slideIndex + 1} / ${slidesManifest.slides.length} 页 · ${curSlide?.title ?? ''}`),
                h('div', { className: 'dsh-study-row' },
                  h('button', {
                    type: 'button', className: 'dsh-study-btn sm', disabled: slideIndex <= 0,
                    onClick: () => setSlideIndex(i => Math.max(0, i - 1)),
                  }, '上一页'),
                  h('button', {
                    type: 'button', className: 'dsh-study-btn sm', disabled: slideIndex >= slidesManifest.slides.length - 1,
                    onClick: () => setSlideIndex(i => Math.min(slidesManifest.slides.length - 1, i + 1)),
                  }, '下一页')))
              : null,
            slidesManifest?.slides?.length
              ? h('div', { className: 'dsh-study-thumbs' },
                slidesManifest.slides.map((sl, idx) => h('button', {
                  key: idx, type: 'button', className: 'dsh-study-thumb',
                  'aria-current': idx === slideIndex,
                  onClick: () => setSlideIndex(idx),
                },
                h('img', { src: fileUrl(sl.thumbnail_path), alt: sl.title }),
                h('span', null, `${idx + 1}. ${sl.title}`))))
              : null)
          : h('iframe', { className: 'dsh-study-frame', src: iframeSrc, title: '试卷预览' }),

        state.exports.length > 1
          ? h('details', { className: 'dsh-study-details' },
            h('summary', null, `最近生成记录（${state.exports.length}）`),
            h('div', { className: 'dsh-study-stack', style: { marginTop: 8 } },
              state.exports.slice(0, 8).map(row => h('div', {
                key: row.export_id, className: 'dsh-study-between',
                style: { padding: '6px 10px', borderRadius: 6, background: activeExport?.export_id === row.export_id ? 'var(--s-surface)' : 'transparent', cursor: 'pointer' },
                onClick: () => openExportRecord(row),
              },
              h('span', null, row.paper_title || '练习卷'),
              h('span', { className: 'dsh-study-muted' },
                `${TEMPLATE_LABEL[row.template_id] ?? row.template_id} · ${row.format === 'ppt' ? 'PPT' : (PDF_MODE_LABEL[row.export_mode] ?? 'PDF')} · ${formatShortTime(row.created_at)}`)))))
          : null)
    }

    const quickView = !installedCourses.length && quickMode === 'exam'
      ? h('div', { className: 'dsh-study-empty', style: { maxWidth: 420, margin: '64px auto' } },
        h(Icon.BookOpen, { size: 30, strokeWidth: 1.5 }),
        h('div', { style: { fontSize: 14.5, fontWeight: 500, color: 'var(--s-text)' } }, '暂无已下载题库'),
        h('button', { type: 'button', className: 'dsh-study-btn primary', onClick: () => setTab('sources') },
          h(Icon.Download, { size: 15 }), '下载题库'))
      : h('div', { className: 'dsh-study-split' },
        h('div', { className: 'dsh-study-col' },
          h('div', { className: 'dsh-study-seg' },
            h('button', { type: 'button', 'aria-pressed': quickMode === 'exam', onClick: () => setQuickMode('exam') }, '按课程出卷'),
            h('button', { type: 'button', 'aria-pressed': quickMode === 'mistake', onClick: () => setQuickMode('mistake') },
              `按错题出卷${state.mistakes.length ? ` (${state.mistakes.length})` : ''}`)),

          h('div', { className: 'dsh-study-group' },
            h('span', { className: 'dsh-study-group-label' }, '选择课程'),
            installedCourses.length
              ? h(MultiSelect, {
                options: installedCourses.map(c => ({ value: c.code, label: c.name, meta: `${c.total} 题` })),
                value: selectedCourseCodes,
                placeholder: quickMode === 'mistake' ? '全部课程（不限）' : '选择课程',
                searchPlaceholder: '搜索课程名称…',
                onChange: updateSelectedCourses,
              })
              : h('div', { className: 'dsh-study-muted' }, '暂无已下载课程')),

          h('div', { className: 'dsh-study-group' },
            h('span', { className: 'dsh-study-group-label' }, '题目数量'),
            h('div', { className: 'dsh-study-row' },
              h('div', { className: 'dsh-study-pills' },
                COUNT_PRESETS.map(n => h('button', {
                  key: n, type: 'button', className: 'dsh-study-pill',
                  'aria-pressed': count === n, onClick: () => setCount(n),
                }, `${n} 题`))),
              h('input', {
                className: 'dsh-study-input', type: 'number', min: 1, max: 100,
                style: { width: 72, height: 30 }, value: count,
                onChange: e => setCount(Math.max(1, Number(e.target.value) || 1)),
              }))),

          h('div', { className: 'dsh-study-group' },
            h('span', { className: 'dsh-study-group-label' }, '试卷模板'),
            h('div', { className: 'dsh-study-pills' },
              pdfTemplates.map(tpl => h('button', {
                key: tpl.id, type: 'button', className: 'dsh-study-pill',
                'aria-pressed': pdfTemplate === tpl.id,
                onClick: () => setPdfTemplate(tpl.id),
              }, TEMPLATE_LABEL[tpl.id] ?? tpl.name)))),

          h('div', { className: 'dsh-study-group' },
            h('span', { className: 'dsh-study-group-label' }, 'PDF 版式'),
            h('div', { className: 'dsh-study-seg' },
              h('button', { type: 'button', 'aria-pressed': pdfMode === 'inline-solution', onClick: () => setPdfMode('inline-solution') }, '题目后附解析'),
              h('button', { type: 'button', 'aria-pressed': pdfMode === 'split', onClick: () => setPdfMode('split') }, '原题与答案分开'))),

          h('div', null,
            h('button', {
              type: 'button', className: 'dsh-study-btn sm ghost', style: { paddingLeft: 0 },
              onClick: () => setShowAdvanced(v => !v),
            }, h(showAdvanced ? Icon.ChevronDown : Icon.ChevronRight, { size: 15 }), '更多筛选与卷头（可选）'),
            showAdvanced ? h('div', { className: 'dsh-study-soft dsh-study-stack', style: { marginTop: 8 } },
              h('div', { className: 'dsh-study-group' },
                h('span', { className: 'dsh-study-group-label' }, '自定义试卷名称'),
                h('input', {
                  className: 'dsh-study-input', placeholder: '留空自动按课程命名',
                  value: advFilter.title,
                  onChange: e => setAdvFilter(c => ({ ...c, title: e.target.value })),
                })),
              quickMode === 'exam' && courseTaxonomy.length ? h('div', { className: 'dsh-study-group' },
                h('span', { className: 'dsh-study-group-label' }, '限定知识点（可多选）'),
                h(KpMultiSelect, {
                  nodes: courseTaxonomy,
                  value: advFilter.kp_ids,
                  placeholder: '全部知识点',
                  onChange: kp_ids => setAdvFilter(c => ({ ...c, kp_ids })),
                })) : null,
              quickMode === 'exam' ? h('div', { className: 'dsh-study-grid2' },
                h('div', { className: 'dsh-study-group' },
                  h('span', { className: 'dsh-study-group-label' }, '题型'),
                  h(NiceSelect, {
                    value: advFilter.type,
                    placeholder: '不限题型',
                    options: [
                      { value: '', label: '不限题型' },
                      ...Object.entries(TYPE_LABEL).map(([k, v]) => ({ value: k, label: v })),
                    ],
                    onChange: type => setAdvFilter(c => ({ ...c, type })),
                  })),
                h('div', { className: 'dsh-study-group' },
                  h('span', { className: 'dsh-study-group-label' }, '答案来源'),
                  h(NiceSelect, {
                    value: advFilter.origin,
                    placeholder: '全部来源',
                    align: 'right',
                    options: [
                      { value: '', label: '全部来源' },
                      ...Object.entries(ORIGIN_LABEL).map(([k, v]) => ({ value: k, label: v })),
                    ],
                    onChange: origin => setAdvFilter(c => ({ ...c, origin })),
                  }))) : null,
              quickMode === 'exam' ? h('div', { className: 'dsh-study-grid2' },
                h('div', { className: 'dsh-study-group' },
                  h('span', { className: 'dsh-study-group-label' }, '最低难度（1–5）'),
                  h('input', {
                    className: 'dsh-study-input', type: 'number', min: 1, max: 5, placeholder: '1',
                    value: advFilter.difficulty_min,
                    onChange: e => setAdvFilter(c => ({ ...c, difficulty_min: e.target.value })),
                  })),
                h('div', { className: 'dsh-study-group' },
                  h('span', { className: 'dsh-study-group-label' }, '最高难度（1–5）'),
                  h('input', {
                    className: 'dsh-study-input', type: 'number', min: 1, max: 5, placeholder: '5',
                    value: advFilter.difficulty_max,
                    onChange: e => setAdvFilter(c => ({ ...c, difficulty_max: e.target.value })),
                  }))) : null,
              pdfTemplate === 'ustc-exam' ? h('label', { className: 'dsh-study-row', style: { cursor: 'pointer' } },
                h('input', {
                  type: 'checkbox', checked: advFilter.showBindingLine,
                  onChange: e => setAdvFilter(c => ({ ...c, showBindingLine: e.target.checked })),
                }),
                h('span', null, '奇数页绘制左侧密封装订线')) : null) : null),

          latexEnv && (!latexEnv.available || latexEnv.installing)
            ? h('div', { className: 'dsh-study-soft dsh-study-stack', style: { gap: 8 } },
              latexEnv.installing
                ? h(React.Fragment, null,
                  h('div', { className: 'dsh-study-between', style: { fontSize: 12.5 } },
                    h('span', null, latexEnv.detail || '正在安装轻量 LaTeX 环境…'),
                    h('span', { className: 'dsh-study-muted' }, `${latexEnv.percent || 0}%`)),
                  h('div', { className: 'dsh-study-progress' },
                    h('div', { className: 'dsh-study-progress-fill', style: { width: `${Math.max(4, Math.min(100, latexEnv.percent || 4))}%` } })))
                : h(React.Fragment, null,
                  h('div', { className: 'dsh-study-between', style: { gap: 10 } },
                    h('span', { style: { fontSize: 12.5 } }, '未检测到 LaTeX，导出 PDF 需安装轻量排版环境（约 70 MB）'),
                    h('button', {
                      type: 'button', className: 'dsh-study-btn sm primary',
                      onClick: startInstallLatex,
                    }, h(Icon.Download, { size: 13 }), '一键安装')),
                  latexEnv.error
                    ? h('div', { style: { fontSize: 12, color: 'var(--s-danger)' } }, latexEnv.error)
                    : null))
            : null,

          h('div', { className: 'dsh-study-stack', style: { marginTop: 4 } },
            h('button', {
              type: 'button', className: 'dsh-study-btn primary', disabled: state.busy || (quickMode === 'exam' && !selectedCourseCodes.length),
              onClick: () => runQuickExport('pdf'),
            }, h(Icon.FileText, { size: 15 }), state.busy ? '正在生成…' : '直接生成 PDF 试卷'),
            h('button', {
              type: 'button', className: 'dsh-study-btn', disabled: state.busy || (quickMode === 'exam' && !selectedCourseCodes.length),
              onClick: () => runQuickExport('ppt'),
            }, h(Icon.Presentation, { size: 15 }), '直接生成讲评 PPT')),

          activePaper?.items?.length ? h('div', { className: 'dsh-study-box' },
            h('div', { className: 'dsh-study-between' },
              h('span', { style: { fontWeight: 600, fontSize: 13 } }, `当前题目（${editableItems.length} 题）`),
              h('button', {
                type: 'button', className: 'dsh-study-btn sm ghost',
                onClick: () => setEditingPaper(v => !v),
              }, editingPaper ? '收起' : '调整顺序与分值')),
            editingPaper ? h('div', { style: { marginTop: 8 } },
              editableItems.map((it, idx) => h('div', { className: 'dsh-study-order-row', key: `${it.source_id}-${it.question_id}-${idx}` },
                h('div', { className: 'dsh-study-row', style: { gap: 2 } },
                  h('button', {
                    type: 'button', className: 'dsh-study-icon-btn', disabled: idx === 0, title: '上移',
                    onClick: () => setEditableItems(cur => moveItem(cur, idx, idx - 1)),
                  }, h(Icon.ArrowUp, { size: 13 })),
                  h('button', {
                    type: 'button', className: 'dsh-study-icon-btn', disabled: idx === editableItems.length - 1, title: '下移',
                    onClick: () => setEditableItems(cur => moveItem(cur, idx, idx + 1)),
                  }, h(Icon.ArrowDown, { size: 13 }))),
                h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
                  `${idx + 1}. ${stripLatexInline(it.question.stem.md).slice(0, 34)}`),
                h('input', {
                  className: 'dsh-study-input', type: 'number', min: 1, max: 200, style: { height: 28, padding: '2px 6px' },
                  value: it.score,
                  onChange: e => setEditableItems(cur => cur.map((x, i) => i === idx ? { ...x, score: Number(e.target.value) || 0 } : x)),
                }))),
              h('div', { className: 'dsh-study-row', style: { marginTop: 10 } },
                h('button', {
                  type: 'button', className: 'dsh-study-btn sm primary', disabled: state.busy,
                  onClick: async () => {
                    const updated = await call('paperItemsUpdate', {
                      paper_id: activePaper.paper_id,
                      items: editableItems.map(({ seq, score }) => ({ seq, score })),
                    }, '题目顺序与分值已更新')
                    setActivePaper(updated)
                    setEditableItems(updated.items)
                  },
                }, '保存调整'),
                h('button', {
                  type: 'button', className: 'dsh-study-btn sm', disabled: state.busy,
                  onClick: () => runQuickExport(activeExport?.format === 'ppt' ? 'ppt' : 'pdf', { paper_id: activePaper.paper_id }),
                }, '重新生成预览'))) : null) : null),

        renderPreviewPane())

    // ==================== 视图 2：题库与错题 ====================
    const toggleBasket = item => {
      const key = `${item.source_id}\0${item.id}`
      setBasket(cur => cur.some(x => `${x.source_id}\0${x.question_id}` === key)
        ? cur.filter(x => `${x.source_id}\0${x.question_id}` !== key)
        : [...cur, { source_id: item.source_id, question_id: item.id, course_code: item.course_code }])
    }

    const draftsBanner = state.drafts.length
      ? h('div', { className: 'dsh-study-box', style: { marginBottom: 16, borderColor: 'var(--s-brand)' } },
        h('div', { className: 'dsh-study-between', style: { marginBottom: 10 } },
          h('strong', null, `待确认错题（${state.drafts.length}）`)),
        state.drafts.map(draft => h('div', { className: 'dsh-study-q', key: draft.draft_id },
          h('div', { className: 'dsh-study-between', style: { marginBottom: 6 } },
            h('span', { className: 'dsh-study-tag accent' }, courseNameMap.get(draft.question.course_code) ?? draft.question.course_code),
            h('div', { className: 'dsh-study-row' },
              h('button', {
                type: 'button', className: 'dsh-study-btn sm primary', disabled: state.busy,
                onClick: () => call('mistakeCommit', { draft_id: draft.draft_id, confirmed: true }, '已保存至个人错题库'),
              }, h(Icon.Check, { size: 14 }), '确认保存'),
              h('button', {
                type: 'button', className: 'dsh-study-btn sm ghost',
                onClick: () => call('mistakeDraftDismiss', { draft_id: draft.draft_id }),
              }, '忽略'))),
          h(RichMath, { text: draft.question.stem.md }),
          h('div', { className: 'dsh-study-muted', style: { marginTop: 6 } }, '参考答案：'),
          h(RichMath, { text: draft.question.answer.md }))))
      : null

    const bankAndMistakeView = h('div', { style: { maxWidth: 960, margin: '0 auto' } },
      h('div', { className: 'dsh-study-between', style: { marginBottom: 18 } },
        h('div', { className: 'dsh-study-seg auto' },
          h('button', { type: 'button', 'aria-pressed': bankSubTab === 'browse', onClick: () => setBankSubTab('browse') }, '浏览题库'),
          h('button', { type: 'button', 'aria-pressed': bankSubTab === 'mistakes', onClick: () => setBankSubTab('mistakes') },
            `错题本（${state.mistakes.length}）`)),
        h('div', { className: 'dsh-study-row' },
          bankSubTab === 'mistakes' && state.mistakes.length ? h(React.Fragment, null,
            h('button', {
              type: 'button', className: 'dsh-study-btn sm primary', disabled: state.busy,
              onClick: () => runQuickExport('pdf', { mode: 'mistake', course_codes: [] }),
            }, h(Icon.FileText, { size: 14 }), '错题出 PDF'),
            h('button', {
              type: 'button', className: 'dsh-study-btn sm', disabled: state.busy,
              onClick: () => runQuickExport('ppt', { mode: 'mistake', course_codes: [] }),
            }, h(Icon.Presentation, { size: 14 }), '错题出 PPT')) : null,
          h('button', {
            type: 'button', className: 'dsh-study-btn sm',
            onClick: () => setShowAddMistakeModal(true),
          }, h(Icon.Plus, { size: 14 }), '手动录错题'))),

      draftsBanner,

      bankSubTab === 'browse'
        ? h('div', null,
          !installedCourses.length
            ? h('div', { className: 'dsh-study-empty' },
              h('div', null, '尚未下载课程题库'),
              h('button', { type: 'button', className: 'dsh-study-btn primary', onClick: () => setTab('sources') }, '前往题库管理下载'))
            : h(React.Fragment, null,
              h('div', { className: 'dsh-study-row', style: { marginBottom: 14 } },
                h(NiceSelect, {
                  value: bankCourse,
                  placeholder: '选择课程',
                  searchPlaceholder: '搜索课程名称…',
                  wide: true,
                  style: { width: 210, flexShrink: 0 },
                  options: installedCourses.map(c => ({ value: c.code, label: c.name, meta: `${c.total} 题` })),
                  onChange: code => {
                    setBankCourse(code)
                    setBankKps([])
                    loadBankQuestions({ course: code, kps: [] })
                  },
                }),
                bankTaxonomy.length ? h(KpMultiSelect, {
                  nodes: bankTaxonomy,
                  value: bankKps,
                  placeholder: '筛选知识点（可多选）',
                  style: { width: 240, flexShrink: 0 },
                  onChange: kps => {
                    setBankKps(kps)
                    loadBankQuestions({ kps })
                  },
                }) : null,
                h('input', {
                  className: 'dsh-study-input', style: { flex: 1, minWidth: 160 },
                  placeholder: '搜索题干、考点或真题年份…', value: bankQuery,
                  onChange: e => setBankQuery(e.target.value),
                  onKeyDown: e => { if (e.key === 'Enter') loadBankQuestions() },
                }),
                h('button', { type: 'button', className: 'dsh-study-btn primary', onClick: () => loadBankQuestions() },
                  h(Icon.Search, { size: 14 }), '搜索')),

              bankItems.length
                ? bankItems.map(item => {
                  const key = `${item.source_id}\0${item.id}`
                  const isMistake = mistakeKeySet.has(key)
                  const inBasket = basket.some(x => `${x.source_id}\0${x.question_id}` === key)
                  return h('article', { className: 'dsh-study-q', key },
                    h('div', { className: 'dsh-study-between', style: { marginBottom: 8 } },
                      h('div', { className: 'dsh-study-row' },
                        h('span', { className: 'dsh-study-tag' }, TYPE_LABEL[item.type] ?? '解答题'),
                        h('span', { className: 'dsh-study-tag' }, ORIGIN_LABEL[item.answer_origin] ?? '参考答案'),
                        h('span', { className: 'dsh-study-muted' }, `难度 ${item.difficulty}/5${item.source_ref ? ` · ${item.source_ref}` : ''}`)),
                      h('div', { className: 'dsh-study-row' },
                        h('button', {
                          type: 'button', className: `dsh-study-btn sm${inBasket ? ' primary' : ''}`,
                          onClick: () => toggleBasket(item),
                        }, inBasket ? '已加入自选' : '加入自选卷'),
                        h('button', {
                          type: 'button', className: 'dsh-study-btn sm', disabled: state.busy,
                          onClick: () => call('mistakeMark', { source_id: item.source_id, question_id: item.id }, '已记入错题本'),
                        }, isMistake ? '再记一次错题' : '记入错题'))),
                    h(RichMath, { text: item.question?.stem?.md ?? '' }),
                    item.question?.options?.length ? h('div', { className: 'dsh-study-grid2', style: { marginTop: 8 } },
                      item.question.options.map(o => h('div', { key: o.key, className: 'dsh-study-row', style: { alignItems: 'baseline' } },
                        h('strong', null, `${o.key}.`), h(RichMath, { text: o.md })))) : null,
                    h('details', { className: 'dsh-study-details', style: { marginTop: 10 } },
                      h('summary', null, '查看答案与解析'),
                      h('div', { className: 'dsh-study-soft dsh-study-stack', style: { marginTop: 8 } },
                        h('div', null, h('strong', null, '答案：'), h(RichMath, { text: item.question?.answer?.md ?? '' })),
                        item.question?.solution?.md ? h('div', null, h('strong', null, '解析：'), h(RichMath, { text: item.question.solution.md })) : null)))
                })
                : h('div', { className: 'dsh-study-empty' }, '没有找到匹配的题目，换个关键词或课程试试'),

              basket.length ? h('div', { className: 'dsh-study-basket-bar' },
                h('strong', null, `已自选 ${basket.length} 道题目`),
                h('div', { className: 'dsh-study-row' },
                  h('button', { type: 'button', className: 'dsh-study-btn sm ghost', onClick: () => setBasket([]) }, '清空'),
                  h('button', {
                    type: 'button', className: 'dsh-study-btn sm primary', disabled: state.busy,
                    onClick: () => runQuickExport('pdf', { mode: 'custom', custom_items: basket }),
                  }, '自选题生成 PDF'),
                  h('button', {
                    type: 'button', className: 'dsh-study-btn sm', disabled: state.busy,
                    onClick: () => runQuickExport('ppt', { mode: 'custom', custom_items: basket }),
                  }, '自选题生成 PPT'))) : null))
        : h('div', null,
          h('div', { className: 'dsh-study-stats' },
            h('div', { className: 'dsh-study-stat' }, h('span', null, '今日待复习'), h('strong', null, dueCount)),
            h('div', { className: 'dsh-study-stat' }, h('span', null, '尚未掌握'), h('strong', null, unmasteredCount)),
            h('div', { className: 'dsh-study-stat' }, h('span', null, '全部错题'), h('strong', null, state.mistakes.length))),
          state.mistakes.length
            ? state.mistakes.map(m => h('article', { className: 'dsh-study-q', key: m.mistake_id },
              h('div', { className: 'dsh-study-between', style: { marginBottom: 8 } },
                h('div', { className: 'dsh-study-row' },
                  h('span', { className: 'dsh-study-tag accent' }, courseNameMap.get(m.course_code) ?? m.course_code),
                  h('span', { className: `dsh-study-tag ${m.status === 'mastered' ? 'ok' : m.status === 'unmastered' ? 'warn' : ''}` },
                    STATUS_LABEL[m.status] ?? '未掌握'),
                  h('span', { className: 'dsh-study-muted' }, `错 ${m.wrong_count} 次`),
                  ...(m.error_tags ?? []).map(tag => h('span', { key: tag, className: 'dsh-study-tag' }, tag))),
                h('div', { className: 'dsh-study-row' },
                  ...REVIEW_ACTIONS.map(([rating, label]) => h('button', {
                    key: rating, type: 'button', className: 'dsh-study-btn sm', disabled: state.busy,
                    onClick: () => call('mistakeReview', { mistake_id: m.mistake_id, rating }, `已记录：${label}`),
                  }, label)),
                  h('button', {
                    type: 'button', className: 'dsh-study-icon-btn', title: '移出错题本',
                    onClick: () => call('mistakeDelete', { mistake_id: m.mistake_id }, '已移出错题本'),
                  }, h(Icon.Trash2, { size: 14 })))),
              h(RichMath, { text: m.question?.stem?.md ?? '' }),
              m.reflection_md ? h('div', { className: 'dsh-study-muted', style: { marginTop: 6 } }, `反思笔记：${m.reflection_md}`) : null,
              h('details', { className: 'dsh-study-details', style: { marginTop: 8 } },
                h('summary', null, '查看答案与解析'),
                h('div', { className: 'dsh-study-soft dsh-study-stack', style: { marginTop: 8 } },
                  h('div', null, h('strong', null, '答案：'), h(RichMath, { text: m.question?.answer?.md ?? '' })),
                  m.question?.solution?.md ? h('div', null, h('strong', null, '解析：'), h(RichMath, { text: m.question.solution.md })) : null))))
            : h('div', { className: 'dsh-study-empty' }, '暂无错题')))

    // ==================== 视图 3：题库管理 ====================
    const uniqueSources = useMemo(() => {
      const map = new Map()
      for (const row of state.sources) {
        if (row.transport === 'personal') continue
        if (!map.has(row.source_id)) {
          map.set(row.source_id, {
            source_id: row.source_id,
            name: row.name,
            transport: row.transport,
            location: row.location,
            courses: [],
          })
        }
        if (row.course_code) map.get(row.source_id).courses.push(row)
      }
      return [...map.values()]
    }, [state.sources])

    const toggleCheckedCourse = (sourceId, code) => {
      const key = `${sourceId}\0${code}`
      setCheckedCourses(cur => cur.some(x => `${x.source_id}\0${x.code}` === key)
        ? cur.filter(x => `${x.source_id}\0${x.code}` !== key)
        : [...cur, { source_id: sourceId, code }])
    }

    const sourcesView = h('div', { style: { maxWidth: 920, margin: '0 auto' }, className: 'dsh-study-stack' },
      h('div', { className: 'dsh-study-between', style: { marginBottom: 4 } },
        h('strong', { style: { fontSize: 15 } }, '题库源'),
        h('button', { type: 'button', className: 'dsh-study-btn', onClick: () => setShowAddSource(v => !v) },
          h(Icon.Plus, { size: 15 }), showAddSource ? '收起' : '添加题库源')),

      showAddSource ? h('form', {
        className: 'dsh-study-box dsh-study-stack',
        onSubmit: async e => {
          e.preventDefault()
          await call('sourceAdd', sourceForm, '题库源已添加并读取课程清单')
          setSourceForm({ name: '', transport: 'local-dir', location: '' })
          setShowAddSource(false)
        },
      },
      h('div', { className: 'dsh-study-grid2' },
        h('div', { className: 'dsh-study-group' },
          h('span', { className: 'dsh-study-group-label' }, '题库名称'),
          h('input', {
            className: 'dsh-study-input', required: true, placeholder: '例如：本机中科大题库',
            value: sourceForm.name,
            onChange: e => setSourceForm(c => ({ ...c, name: e.target.value })),
          })),
        h('div', { className: 'dsh-study-group' },
          h('span', { className: 'dsh-study-group-label' }, '来源方式'),
          h(NiceSelect, {
            value: sourceForm.transport,
            align: 'right',
            options: [
              { value: 'local-dir', label: '本机文件夹' },
              { value: 'github-raw', label: 'GitHub 仓库' },
              { value: 'http-manifest', label: '网络题库地址' },
            ],
            onChange: transport => setSourceForm(c => ({ ...c, transport })),
          }))),
      h('div', { className: 'dsh-study-group' },
        h('span', { className: 'dsh-study-group-label' },
          sourceForm.transport === 'local-dir' ? '本机目录路径' : sourceForm.transport === 'github-raw' ? '仓库名称（如 DDNdles/USTC-Question-Bank）' : '网络地址（含 manifest.json 的目录链接）'),
        h('input', {
          className: 'dsh-study-input', required: true,
          placeholder: sourceForm.transport === 'local-dir'
            ? '例如：C:\\题库\\USTC-Question-Bank'
            : sourceForm.transport === 'github-raw'
              ? '例如：DDNdles/USTC-Question-Bank'
              : '例如：https://git.ustc.edu.cn/zzl_stella05/USTC-Question-Bank/-/raw/main/',
          value: sourceForm.location,
          onChange: e => setSourceForm(c => ({ ...c, location: e.target.value })),
        })),
      h('div', { className: 'dsh-study-row' },
        h('button', { type: 'submit', className: 'dsh-study-btn primary', disabled: state.busy }, '添加并获取课程'))) : null,

      ...uniqueSources.map(src => {
        const pickedForSrc = checkedCourses.filter(x => x.source_id === src.source_id)
        return h('section', { className: 'dsh-study-box dsh-study-stack', key: src.source_id },
          h('div', { className: 'dsh-study-between' },
            h('div', null,
              h('div', { className: 'dsh-study-row' },
                h('strong', { style: { fontSize: 14.5 } }, src.name),
                h('span', { className: 'dsh-study-tag' }, TRANSPORT_LABEL[src.transport] ?? '外部题库')),
              h('div', { className: 'dsh-study-muted', style: { marginTop: 2 } }, src.location)),
            h('div', { className: 'dsh-study-row' },
              h('button', {
                type: 'button', className: 'dsh-study-btn sm', disabled: state.busy,
                onClick: () => call('sourceInspect', { source_id: src.source_id }, `已获取「${src.name}」最新课程清单`),
              }, h(Icon.RefreshCw, { size: 14 }), '获取课程列表'),
              pickedForSrc.length ? h('button', {
                type: 'button', className: 'dsh-study-btn sm primary', disabled: state.busy,
                onClick: async () => {
                  await call('sourceSync', {
                    source_id: src.source_id,
                    course_codes: pickedForSrc.map(x => x.code),
                  }, `已完成 ${pickedForSrc.length} 门课程下载`)
                  setCheckedCourses(cur => cur.filter(x => x.source_id !== src.source_id))
                },
              }, h(Icon.Download, { size: 14 }), `下载所选（${pickedForSrc.length}）`) : null,
              !['ustc-official', 'ustc-gitlab'].includes(src.source_id) ? h('button', {
                type: 'button', className: 'dsh-study-icon-btn', title: '删除此题库源',
                onClick: () => call('sourceRemove', { source_id: src.source_id }, '已删除题库源'),
              }, h(Icon.Trash2, { size: 14 })) : null)),

          src.courses.length
            ? h('div', { className: 'dsh-study-table-wrap' },
              h('table', { className: 'dsh-study-table' },
                h('thead', null, h('tr', null,
                  h('th', { style: { width: 42 } }, '选择'),
                  h('th', null, '课程名称'),
                  h('th', { style: { width: 90 } }, '题目数'),
                  h('th', { style: { width: 110 } }, '状态'))),
                h('tbody', null, src.courses.map(c => {
                  const checked = checkedCourses.some(x => x.source_id === src.source_id && x.code === c.course_code)
                  return h('tr', { key: c.course_code },
                    h('td', null, h('input', {
                      type: 'checkbox', checked,
                      onChange: () => toggleCheckedCourse(src.source_id, c.course_code),
                    })),
                    h('td', null, h('span', { style: { fontWeight: 500 } }, c.course_name || c.course_code)),
                    h('td', null, `${c.total_questions} 题`),
                    h('td', null, c.installed
                      ? h('span', { className: 'dsh-study-tag ok' }, '已下载')
                      : h('span', { className: 'dsh-study-tag' }, '未下载')))
                }))))
            : null)
      }))

    // ---- 手动录错题精简弹窗 ----
    const addMistakeModal = showAddMistakeModal ? h('div', {
      className: 'dsh-study-modal-bg',
      onClick: e => { if (e.target === e.currentTarget) setShowAddMistakeModal(false) },
    }, h('form', {
      className: 'dsh-study-modal',
      onSubmit: async e => {
        e.preventDefault()
        const draft = await call('mistakeDraft', {
          question: createDraftQuestion(mistakeForm),
          error_tags: mistakeForm.error_tags,
          wrong_attempt_md: '',
          reflection_md: mistakeForm.reflection_md,
        })
        if (draft?.draft_id) {
          await call('mistakeCommit', { draft_id: draft.draft_id, confirmed: true }, '新错题已保存至错题本')
        }
        setMistakeForm(cur => ({ ...cur, stem: '', answer: '', solution: '', error_tags: [], reflection_md: '' }))
        setShowAddMistakeModal(false)
        setBankSubTab('mistakes')
      },
    },
    h('div', { className: 'dsh-study-between' },
      h('strong', { style: { fontSize: 15 } }, '手动录入错题'),
      h('button', { type: 'button', className: 'dsh-study-icon-btn', onClick: () => setShowAddMistakeModal(false) }, h(Icon.X, { size: 16 }))),
    h('div', { className: 'dsh-study-group' },
      h('span', { className: 'dsh-study-group-label' }, '所属课程'),
      installedCourses.length
        ? h(NiceSelect, {
          value: mistakeForm.course_code,
          placeholder: '选择所属课程',
          options: installedCourses.map(c => ({ value: c.code, label: c.name })),
          onChange: course_code => setMistakeForm(c => ({ ...c, course_code })),
        })
        : h('input', {
          className: 'dsh-study-input', required: true, placeholder: '输入课程代号（如 MATH1006）',
          value: mistakeForm.course_code,
          onChange: e => setMistakeForm(c => ({ ...c, course_code: e.target.value })),
        })),
    h('div', { className: 'dsh-study-group' },
      h('span', { className: 'dsh-study-group-label' }, '题目内容（支持 $LaTeX$ 公式）'),
      h('textarea', {
        className: 'dsh-study-textarea', required: true, placeholder: '粘贴或输入题干…',
        value: mistakeForm.stem,
        onChange: e => setMistakeForm(c => ({ ...c, stem: e.target.value })),
      })),
    h('div', { className: 'dsh-study-grid2' },
      h('div', { className: 'dsh-study-group' },
        h('span', { className: 'dsh-study-group-label' }, '参考答案'),
        h('textarea', {
          className: 'dsh-study-textarea', required: true, placeholder: '输入简明答案…',
          value: mistakeForm.answer,
          onChange: e => setMistakeForm(c => ({ ...c, answer: e.target.value })),
        })),
      h('div', { className: 'dsh-study-group' },
        h('span', { className: 'dsh-study-group-label' }, '解析过程'),
        h('textarea', {
          className: 'dsh-study-textarea', required: true, placeholder: '输入解题步骤…',
          value: mistakeForm.solution,
          onChange: e => setMistakeForm(c => ({ ...c, solution: e.target.value })),
        }))),
    h('div', { className: 'dsh-study-group' },
      h('span', { className: 'dsh-study-group-label' }, '错因标签（可选）'),
      h('div', { className: 'dsh-study-pills' },
        ERROR_TAG_PRESETS.map(tag => h('button', {
          key: tag, type: 'button', className: 'dsh-study-pill',
          'aria-pressed': mistakeForm.error_tags.includes(tag),
          onClick: () => setMistakeForm(c => ({
            ...c,
            error_tags: c.error_tags.includes(tag) ? c.error_tags.filter(x => x !== tag) : [...c.error_tags, tag],
          })),
        }, tag)))),
    h('div', { className: 'dsh-study-group' },
      h('span', { className: 'dsh-study-group-label' }, '反思笔记（可选，出卷时自动附在红字点评中）'),
      h('input', {
        className: 'dsh-study-input', placeholder: '记录卡壳点或易错提醒…',
        value: mistakeForm.reflection_md,
        onChange: e => setMistakeForm(c => ({ ...c, reflection_md: e.target.value })),
      })),
    h('div', { className: 'dsh-study-row', style: { justifyContent: 'flex-end' } },
      h('button', { type: 'button', className: 'dsh-study-btn ghost', onClick: () => setShowAddMistakeModal(false) }, '取消'),
      h('button', { type: 'submit', className: 'dsh-study-btn primary', disabled: state.busy }, '保存到错题本')))) : null

    return h('main', { className: 'dsh-study' },
      h('header', { className: 'dsh-study-head' },
        h('div', { className: 'dsh-study-head-left' },
          h('h1', { className: 'dsh-study-title' }, '学习'),
          h('nav', { className: 'dsh-study-tabs', role: 'tablist', 'aria-label': '学习工作台' },
            TABS.map(([id, label]) => h('button', {
              key: id, type: 'button', role: 'tab', className: 'dsh-study-tab',
              'aria-selected': tab === id, onClick: () => setTab(id),
            }, id === 'bank' && dueCount ? `${label} · ${dueCount}` : label))))),

      h('div', { className: 'dsh-study-body' },
        state.error ? h('div', { className: 'dsh-study-banner err', role: 'alert' },
          h('span', null, state.error),
          h('button', { type: 'button', className: 'dsh-study-icon-btn', onClick: clearMessages }, h(Icon.X, { size: 14 }))) : null,
        tab === 'quick' ? quickView : tab === 'bank' ? bankAndMistakeView : sourcesView),
      addMistakeModal)
  }

  // ============================================================================
  // 右侧会话抽屉（承接大模型 Skill 通道提交的待确认草稿）
  // ============================================================================

  function RightDrawer() {
    const [state, call] = useStudyData()
    return h('div', { className: 'dsh-study dsh-study-drawer' },
      h('div', { className: 'dsh-study-between' },
        h('strong', null, '错题草稿确认'),
        h('button', {
          type: 'button', className: 'dsh-study-icon-btn', title: '刷新',
          onClick: () => call('mistakeDraftList'),
        }, h(Icon.RefreshCw, { size: 14 }))),
      state.drafts.length
        ? state.drafts.map(draft => h('div', { className: 'dsh-study-box dsh-study-stack', key: draft.draft_id },
          h(RichMath, { text: draft.question.stem.md }),
          h('div', { className: 'dsh-study-muted' }, '答案：'),
          h(RichMath, { text: draft.question.answer.md }),
          h('div', { className: 'dsh-study-row' },
            h('button', {
              type: 'button', className: 'dsh-study-btn sm primary', disabled: state.busy,
              onClick: () => call('mistakeCommit', { draft_id: draft.draft_id, confirmed: true }, '已保存'),
            }, h(Icon.Check, { size: 14 }), '确认保存'),
            h('button', {
              type: 'button', className: 'dsh-study-btn sm ghost',
              onClick: () => call('mistakeDraftDismiss', { draft_id: draft.draft_id }),
            }, '忽略'))))
        : h('div', { className: 'dsh-study-empty' }, '暂无待确认错题'))
  }

  function RightTitle() {
    return h('span', null, '错题本')
  }

  // ---- 注入样式表与 KaTeX 样式（修复公式双重乱码） ----
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.plugin = PANEL_ID
    style.textContent = STYLE
    document.head.append(style)

    const katexLink = document.createElement('link')
    katexLink.rel = 'stylesheet'
    katexLink.href = '/api/dsh-study/katex?file=katex.min.css'
    katexLink.dataset.plugin = `${PANEL_ID}-katex`
    document.head.append(katexLink)

    return () => {
      style.remove()
      katexLink.remove()
    }
  })

  ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main', key: PANEL_ID, locale: NS,
    inject: () => ({ ctx }),
  }, Workspace)))

  ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist', id: PANEL_ID, order: 30, locale: NS,
    label: () => '学习',
  }, ({ size }) => h(Icon.BookOpen, { size: size ?? 16, strokeWidth: 1.9 }))))

  // 与官方斜杠指令对齐（带图标 + 中文主标签 + 二级快捷操作弹层）
  ctx.inject(['commandUi'], scope => {
    const command = scope.get('commandUi')
    if (typeof command?.register !== 'function') return
    scope.effect(() => command.register({
      name: 'study',
      label: () => '学习',
      description: () => '学习与出卷助手（智能出卷 / 录错题 / 讲评 PPT）',
      icon: ({ size = 14 }) => h(Icon.BookOpen, { size, strokeWidth: 1.85 }),
      available: () => true,
      ui: {
        kind: 'popupSelect',
        searchMode: 'substring',
        searchLabels: () => ({
          placeholder: '搜索学习操作…',
          empty: '暂无可用操作',
          noResults: '没有匹配的操作',
        }),
        options: async () => [
          { id: 'paper', label: '智能定制出卷', detail: '按自然语言需求筛题、写点评并导出 PDF', group: { name: '大模型协作' } },
          { id: 'mistake', label: '录入错题', detail: '支持文字或截图，匹配知识点并确认后入库', group: { name: '大模型协作' } },
          { id: 'review', label: '错题复盘与巩固出卷', detail: '分析错题本薄弱点并生成针对性巩固卷', group: { name: '大模型协作' } },
          { id: 'ppt', label: '制作讲评 PPT', detail: '生成含解析、易错点与点评的课件', group: { name: '大模型协作' } },
          { id: 'sources', label: '查看本地题库状态', detail: '查看已下载课程与题量统计', group: { name: '快捷入口' } },
          { id: 'panel', label: '打开「学习」工作台', detail: '切换到零模型一键出卷与题库管理', group: { name: '快捷入口' } },
        ],
        onSelect: async (option, session) => {
          if (option.id === 'panel') {
            setTimeout(() => {
              try {
                const layout = ctx.get?.('layout') ?? ctx.layout
                layout?.selectPanel?.(PANEL_ID)
              } catch {}
            }, 0)
            return
          }
          const prompts = {
            paper: '请帮我定制一份试卷：',
            mistake: '请帮我录入以下错题（可附截图或题目文字）：',
            review: '请分析我错题本中的薄弱知识点，并据此出一份针对性巩固试卷（PDF）',
            ppt: '请帮我制作一份讲评 PPT：',
            sources: '请查看我当前本地已下载的题库课程与题量统计',
          }
          const autoSubmit = option.id === 'review' || option.id === 'sources'
          const text = prompts[option.id]
          if (!text) return
          setTimeout(() => {
            try {
              const actx = scope.get('sessions')?.scope?.(session.sessionId)
              const conv = actx?.get?.('conversation')
              const input = conv?.input?.for?.(actx)
              if (input?.actions?.setDraft) {
                input.actions.setDraft(text)
                if (autoSubmit && input.actions.submit) {
                  setTimeout(() => input.actions.submit(), 20)
                }
              }
            } catch {}
          }, 0)
        },
      },
    }))
  })

  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: PANEL_ID, kind: 'dsh-study', priority: 'extension',
    title: () => '错题本',
  }))

  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab', key: PANEL_ID, locale: NS,
    inject: () => ({ ctx }),
  }, RightDrawer)))

  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab.title', key: PANEL_ID, locale: NS,
    inject: () => ({}),
  }, RightTitle)))
}

function normalizeExportRow(row) {
  return {
    ...row,
    artifacts: typeof row.artifacts_json === 'string' ? parseJson(row.artifacts_json) : (row.artifacts ?? {}),
  }
}

function friendlyError(error) {
  const raw = error instanceof Error ? error.message : String(error ?? '操作失败')
  if (/SHA-256 mismatch/i.test(raw)) return '题库文件校验未通过，已取消安装以保护本地数据'
  if (/Fetch failed/i.test(raw)) return '网络连接失败，请检查网络或配置下载加速镜像后重试'
  if (/ENOENT/i.test(raw)) return '未找到指定目录或 manifest.json 文件，请检查路径是否正确'
  return raw
}

function parseJson(value) {
  try { return JSON.parse(value) } catch { return {} }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[ch])
}

function stripLatexInline(text) {
  return String(text ?? '').replace(/\$+/g, '').replace(/\\[a-zA-Z]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function formatShortTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function createDraftQuestion(input) {
  const code = String(input.course_code || 'CUSTOM').trim()
  const today = new Date().toISOString().slice(0, 10).replaceAll('-', '')
  return {
    id: `${code}-personal-${today}-${crypto.randomUUID().slice(0, 8)}`,
    course_code: code,
    schema_version: '1.0',
    type: 'solve',
    stem: { md: input.stem, figures: [] },
    options: [],
    answer: { md: input.answer, figures: [], origin: 'official', origin_detail: '用户手动录入' },
    solution: { md: input.solution, steps: [], figures: [] },
    tags: { kp_ids: ['personal-general'], keywords: [], difficulty: 3 },
    source: {
      kind: 'notes', batch: 'personal_mistakes', ref: '个人错题录入',
      year: null, term: null, exam_kind: null, url: null, rights: 'original',
    },
    quality: {
      quarantined: false, quarantine_reason: null, confidence: null, note: null, overlap_hint: null,
    },
  }
}

function moveItem(items, from, to) {
  if (to < 0 || to >= items.length || from === to) return items
  const result = [...items]
  const [item] = result.splice(from, 1)
  result.splice(to, 0, item)
  return result
}
