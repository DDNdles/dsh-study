import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'

const plainJson = (value: unknown) => value === undefined
  ? undefined
  : JSON.parse(JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item))

export class StudyRpcService extends TypertRemoteService {
  constructor(ctx: any, dispatch: Function) {
    super(ctx, 'dshStudy')
    this.dispatch = dispatch
  }

  dispatch: Function

  @Remote
  async call(endpoint: string, payload: Record<string, unknown>, signal: AbortSignal) {
    const peer = this.ctx.invocation?.peer
    if (!peer?.principal) {
      throw new RemoteError('study/unauthorized', 'An authenticated peer is required', {})
    }
    const result = await this.dispatch(endpoint, payload ?? {}, signal, peer)
    if (!result.ok) {
      throw new RemoteError(result.error.code, result.error.message, result.error.details ?? {})
    }
    return plainJson(result.data)
  }
}
