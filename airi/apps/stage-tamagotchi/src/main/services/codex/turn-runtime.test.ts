// Codex turn 런타임의 thread, 스트리밍, 도구와 승인 경계를 검증한다.
import type { CodexApprovalDecision, CodexBridgeEvent, CodexDynamicToolDescriptor, CodexTurnRequest } from './turn-runtime'
import type { CodexJsonRpcClient, JsonRpcNotification, JsonRpcServerRequest } from './types'

import { describe, expect, it, vi } from 'vitest'

import { createCodexTurnRuntime } from './turn-runtime'

interface RpcCall { method: string, params: unknown }
interface RuntimeHarness {
  calls: RpcCall[]
  emitNotification: (method: string, params: unknown) => void
  emitServerRequest: (method: string, id: number, params: unknown) => void
  events: CodexBridgeEvent[]
  request: CodexTurnRequest
  responses: Array<{ id: number, result: unknown }>
  errors: Array<{ id: number, code: number, message: string }>
  runtime: ReturnType<typeof createCodexTurnRuntime>
}
interface HarnessOptions { requestErrors?: Readonly<Record<string, Error>> }

const dynamicTool: CodexDynamicToolDescriptor = {
  type: 'function',
  name: 'remember',
  description: 'Persists durable user context.',
  inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
}

function createRuntimeHarness(options: HarnessOptions = {}): RuntimeHarness {
  const calls: RpcCall[] = []
  const events: CodexBridgeEvent[] = []
  const notificationHandlers = new Set<(message: JsonRpcNotification) => void>()
  const serverRequestHandlers = new Set<(message: JsonRpcServerRequest) => void>()
  const responses: Array<{ id: number, result: unknown }> = []
  const errors: Array<{ id: number, code: number, message: string }> = []
  const rpc: CodexJsonRpcClient = {
    async request<T>(method: string, params: unknown): Promise<T> {
      calls.push({ method, params })
      const error = options.requestErrors?.[method]
      if (error !== undefined)
        throw error
      if (method === 'thread/start' || method === 'thread/resume')
        return { thread: { id: 'thr-1' } } as T
      if (method === 'turn/start')
        return { turn: { id: 'turn-1' } } as T
      return {} as T
    },
    respond(id, result) {
      responses.push({ id, result })
    },
    respondError(id, error) {
      errors.push({ id, code: error.code, message: error.message })
    },
    notify(method, params) { calls.push({ method, params }) },
    onNotification(handler) {
      notificationHandlers.add(handler)
      return () => notificationHandlers.delete(handler)
    },
    onServerRequest(handler) {
      serverRequestHandlers.add(handler)
      return () => serverRequestHandlers.delete(handler)
    },
  }
  const runtime = createCodexTurnRuntime({ manager: { async ensureStarted() {}, getRpc: () => rpc } })
  return {
    calls,
    emitNotification(method, params) {
      for (const handler of notificationHandlers)
        handler({ method, params })
    },
    emitServerRequest(method, id, params) {
      for (const handler of serverRequestHandlers)
        handler({ method, id, params })
    },
    events,
    request: createRequest(),
    responses,
    errors,
    runtime,
  }
}

function createRequest(overrides: Partial<CodexTurnRequest> = {}): CodexTurnRequest {
  return { developerInstructions: 'You are Neru.', dynamicTools: [dynamicTool], overrides: {}, streamId: 'stream-1', userInput: 'Hello, Neru.', ...overrides } as CodexTurnRequest
}

async function waitForTurnStart(harness: RuntimeHarness): Promise<void> {
  await vi.waitFor(() => {
    expect(harness.calls).toContainEqual(expect.objectContaining({ method: 'turn/start' }))
  })
}

function completeTurn(harness: RuntimeHarness, status: 'completed' | 'interrupted' = 'completed'): void {
  harness.emitNotification('turn/completed', { threadId: 'thr-1', turn: { id: 'turn-1', status } })
}

async function beginTurn(harness: RuntimeHarness): Promise<{ running: Promise<{ threadId: string }> }> {
  const running = harness.runtime.startTurn(harness.request, event => harness.events.push(event))
  await waitForTurnStart(harness)
  return { running }
}

