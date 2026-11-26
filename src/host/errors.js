export function formatErrorMessage(error, fallback = '操作失败') {
  if (error == null) return fallback
  if (typeof error === 'string') return error.trim() || fallback
  if (error instanceof Error) {
    const parts = [error.message || error.name]
    if (error.cause) {
      const causeMsg = formatErrorMessage(error.cause, '')
      if (causeMsg && !parts[0]?.includes(causeMsg)) parts.push(`原因：${causeMsg}`)
    }
    return parts.filter(Boolean).join('；') || fallback
  }
  if (typeof error === 'object') {
    const candidates = [
      error.message,
      error.error?.message,
      error.reason instanceof Error ? error.reason.message : (typeof error.reason === 'string' ? error.reason : null),
      error.detail,
      error.statusText,
    ].filter(v => typeof v === 'string' && v.trim())
    if (candidates.length) {
      const code = typeof error.code === 'string' && error.code ? `[${error.code}] ` : ''
      return `${code}${candidates[0].trim()}`
    }
    try {
      const json = JSON.stringify(error)
      if (json && json !== '{}') return json.slice(0, 600)
    } catch {}
  }
  const str = String(error)
  return str === '[object Object]' ? fallback : str
}

export function createStageError(stage, error, extra = {}) {
  const message = formatErrorMessage(error, '执行失败')
  const wrapped = new Error(`[${stage}] ${message}`)
  wrapped.code = error?.code || `study/${stage}`
  wrapped.stage = stage
  wrapped.details = { ...(error?.details ?? {}), ...extra }
  if (error instanceof Error) wrapped.cause = error
  return wrapped
}

export function serializeError(error, defaultStage = '') {
  const stage = error?.stage || defaultStage || undefined
  const code = (typeof error?.code === 'string' && error.code) ? error.code : 'study/error'
  const message = formatErrorMessage(error, '操作失败')
  const details = (error?.details && typeof error.details === 'object') ? error.details : {}
  return {
    code,
    ...(stage ? { stage } : {}),
    message,
    details,
  }
}
