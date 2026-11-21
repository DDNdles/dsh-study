export async function runProcess(subprocess, argv, {
  cwd, signal, timeoutMs = 60_000, check = true,
} = {}) {
  if (!subprocess) throw new Error('DSH subprocess service is unavailable')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(new Error(`Subprocess timed out after ${timeoutMs}ms`)), timeoutMs)
  const abort = () => controller.abort(signal.reason ?? new Error('Subprocess was cancelled'))
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) abort()

  let handle
  try {
    handle = subprocess.spawn({
      argv,
      cwd,
      stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
      graceMs: 2_000,
      signal: controller.signal,
    })
    const capture = stream => new Promise((resolve, reject) => {
      if (!stream) return resolve('')
      const chunks = []
      let size = 0
      stream.on('data', chunk => {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        chunks.push(bytes)
        size += bytes.length
        while (size > 1_000_000 && chunks.length) {
          const excess = size - 1_000_000
          if (chunks[0].length <= excess) size -= chunks.shift().length
          else {
            chunks[0] = chunks[0].subarray(excess)
            size -= excess
          }
        }
      })
      stream.on('end', () => resolve(Buffer.concat(chunks, size).toString('utf8')))
      stream.on('error', reject)
    })
    const completion = handle.done ?? handle.waitForExit()
    const [stdout, stderr, status] = await Promise.all([
      capture(handle.stdout), capture(handle.stderr), completion,
    ])
    if (controller.signal.aborted) throw controller.signal.reason
    const exitCode = typeof status === 'number' ? status : status?.exitCode ?? status?.code ?? null
    if (check && exitCode !== 0) {
      const detail = `${stderr}\n${stdout}`.trim().slice(-4000)
      throw new Error(`Command failed (${exitCode ?? 'unknown exit'}): ${argv[0]}${detail ? `\n${detail}` : ''}`)
    }
    return { stdout, stderr, exitCode }
  } catch (error) {
    if (handle) {
      handle.terminate?.()
      await (handle.waitForExit?.() ?? handle.done)?.catch?.(() => {})
    }
    if (controller.signal.aborted) throw controller.signal.reason ?? error
    throw error
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', abort)
  }
}