describe('createCodexTurnRuntime', () => {
  it('inherits runtime settings by omitting unset RPC fields', async () => {
    const harness = createRuntimeHarness()
    const running = harness.runtime.startTurn(harness.request, event => harness.events.push(event))
    await waitForTurnStart(harness)
    expect(harness.calls).toContainEqual({ method: 'thread/start', params: { developerInstructions: 'You are Neru.', dynamicTools: [dynamicTool] } })
    expect(harness.calls).toContainEqual({ method: 'turn/start', params: { threadId: 'thr-1', input: [{ type: 'text', text: 'Hello, Neru.' }] } })
    completeTurn(harness)
    await expect(running).resolves.toEqual({ threadId: 'thr-1' })
  })

  it('sends only explicit runtime overrides', async () => {
    const harness = createRuntimeHarness()
    const running = harness.runtime.startTurn(createRequest({
      threadId: 'thr-saved',
      overrides: {
        model: 'gpt-x',
        effort: 'high',
        serviceTier: 'fast',
        cwd: 'C:/repo',
        sandbox: 'readOnly',
        approvalPolicy: 'onRequest',
        approvalsReviewer: 'auto_review',
      },
    } as Partial<CodexTurnRequest>), () => {})
    await waitForTurnStart(harness)
    expect(harness.calls).toContainEqual({ method: 'thread/resume', params: { threadId: 'thr-saved', cwd: 'C:/repo', sandbox: 'readOnly', approvalPolicy: 'onRequest', approvalsReviewer: 'auto_review', developerInstructions: 'You are Neru.', dynamicTools: [dynamicTool], model: 'gpt-x' } })
    expect(harness.calls).toContainEqual({ method: 'turn/start', params: { threadId: 'thr-1', input: [{ type: 'text', text: 'Hello, Neru.' }], cwd: 'C:/repo', sandboxPolicy: { type: 'readOnly' }, approvalPolicy: 'onRequest', approvalsReviewer: 'auto_review', model: 'gpt-x', effort: 'high', serviceTier: 'fast' } })
    completeTurn(harness)
    await running
  })

  it('streams only matching turn deltas and completes the matching stream', async () => {
    const harness = createRuntimeHarness()
    const running = harness.runtime.startTurn(harness.request, event => harness.events.push(event))
    await waitForTurnStart(harness)
    harness.emitNotification('item/agentMessage/delta', { threadId: 'thr-other', turnId: 'turn-other', delta: 'Ignore' })
    harness.emitNotification('item/agentMessage/delta', { threadId: 'thr-1', turnId: 'turn-1', delta: 'Hello' })
    completeTurn(harness)
    await expect(running).resolves.toEqual({ threadId: 'thr-1' })
    expect(harness.events).toEqual([{ type: 'text-delta', streamId: 'stream-1', threadId: 'thr-1', turnId: 'turn-1', text: 'Hello' }, { type: 'finish', streamId: 'stream-1', threadId: 'thr-1', turnId: 'turn-1' }])
  })

  it('interrupts only the requested active stream', async () => {
    const harness = createRuntimeHarness()
    const running = harness.runtime.startTurn(harness.request, event => harness.events.push(event))
    await waitForTurnStart(harness)
    await harness.runtime.interrupt('stream-1')
    completeTurn(harness, 'interrupted')
    await expect(running).resolves.toEqual({ threadId: 'thr-1' })
    expect(harness.calls).toContainEqual({ method: 'turn/interrupt', params: { threadId: 'thr-1', turnId: 'turn-1' } })
    expect(harness.events).toContainEqual({ type: 'interrupted', streamId: 'stream-1', threadId: 'thr-1', turnId: 'turn-1' })
  })

  it('forwards dynamic tools and returns content items to the app-server', async () => {
    const harness = createRuntimeHarness()
    const running = harness.runtime.startTurn(harness.request, event => harness.events.push(event))
    await waitForTurnStart(harness)
    harness.emitServerRequest('item/tool/call', 60, { threadId: 'thr-1', turnId: 'turn-1', callId: 'call-1', tool: 'remember', arguments: { text: 'x' } })
    harness.runtime.resolveToolCall('call-1', { success: true, text: 'Saved.' })
    expect(harness.events).toContainEqual({ type: 'tool-call-request', streamId: 'stream-1', threadId: 'thr-1', turnId: 'turn-1', callId: 'call-1', tool: 'remember', arguments: { text: 'x' } })
    expect(harness.responses).toContainEqual({ id: 60, result: { contentItems: [{ type: 'inputText', text: 'Saved.' }], success: true } })
    completeTurn(harness)
    await running
  })

  it('rejects duplicate tool calls without replacing or answering the original pending request twice', async () => {
    const harness = createRuntimeHarness()
    const { running } = await beginTurn(harness)
    const request = { threadId: 'thr-1', turnId: 'turn-1', callId: 'call-1', tool: 'remember' }

    harness.emitServerRequest('item/tool/call', 75, request)
    harness.emitServerRequest('item/tool/call', 76, request)
    harness.runtime.resolveToolCall('call-1', { success: true, text: 'Saved.' })
    harness.runtime.resolveToolCall('call-1', { success: true, text: 'must not reply again' })

    expect(harness.errors).toContainEqual({ id: 76, code: -32600, message: 'Invalid Codex server request.' })
    expect(harness.responses.filter(response => response.id === 75)).toEqual([
      { id: 75, result: { contentItems: [{ type: 'inputText', text: 'Saved.' }], success: true } },
    ])
    completeTurn(harness)
    await running
  })

  it('rejects a second turn for the same thread while the first stream is active', async () => {
    const harness = createRuntimeHarness()
    const { running } = await beginTurn(harness)

    await expect(harness.runtime.startTurn(createRequest({ streamId: 'stream-2' }), () => {})).rejects.toThrow('Codex turn is already active for this thread.')

    completeTurn(harness)
    await running
  })

  it.each([
    ['item/commandExecution/requestApproval', 'accept', { decision: 'accept' }],
    ['item/fileChange/requestApproval', 'acceptForSession', { decision: 'acceptForSession' }],
    ['item/commandExecution/requestApproval', 'decline', { decision: 'decline' }],
  ] as const)('maps %s approval decision %s exactly', async (method, decision, expected) => {
    const harness = createRuntimeHarness()
    const { running } = await beginTurn(harness)
    harness.emitServerRequest(method, 61, { threadId: 'thr-1', turnId: 'turn-1', command: 'git status' })
    harness.runtime.resolveApproval('61', createDecision(decision))
    expect(harness.responses).toContainEqual({ id: 61, result: expected })
    completeTurn(harness)
    await running
  })

  it('returns only the requested permission subset and adds session scope only when selected', async () => {
    const harness = createRuntimeHarness()
    const { running } = await beginTurn(harness)
    const requestedPermissions = { fileSystem: { write: ['C:/repo', 'C:/outside'] }, network: { domains: ['api.openai.com'] } }
    harness.emitServerRequest('item/permissions/requestApproval', 62, { threadId: 'thr-1', turnId: 'turn-1', permissions: requestedPermissions })
    expect(harness.events).toContainEqual({
      type: 'approval-request',
      streamId: 'stream-1',
      threadId: 'thr-1',
      turnId: 'turn-1',
      requestId: '62',
      approvalType: 'permissions',
      request: { threadId: 'thr-1', turnId: 'turn-1', permissions: requestedPermissions },
    })
    harness.runtime.resolveApproval('62', { type: 'acceptForSession', permissions: { fileSystem: { write: ['C:/repo', 'C:/not-requested'] }, network: { domains: ['other.example'] } } })
    expect(harness.responses).toContainEqual({ id: 62, result: { permissions: { fileSystem: { write: ['C:/repo'] } }, scope: 'session' } })
    completeTurn(harness)
    await running
  })

  it('declines permission approvals without returning permissions', async () => {
    const harness = createRuntimeHarness()
    const { running } = await beginTurn(harness)
    harness.emitServerRequest('item/permissions/requestApproval', 63, { threadId: 'thr-1', turnId: 'turn-1', permissions: { fileSystem: { write: ['C:/repo'] } } })
    harness.runtime.resolveApproval('63', createDecision('decline'))
    expect(harness.responses).toContainEqual({ id: 63, result: { permissions: {} } })
    completeTurn(harness)
    await running
  })

  it('declines unknown server requests instead of approving them', async () => {
    const harness = createRuntimeHarness()
    const { running } = await beginTurn(harness)
    harness.emitServerRequest('account/delete/requestApproval', 64, {})
    expect(harness.errors).toContainEqual({ id: 64, code: -32601, message: 'Unsupported Codex server request.' })
    completeTurn(harness)
    await running
  })

  it('rejects failed completions without exposing the server error', async () => {
    const harness = createRuntimeHarness()
    const running = harness.runtime.startTurn(harness.request, event => harness.events.push(event))
    await waitForTurnStart(harness)
    harness.emitNotification('turn/completed', { threadId: 'thr-1', turn: { id: 'turn-1', status: 'failed' }, error: 'secret server detail' })

    await expect(running).rejects.toThrow('Codex turn failed.')
    expect(harness.events).toContainEqual({ type: 'error', streamId: 'stream-1', threadId: 'thr-1', turnId: 'turn-1', message: 'Codex turn failed.' })
  })

  it('rejects malformed tool requests and excludes dangerous permission keys', async () => {
    const harness = createRuntimeHarness()
    const { running } = await beginTurn(harness)
    harness.emitServerRequest('item/tool/call', 65, { threadId: 'thr-1', turnId: 'turn-1', callId: '', tool: 'remember' })
    expect(harness.errors).toContainEqual({ id: 65, code: -32600, message: 'Invalid Codex server request.' })
    harness.emitServerRequest('item/tool/call', 67, { threadId: 'thr-1', turnId: 'turn-1', callId: 'invalid-json', tool: 'remember', arguments: () => {} })
    expect(harness.errors).toContainEqual({ id: 67, code: -32600, message: 'Invalid Codex server request.' })
    harness.emitServerRequest('item/permissions/requestApproval', 66, { threadId: 'thr-1', turnId: 'turn-1', permissions: { fileSystem: { write: ['C:/repo'] } } })
    harness.runtime.resolveApproval('66', { type: 'accept', permissions: { fileSystem: { write: ['C:/repo'] }, __proto__: { polluted: true } } })
    expect(harness.responses).toContainEqual({ id: 66, result: { permissions: { fileSystem: { write: ['C:/repo'] } } } })
    expect(Object.hasOwn({}, 'polluted')).toBe(false)
    completeTurn(harness)
    await running
  })

  it('fails a stream with a fixed bridge error when a terminal notification is malformed', async () => {
    const harness = createRuntimeHarness()
    const { running } = await beginTurn(harness)

    harness.emitNotification('turn/completed', { threadId: 'thr-1', turn: { id: 'turn-1' } })

    await expect(running).rejects.toThrow('Codex turn failed.')
    expect(harness.events).toContainEqual({
      type: 'error',
      streamId: 'stream-1',
      threadId: 'thr-1',
      turnId: 'turn-1',
      message: 'Codex turn failed.',
    })
  })

  it('keeps two concurrent streams and their server requests isolated by thread and turn', async () => {
    const harness = createSessionHarness()
    const firstEvents: CodexBridgeEvent[] = []
    const secondEvents: CodexBridgeEvent[] = []
    const first = harness.runtime.startTurn(createRequest({ streamId: 'stream-1' }), event => firstEvents.push(event))
    const second = harness.runtime.startTurn(createRequest({ streamId: 'stream-2' }), event => secondEvents.push(event))

    await vi.waitFor(() => expect(harness.rpc.calls.filter(call => call.method === 'turn/start')).toHaveLength(2))
    harness.rpc.emitServerRequest('item/tool/call', 71, { threadId: 'thr-1', turnId: 'turn-1', callId: 'call-1', tool: 'remember', arguments: { text: 'one' } })
    harness.rpc.emitServerRequest('item/fileChange/requestApproval', 72, { threadId: 'thr-2', turnId: 'turn-2', changes: [] })

    expect(firstEvents).toContainEqual(expect.objectContaining({ type: 'tool-call-request', streamId: 'stream-1', threadId: 'thr-1', turnId: 'turn-1' }))
    expect(firstEvents).not.toContainEqual(expect.objectContaining({ type: 'approval-request' }))
    expect(secondEvents).toContainEqual(expect.objectContaining({ type: 'approval-request', streamId: 'stream-2', threadId: 'thr-2', turnId: 'turn-2' }))
    expect(secondEvents).not.toContainEqual(expect.objectContaining({ type: 'tool-call-request' }))

    harness.runtime.resolveToolCall('call-1', { success: true, text: 'Saved.' })
    harness.runtime.resolveApproval('72', { type: 'accept' })
    expect(harness.rpc.responses).toContainEqual({ id: 71, result: { contentItems: [{ type: 'inputText', text: 'Saved.' }], success: true } })
    expect(harness.rpc.responses).toContainEqual({ id: 72, result: { decision: 'accept' } })

    harness.rpc.emitNotification('turn/completed', { threadId: 'thr-1', turn: { id: 'turn-1', status: 'completed' } })
    harness.rpc.emitNotification('turn/completed', { threadId: 'thr-2', turn: { id: 'turn-2', status: 'completed' } })
    await expect(first).resolves.toEqual({ threadId: 'thr-1' })
    await expect(second).resolves.toEqual({ threadId: 'thr-2' })
  })

  it('binds the official started notification before the delayed turn response', async () => {
    const harness = createSessionHarness({ deferTurnStart: true })
    const events: CodexBridgeEvent[] = []
    const running = harness.runtime.startTurn(createRequest(), event => events.push(event))
    await vi.waitFor(() => expect(harness.rpc.calls).toContainEqual(expect.objectContaining({ method: 'turn/start' })))

    harness.rpc.emitNotification('turn/started', { threadId: 'thr-1', turn: { id: 'turn-1' } })
    harness.rpc.emitNotification('item/agentMessage/delta', { threadId: 'thr-1', turnId: 'turn-1', delta: 'early' })
    harness.rpc.emitNotification('turn/completed', { threadId: 'thr-1', turn: { id: 'turn-1', status: 'completed' } })
    harness.rpc.resolveTurnStart?.({ turn: { id: 'turn-1' } })

    await expect(running).resolves.toEqual({ threadId: 'thr-1' })
    expect(events).toEqual([
      { type: 'text-delta', streamId: 'stream-1', threadId: 'thr-1', turnId: 'turn-1', text: 'early' },
      { type: 'finish', streamId: 'stream-1', threadId: 'thr-1', turnId: 'turn-1' },
    ])
  })

  it('rejects active streams and clears pending UI responses when the manager stops', async () => {
    const harness = createSessionHarness()
    const running = harness.runtime.startTurn(createRequest(), () => {})
    await vi.waitFor(() => expect(harness.rpc.calls).toContainEqual(expect.objectContaining({ method: 'turn/start' })))
    harness.rpc.emitServerRequest('item/tool/call', 73, { threadId: 'thr-1', turnId: 'turn-1', callId: 'stopped-call', tool: 'remember' })

    harness.emitStatus('stopped')
    harness.runtime.resolveToolCall('stopped-call', { success: true, text: 'must not reply' })

    await expect(running).rejects.toThrow('Codex app-server stopped.')
    expect(harness.rpc.responses).toEqual([])
    expect(harness.rpc.notificationHandlers.size).toBe(0)
    expect(harness.rpc.serverRequestHandlers.size).toBe(0)
  })

  it('unsubscribes a replaced RPC session and never answers its stale pending request', async () => {
    const oldRpc = createSessionRpc({})
    const replacementRpc = createSessionRpc({})
    let currentRpc: CodexJsonRpcClient = oldRpc.rpc
    const runtime = createCodexTurnRuntime({
      manager: {
        async ensureStarted() {},
        getRpc: () => currentRpc,
      },
    })
    const oldRunning = runtime.startTurn(createRequest(), () => {})
    const oldRejected = expect(oldRunning).rejects.toThrow('Codex app-server connection changed.')
    await vi.waitFor(() => expect(oldRpc.calls).toContainEqual(expect.objectContaining({ method: 'turn/start' })))
    oldRpc.emitServerRequest('item/permissions/requestApproval', 74, { threadId: 'thr-1', turnId: 'turn-1', permissions: { fileSystem: { write: ['C:/repo'] } } })

    currentRpc = replacementRpc.rpc
    const replacementRunning = runtime.startTurn(createRequest({ streamId: 'stream-2' }), () => {})
    await vi.waitFor(() => expect(replacementRpc.calls).toContainEqual(expect.objectContaining({ method: 'turn/start' })))
    runtime.resolveApproval('74', { type: 'accept', permissions: { fileSystem: { write: ['C:/repo'] } } })

    await oldRejected
    expect(oldRpc.notificationHandlers.size).toBe(0)
    expect(oldRpc.serverRequestHandlers.size).toBe(0)
    expect(oldRpc.responses).toEqual([])
    replacementRpc.emitNotification('turn/completed', { threadId: 'thr-1', turn: { id: 'turn-1', status: 'completed' } })
    await replacementRunning
  })

  it('reports stale-thread resume failure and never starts a replacement thread', async () => {
    const harness = createRuntimeHarness({ requestErrors: { 'thread/resume': new Error('Thread not found.') } })
    await expect(harness.runtime.startTurn(createRequest({ threadId: 'thr-stale' }), event => harness.events.push(event))).rejects.toThrow('Thread not found.')
    expect(harness.events).toContainEqual({ type: 'thread-resume-failed', streamId: 'stream-1', threadId: 'thr-stale' })
    expect(harness.calls).not.toContainEqual(expect.objectContaining({ method: 'thread/start' }))
  })
})

