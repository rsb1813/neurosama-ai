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
    runtime,
  }
}

function createRequest(overrides: Partial<CodexTurnRequest> = {}): CodexTurnRequest {
  return { cwd: 'C:/repo', developerInstructions: 'You are Neru.', dynamicTools: [dynamicTool], model: 'gpt-5-codex', streamId: 'stream-1', userInput: 'Hello, Neru.', ...overrides }
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
  it('starts a workspace-scoped thread with top-level developer instructions and tools', async () => {
    const harness = createRuntimeHarness()
    const running = harness.runtime.startTurn(harness.request, event => harness.events.push(event))
    await waitForTurnStart(harness)
    expect(harness.calls).toContainEqual({ method: 'thread/start', params: { cwd: 'C:/repo', sandbox: 'workspaceWrite', approvalPolicy: 'unlessTrusted', developerInstructions: 'You are Neru.', dynamicTools: [dynamicTool], model: 'gpt-5-codex' } })
    expect(harness.calls).toContainEqual({ method: 'turn/start', params: { threadId: 'thr-1', input: [{ type: 'text', text: 'Hello, Neru.' }] } })
    completeTurn(harness)
    await expect(running).resolves.toEqual({ threadId: 'thr-1' })
  })

  it('resumes the stored thread and omits the configured-model sentinel', async () => {
    const harness = createRuntimeHarness()
    const running = harness.runtime.startTurn(createRequest({ model: 'codex-configured', threadId: 'thr-saved' }), () => {})
    await waitForTurnStart(harness)
    expect(harness.calls).toContainEqual({ method: 'thread/resume', params: { threadId: 'thr-saved', cwd: 'C:/repo', sandbox: 'workspaceWrite', approvalPolicy: 'unlessTrusted', developerInstructions: 'You are Neru.', dynamicTools: [dynamicTool] } })
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
    expect(harness.events).toEqual([{ type: 'text-delta', streamId: 'stream-1', text: 'Hello' }, { type: 'finish', streamId: 'stream-1', threadId: 'thr-1' }])
  })

  it('interrupts only the requested active stream', async () => {
    const harness = createRuntimeHarness()
    const running = harness.runtime.startTurn(harness.request, event => harness.events.push(event))
    await waitForTurnStart(harness)
    await harness.runtime.interrupt('stream-1')
    completeTurn(harness, 'interrupted')
    await expect(running).resolves.toEqual({ threadId: 'thr-1' })
    expect(harness.calls).toContainEqual({ method: 'turn/interrupt', params: { threadId: 'thr-1', turnId: 'turn-1' } })
    expect(harness.events).toContainEqual({ type: 'interrupted', streamId: 'stream-1', threadId: 'thr-1' })
  })

  it('forwards dynamic tools and returns content items to the app-server', async () => {
    const harness = createRuntimeHarness()
    const running = harness.runtime.startTurn(harness.request, event => harness.events.push(event))
    await waitForTurnStart(harness)
    harness.emitServerRequest('item/tool/call', 60, { callId: 'call-1', tool: 'remember', arguments: { text: 'x' } })
    harness.runtime.resolveToolCall('call-1', { success: true, text: 'Saved.' })
    expect(harness.events).toContainEqual({ type: 'tool-call-request', callId: 'call-1', tool: 'remember', arguments: { text: 'x' } })
    expect(harness.responses).toContainEqual({ id: 60, result: { contentItems: [{ type: 'inputText', text: 'Saved.' }], success: true } })
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
    harness.emitServerRequest(method, 61, { command: 'git status' })
    harness.runtime.resolveApproval('61', createDecision(decision))
    expect(harness.responses).toContainEqual({ id: 61, result: expected })
    completeTurn(harness)
    await running
  })

  it('returns only the requested permission subset and adds session scope only when selected', async () => {
    const harness = createRuntimeHarness()
    const { running } = await beginTurn(harness)
    const requestedPermissions = { fileSystem: { write: ['C:/repo', 'C:/outside'] }, network: { domains: ['api.openai.com'] } }
    harness.emitServerRequest('item/permissions/requestApproval', 62, { permissions: requestedPermissions })
    expect(harness.events).toContainEqual({
      type: 'approval-request',
      requestId: '62',
      approvalType: 'permissions',
      request: { permissions: requestedPermissions },
    })
    harness.runtime.resolveApproval('62', { type: 'acceptForSession', permissions: { fileSystem: { write: ['C:/repo', 'C:/not-requested'] }, network: { domains: ['other.example'] } } })
    expect(harness.responses).toContainEqual({ id: 62, result: { permissions: { fileSystem: { write: ['C:/repo'] } }, scope: 'session' } })
    completeTurn(harness)
    await running
  })

  it('declines permission approvals without returning permissions', async () => {
    const harness = createRuntimeHarness()
    const { running } = await beginTurn(harness)
    harness.emitServerRequest('item/permissions/requestApproval', 63, { permissions: { fileSystem: { write: ['C:/repo'] } } })
    harness.runtime.resolveApproval('63', createDecision('decline'))
    expect(harness.responses).toContainEqual({ id: 63, result: { permissions: {} } })
    completeTurn(harness)
    await running
  })

  it('declines unknown server requests instead of approving them', async () => {
    const harness = createRuntimeHarness()
    const { running } = await beginTurn(harness)
    harness.emitServerRequest('account/delete/requestApproval', 64, {})
    expect(harness.responses).toContainEqual({ id: 64, result: { decision: 'decline' } })
    completeTurn(harness)
    await running
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
