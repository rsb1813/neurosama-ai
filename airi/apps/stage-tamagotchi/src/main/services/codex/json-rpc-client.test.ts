// Codex JSON-RPC 클라이언트의 요청 상관관계와 수명주기를 검증한다.
import type { CodexLineIo } from './types'

import { describe, expect, it } from 'vitest'

import { createCodexJsonRpcClient } from './json-rpc-client'

interface FakeLineIo extends CodexLineIo {
  readonly writes: unknown[]
  push: (message: unknown) => void
  pushLine: (line: string) => void
  exit: (code: number | null) => void
  respondWhileWriting?: (message: unknown) => void
  writeError?: Error
}

function createFakeLineIo(): FakeLineIo {
  const lineHandlers = new Set<(line: string) => void>()
  const exitHandlers = new Set<(code: number | null) => void>()
  const writes: unknown[] = []

  return {
    writes,
    write(message) {
      if (this.writeError !== undefined)
        throw this.writeError
      writes.push(message)
      this.respondWhileWriting?.(message)
    },
    onLine(handler) {
      lineHandlers.add(handler)
      return () => lineHandlers.delete(handler)
    },
    onExit(handler) {
      exitHandlers.add(handler)
      return () => exitHandlers.delete(handler)
    },
    push(message) {
      for (const handler of lineHandlers)
        handler(JSON.stringify(message))
    },
    pushLine(line) {
      for (const handler of lineHandlers)
        handler(line)
    },
    exit(code) {
      for (const handler of exitHandlers)
        handler(code)
    },
  }
}

describe('createCodexJsonRpcClient', () => {
  it('returns fixed JSON-RPC errors for unsupported server requests', () => {
    const io = createFakeLineIo()
    const client = createCodexJsonRpcClient(io)

    client.respondError(61, { code: -32601, message: 'Unsupported Codex server request.' })

    expect(io.writes).toContainEqual({ id: 61, error: { code: -32601, message: 'Unsupported Codex server request.' } })
  })

  it('matches responses and exposes notifications and server requests', async () => {
    const io = createFakeLineIo()
    const client = createCodexJsonRpcClient(io)
    const notifications: unknown[] = []
    const serverRequests: unknown[] = []
    client.onNotification(message => notifications.push(message))
    client.onServerRequest(message => serverRequests.push(message))

    const pending = client.request<{ account: null }>('account/read', { refreshToken: false })
    io.push({ method: 'thread/started', params: { id: 'thread-1' } })
    io.push({ id: 42, method: 'approval/requested', params: { command: 'git status' } })
    io.push({ id: 1, result: { account: null } })

    await expect(pending).resolves.toEqual({ account: null })
    expect(io.writes).toEqual([{ id: 1, method: 'account/read', params: { refreshToken: false } }])
    expect(notifications).toEqual([{ method: 'thread/started', params: { id: 'thread-1' } }])
    expect(serverRequests).toEqual([{ id: 42, method: 'approval/requested', params: { command: 'git status' } }])
  })

  it('registers a pending request before synchronous line delivery', async () => {
    const io = createFakeLineIo()
    io.respondWhileWriting = (message) => {
      if (isRequestMessage(message))
        io.push({ id: message.id, result: 'ready' })
    }
    const client = createCodexJsonRpcClient(io)

    await expect(client.request<string>('initialize', {})).resolves.toBe('ready')
  })

  it('writes notifications without a request id', () => {
    const io = createFakeLineIo()
    const client = createCodexJsonRpcClient(io)

    client.notify('initialized', {})

    expect(io.writes).toEqual([{ method: 'initialized', params: {} }])
  })

  it('rejects write failures without retaining a request for later messages or exit', async () => {
    const io = createFakeLineIo()
    const client = createCodexJsonRpcClient(io)
    io.writeError = new Error('broken pipe')

    await expect(client.request('thread/start', {})).rejects.toThrow('broken pipe')

    io.writeError = undefined
    io.push({ id: 1, result: 'late response' })
    io.exit(1)

    await expect(client.request('thread/start', {})).rejects.toThrow('Codex app-server exited')
    expect(io.writes).toEqual([])
  })

  it('ignores malformed lines and responses without a matching request', async () => {
    const io = createFakeLineIo()
    const client = createCodexJsonRpcClient(io)
    const pending = client.request<string>('account/read', {})

    io.pushLine('{not-json')
    io.push({ id: 999, result: 'ignored' })
    io.push({ id: 1, result: 'matched' })

    await expect(pending).resolves.toBe('matched')
  })

  it('rejects all pending calls when the process exits and rejects later requests', async () => {
    const io = createFakeLineIo()
    const client = createCodexJsonRpcClient(io)
    const first = client.request('thread/start', {})
    const second = client.request('account/read', {})

    io.exit(1)

    await expect(first).rejects.toThrow('Codex app-server exited')
    await expect(second).rejects.toThrow('Codex app-server exited')
    await expect(client.request('thread/start', {})).rejects.toThrow('Codex app-server exited')
  })
})

function isRequestMessage(message: unknown): message is { id: number } {
  return typeof message === 'object'
    && message !== null
    && 'id' in message
    && typeof message.id === 'number'
}