function createDecision(type: CodexApprovalDecision['type']): CodexApprovalDecision {
  return { type }
}

interface SessionRpcHarness {
  calls: RpcCall[]
  emitNotification: (method: string, params: unknown) => void
  emitServerRequest: (method: string, id: number, params: unknown) => void
  errors: Array<{ id: number, code: number, message: string }>
  notificationHandlers: Set<(message: JsonRpcNotification) => void>
  responses: Array<{ id: number, result: unknown }>
  resolveTurnStart?: (value: unknown) => void
  rpc: CodexJsonRpcClient
  serverRequestHandlers: Set<(message: JsonRpcServerRequest) => void>
}

function createSessionHarness(options: { deferTurnStart?: boolean } = {}): {
  emitStatus: (process: 'stopped' | 'running') => void
  rpc: SessionRpcHarness
  runtime: ReturnType<typeof createCodexTurnRuntime>
} {
  const rpc = createSessionRpc(options)
  const statusHandlers = new Set<(status: { process: 'stopped' | 'running' }) => void>()
  const runtime = createCodexTurnRuntime({
    manager: {
      async ensureStarted() {},
      getRpc: () => rpc.rpc,
      onStatusChange(handler) {
        statusHandlers.add(handler)
        return () => statusHandlers.delete(handler)
      },
    },
  })
  return {
    emitStatus(process) {
      for (const handler of statusHandlers)
        handler({ process })
    },
    rpc,
    runtime,
  }
}

function createSessionRpc(options: { deferTurnStart?: boolean }): SessionRpcHarness {
  const calls: RpcCall[] = []
  const errors: Array<{ id: number, code: number, message: string }> = []
  const notificationHandlers = new Set<(message: JsonRpcNotification) => void>()
  const responses: Array<{ id: number, result: unknown }> = []
  const serverRequestHandlers = new Set<(message: JsonRpcServerRequest) => void>()
  let nextThread = 1
  let resolveTurnStart: ((value: unknown) => void) | undefined
  const rpc: CodexJsonRpcClient = {
    async request<T>(method: string, params: unknown): Promise<T> {
      calls.push({ method, params })
      if (method === 'thread/start' || method === 'thread/resume')
        return { thread: { id: `thr-${nextThread++}` } } as T
      if (method === 'turn/start') {
        if (options.deferTurnStart) {
          return new Promise<T>((resolve) => {
            resolveTurnStart = value => resolve(value as T)
          })
        }
        const threadId = isRecord(params) && typeof params.threadId === 'string' ? params.threadId : ''
        return { turn: { id: `turn-${threadId.replace('thr-', '')}` } } as T
      }
      return {} as T
    },
    respond(id, result) {
      responses.push({ id, result })
    },
    respondError(id, error) {
      errors.push({ id, code: error.code, message: error.message })
    },
    notify(method, params) {
      calls.push({ method, params })
    },
    onNotification(handler) {
      notificationHandlers.add(handler)
      return () => notificationHandlers.delete(handler)
    },
    onServerRequest(handler) {
      serverRequestHandlers.add(handler)
      return () => serverRequestHandlers.delete(handler)
    },
  }
  return {
    calls,
    emitNotification(method, params) {
      for (const handler of notificationHandlers)
        handler({ method, params })
    },
    emitServerRequest(method, id, params) {
      for (const handler of serverRequestHandlers)
        handler({ method, id, params })
    },
    errors,
    notificationHandlers,
    responses,
    resolveTurnStart: value => resolveTurnStart?.(value),
    rpc,
    serverRequestHandlers,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
